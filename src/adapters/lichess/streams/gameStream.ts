import type { StreamState } from '../../../domain/entities/connection';
import { backoffDelay, rateLimitPauseMs } from '../../../domain/entities/connection';
import { isFinishedStatus } from '../../../domain/entities/game';
import type { GameId } from '../../../domain/entities/ids';
import { ContractError } from '../../../shared/validate';
import type { StreamMessage } from '../schemas';
import { parseStreamMessage } from '../schemas';
import { NdjsonOverflowError, NdjsonParser } from './ndjson';
import { isAbortError } from '../rest/restQueue';

/**
 * Stream NDJSON da partida selecionada (/api/stream/game/{id}).
 * - Um stream por sessão; encerrado imediatamente na troca (close()).
 * - Erros transitórios: espera com jitter em degraus de 1, 2, 4, 8, 16 e 30 s.
 * - HTTP 429: pausa global; não reconecta em laço durante a pausa.
 * - Fim normal após o resultado não é falha.
 * - Erro de contrato crítico interrompe este canal.
 */

export interface GameStreamDeps {
  fetchImpl: typeof fetch;
  now?: () => number;
  random?: () => number;
  /** Pausa global vigente (ms UTC) e registro de nova pausa após 429. */
  pause: { until(): number; set(until: number): void };
  /**
   * Sem nenhum byte por este tempo, a leitura é refeita em silêncio (o stream reenvia o histórico).
   * O Lichess não envia heartbeat em partidas paradas (conferido em 12/10/2026), então tempo sem
   * lance não é tratado como desconexão; só uma reconexão que falha vira "Sem conexão".
   */
  idleTimeoutMs?: number;
}

export interface GameStreamHandlers {
  onMessage(msg: StreamMessage): void;
  onState(state: StreamState): void;
  onDiagnostic(kind: 'invalidLine' | 'contract' | 'transport', message: string): void;
}

export class GameStreamConnection {
  private readonly controller = new AbortController();
  private closed = false;
  private attempt = 0;
  private lastMessageAt: number | null = null;
  private finished = false;
  private readonly now: () => number;

  constructor(
    public readonly gameId: GameId,
    private readonly deps: GameStreamDeps,
    private readonly handlers: GameStreamHandlers,
  ) {
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    void this.loop();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private emit(state: StreamState): void {
    if (!this.closed) this.handlers.onState(state);
  }

  private async loop(): Promise<void> {
    const signal = this.controller.signal;
    let quiet = false;
    while (!this.closed) {
      const pausedUntil = this.deps.pause.until();
      if (pausedUntil > this.now()) {
        this.emit({ kind: 'paused', until: pausedUntil });
        if (!(await sleep(pausedUntil - this.now() + 100, signal))) return;
        continue;
      }
      if (!quiet) this.emit({ kind: 'connecting', since: this.now() });
      quiet = false;
      try {
        const outcome = await this.connectOnce(signal);
        if (outcome === 'idle') {
          this.handlers.onDiagnostic('transport', 'stream sem dados por muito tempo; leitura refeita');
          quiet = true;
          continue;
        }
        if (outcome === 'finished') {
          this.emit({ kind: 'ended', at: this.now() });
          return;
        }
        if (outcome === 'stop') return;
        // 429: a próxima volta do laço aguarda a pausa global, sem contar como falha transitória.
        if (outcome === 'rateLimited') continue;
        // Stream terminou sem resultado: reconectar como erro transitório.
        throw new Error('stream encerrado pela fonte');
      } catch (err) {
        if (this.closed || isAbortError(err)) return;
        if (err instanceof ContractError || err instanceof NdjsonOverflowError) {
          this.handlers.onDiagnostic('contract', err.message);
          this.emit({ kind: 'error', error: err.message });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        this.handlers.onDiagnostic('transport', message);
        const delay = backoffDelay(this.attempt, this.deps.random);
        this.attempt += 1;
        this.emit({
          kind: 'reconnecting',
          attempt: this.attempt,
          retryAt: this.now() + delay,
          lastMessageAt: this.lastMessageAt,
          error: message,
        });
        if (!(await sleep(delay, signal))) return;
      }
    }
  }

  private async connectOnce(
    outer: AbortSignal,
  ): Promise<'finished' | 'eof' | 'stop' | 'rateLimited' | 'idle'> {
    // Controlador desta tentativa: fechado pelo encerramento do stream ou pelo vigia de inatividade.
    const attempt = new AbortController();
    const onOuterAbort = () => attempt.abort();
    outer.addEventListener('abort', onOuterAbort, { once: true });
    let idle = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idle = true;
        attempt.abort();
      }, this.deps.idleTimeoutMs ?? 60_000);
    };
    arm();
    try {
      return await this.readStream(attempt.signal, arm);
    } catch (err) {
      if (idle && !outer.aborted) return 'idle';
      throw err;
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      outer.removeEventListener('abort', onOuterAbort);
    }
  }

  private async readStream(
    signal: AbortSignal,
    onBytes: () => void,
  ): Promise<'finished' | 'eof' | 'stop' | 'rateLimited'> {
    let announced = false;
    const res = await this.deps.fetchImpl(
      `https://lichess.org/api/stream/game/${encodeURIComponent(this.gameId)}`,
      {
        method: 'GET',
        signal,
        credentials: 'omit',
        cache: 'no-store',
        headers: { Accept: 'application/x-ndjson' },
      },
    );
    if (res.status === 429) {
      const now = this.now();
      this.deps.pause.set(now + rateLimitPauseMs(res.headers.get('Retry-After'), now));
      await res.body?.cancel().catch(() => undefined);
      return 'rateLimited';
    }
    if (res.status === 404) {
      await res.body?.cancel().catch(() => undefined);
      this.emit({ kind: 'error', error: 'Partida não encontrada' });
      return 'stop';
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`HTTP ${res.status}`);
    }
    const parser = new NdjsonParser();
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        onBytes();
        const events = done ? parser.end() : parser.push(value);
        for (const e of events) {
          if (this.closed) return 'stop';
          if (e.kind === 'heartbeat') continue;
          if (e.kind === 'invalidLine') {
            this.handlers.onDiagnostic('invalidLine', `${e.error}: ${e.sample}`);
            continue;
          }
          const msg = parseStreamMessage(e.value, this.gameId);
          const now = this.now();
          if (!announced) this.emit({ kind: 'live', since: now, lastMessageAt: now });
          announced = true;
          this.attempt = 0;
          this.lastMessageAt = now;
          if (msg.kind === 'descriptor' && msg.status && isFinishedStatus(msg.status)) this.finished = true;
          this.handlers.onMessage(msg);
        }
        if (done) return this.finished ? 'finished' : 'eof';
      }
    } finally {
      reader.releaseLock();
    }
  }
}

/** Espera cancelável; retorna false se o sinal foi abortado. */
export function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve(true);
      },
      Math.max(0, ms),
    );
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
