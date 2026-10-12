import { rateLimitPauseMs } from '../../../domain/entities/connection';

/**
 * Fila central de requisições REST finitas (SPEC 11.1, RF13):
 * - concorrência igual a um (o Lichess orienta uma requisição por vez);
 * - deduplicação de requisições iguais em andamento e cache com validade curta;
 * - cancelamento por AbortSignal;
 * - pausa global de pelo menos 60 s (ou Retry-After maior) após HTTP 429, sem reconectar em laço.
 * Não inventa um limite universal de requisições por segundo.
 */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
  }
}

export class RateLimitedError extends Error {
  constructor(public readonly pausedUntil: number) {
    super('Limitação de acesso (HTTP 429)');
    this.name = 'RateLimitedError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

export interface RestQueueState {
  pausedUntil: number | null;
  pending: number;
  inFlightKey: string | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  rateLimitCount: number;
  /** Fator de redução de frequência aplicado pelo agendador após 429 (1 = normal). */
  frequencyFactor: number;
}

/** Pausa global compartilhada entre contextos da extensão (painel e configurações). */
export interface SharedPause {
  read(): number;
  write(until: number): void;
}

export interface RequestOptions {
  ttlMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  priority?: 'high' | 'normal';
}

interface Job {
  key: string;
  url: string;
  headers: Record<string, string>;
  priority: 'high' | 'normal';
  ttlMs: number;
  handle: (res: Response, signal: AbortSignal) => Promise<unknown>;
  controller: AbortController;
  waiters: number;
  promise: Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export interface RestQueueDeps {
  fetchImpl: typeof fetch;
  now?: () => number;
  sharedPause?: SharedPause;
  onState?: (state: RestQueueState) => void;
  maxCacheEntries?: number;
  /** Prazo de cada requisição, incluindo a leitura do corpo (padrão 45 s). */
  timeoutMs?: number;
}

export class RestQueue {
  private readonly queue: Job[] = [];
  private readonly inFlight = new Map<string, Job>();
  private readonly cache = new Map<string, { value: unknown; expiresAt: number }>();
  private running = false;
  private current: Job | null = null;
  private pausedUntil = 0;
  private lastSuccessAt: number | null = null;
  private lastError: string | null = null;
  private rateLimitCount = 0;
  private successStreak = 0;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly now: () => number;

  constructor(private readonly deps: RestQueueDeps) {
    this.now = deps.now ?? Date.now;
  }

  state(): RestQueueState {
    const until = this.effectivePauseUntil();
    return {
      pausedUntil: until > this.now() ? until : null,
      pending: this.queue.length,
      inFlightKey: this.current?.key ?? null,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      rateLimitCount: this.rateLimitCount,
      frequencyFactor: this.frequencyFactor(),
    };
  }

  isPaused(): boolean {
    return this.effectivePauseUntil() > this.now();
  }

  frequencyFactor(): number {
    return Math.min(4, Math.pow(1.5, this.rateLimitCount));
  }

  /** Executa uma requisição GET pela fila. `handle` lê e valida o corpo dentro da vez da fila. */
  request<T>(
    key: string,
    url: string,
    handle: (res: Response, signal: AbortSignal) => Promise<T>,
    opts: RequestOptions = {},
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Fila encerrada'));
    if (!url.startsWith('https://lichess.org/api/')) {
      return Promise.reject(new Error('URL fora da API permitida'));
    }
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return Promise.resolve(cached.value as T);

    let job = this.inFlight.get(key);
    if (!job) {
      let resolve!: (v: unknown) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      job = {
        key,
        url,
        headers: opts.headers ?? {},
        priority: opts.priority ?? 'normal',
        ttlMs: opts.ttlMs ?? 0,
        handle: handle as Job['handle'],
        controller: new AbortController(),
        waiters: 0,
        promise,
        resolve,
        reject,
      };
      this.inFlight.set(key, job);
      if (job.priority === 'high') {
        const idx = this.queue.findIndex((j) => j.priority !== 'high');
        if (idx === -1) this.queue.push(job);
        else this.queue.splice(idx, 0, job);
      } else {
        this.queue.push(job);
      }
      this.emit();
      void this.pump();
    } else if (opts.priority === 'high' && job.priority !== 'high' && this.current !== job) {
      // Promove um pedido já enfileirado.
      job.priority = 'high';
      const idx = this.queue.indexOf(job);
      if (idx > 0) {
        this.queue.splice(idx, 1);
        this.queue.unshift(job);
      }
    }
    return this.attachWaiter(job, opts.signal) as Promise<T>;
  }

  private attachWaiter(job: Job, signal?: AbortSignal): Promise<unknown> {
    job.waiters += 1;
    if (!signal) return job.promise;
    if (signal.aborted) {
      this.releaseWaiter(job);
      return Promise.reject(new DOMException('Abortado', 'AbortError'));
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.releaseWaiter(job);
        reject(new DOMException('Abortado', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      job.promise.then(
        (v) => {
          signal.removeEventListener('abort', onAbort);
          resolve(v);
        },
        (e) => {
          signal.removeEventListener('abort', onAbort);
          reject(e);
        },
      );
    });
  }

  private releaseWaiter(job: Job): void {
    job.waiters -= 1;
    if (job.waiters > 0) return;
    // Ninguém mais espera: cancela a requisição e retira da fila.
    job.controller.abort();
    const idx = this.queue.indexOf(job);
    if (idx !== -1) this.queue.splice(idx, 1);
    if (this.inFlight.get(job.key) === job) this.inFlight.delete(job.key);
    job.reject(new DOMException('Abortado', 'AbortError'));
    job.promise.catch(() => undefined);
    this.emit();
  }

  private effectivePauseUntil(): number {
    const shared = this.deps.sharedPause?.read() ?? 0;
    return Math.max(this.pausedUntil, shared);
  }

  private async pump(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      while (this.queue.length > 0 && !this.disposed) {
        const until = this.effectivePauseUntil();
        const now = this.now();
        if (until > now) {
          this.emit();
          this.scheduleWake(until - now);
          return;
        }
        const job = this.queue.shift()!;
        this.current = job;
        this.emit();
        await this.run(job);
        this.current = null;
      }
    } finally {
      this.running = false;
      this.current = null;
      this.emit();
    }
  }

  private scheduleWake(ms: number): void {
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      void this.pump();
    }, ms + 50);
  }

  private async run(job: Job): Promise<void> {
    const signal = job.controller.signal;
    // Conexão parada não pode travar a fila de concorrência 1.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      job.controller.abort();
    }, this.deps.timeoutMs ?? 45_000);
    try {
      let res: Response;
      try {
        res = await this.deps.fetchImpl(job.url, {
          method: 'GET',
          headers: job.headers,
          signal,
          credentials: 'omit',
          cache: 'no-store',
        });
      } catch (err) {
        if (isAbortError(err)) throw err;
        throw new NetworkError(err instanceof Error ? err.message : 'falha de rede');
      }
      if (res.status === 429) {
        const now = this.now();
        const until = now + rateLimitPauseMs(res.headers.get('Retry-After'), now);
        this.pausedUntil = Math.max(this.pausedUntil, until);
        this.deps.sharedPause?.write(this.pausedUntil);
        this.rateLimitCount += 1;
        this.successStreak = 0;
        await res.body?.cancel().catch(() => undefined);
        throw new RateLimitedError(this.pausedUntil);
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new HttpError(res.status, job.url);
      }
      const value = await job.handle(res, signal);
      this.lastSuccessAt = this.now();
      this.lastError = null;
      this.successStreak += 1;
      // Recupera a frequência gradualmente após uma sequência de sucessos.
      if (this.rateLimitCount > 0 && this.successStreak >= 20) {
        this.rateLimitCount -= 1;
        this.successStreak = 0;
      }
      if (job.ttlMs > 0) {
        this.cache.set(job.key, { value, expiresAt: this.now() + job.ttlMs });
        this.trimCache();
      }
      job.resolve(value);
    } catch (caught) {
      const err = timedOut ? new NetworkError('tempo esgotado aguardando a resposta') : caught;
      if (!isAbortError(err)) {
        this.lastError = err instanceof Error ? err.message : String(err);
        if (err instanceof HttpError && err.status === 404) this.lastError = null;
      }
      job.reject(err);
      job.promise.catch(() => undefined);
    } finally {
      clearTimeout(timer);
      if (this.inFlight.get(job.key) === job) this.inFlight.delete(job.key);
    }
  }

  private trimCache(): void {
    const max = this.deps.maxCacheEntries ?? 200;
    const now = this.now();
    for (const [k, v] of this.cache) if (v.expiresAt <= now) this.cache.delete(k);
    while (this.cache.size > max) {
      const first = this.cache.keys().next().value;
      if (first === undefined) break;
      this.cache.delete(first);
    }
  }

  invalidate(prefix: string): void {
    for (const k of this.cache.keys()) if (k.startsWith(prefix)) this.cache.delete(k);
  }

  private emit(): void {
    this.deps.onState?.(this.state());
  }

  dispose(): void {
    this.disposed = true;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    for (const job of [...this.queue, ...this.inFlight.values()]) {
      job.controller.abort();
      job.reject(new DOMException('Abortado', 'AbortError'));
      job.promise.catch(() => undefined);
    }
    this.queue.length = 0;
    this.inFlight.clear();
    this.cache.clear();
  }
}
