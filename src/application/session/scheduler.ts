import { backoffDelay } from '../../domain/entities/connection';

/**
 * Agendador de tarefas periódicas sem sobreposição (SPEC 11.1): cada tarefa só volta a rodar após
 * terminar; falhas transitórias usam espera em degraus; durante a pausa global as tarefas aguardam.
 * O relógio de disparo é externo (tick do painel e alarme do service worker).
 */

export interface TaskSpec {
  name: string;
  /** Intervalo nominal em ms (já com o fator de degradação aplicado pelo chamador). */
  interval: () => number;
  /** Tarefa habilitada no contexto atual. */
  enabled: () => boolean;
  /** Tarefa essencial continua em degradação; secundárias são suspensas. */
  essential: boolean;
  run: () => Promise<void>;
}

interface TaskState {
  spec: TaskSpec;
  nextAt: number;
  running: boolean;
  failures: number;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
}

export interface SchedulerDeps {
  now: () => number;
  pausedUntil: () => number;
  /** Modo degradado: suspende tarefas secundárias. */
  degraded: () => boolean;
  onError: (task: string, err: unknown) => void;
  isRateLimit: (err: unknown) => boolean;
}

export class TaskScheduler {
  private readonly tasks = new Map<string, TaskState>();
  private disposed = false;

  constructor(private readonly deps: SchedulerDeps) {}

  add(spec: TaskSpec, firstDelayMs = 0): void {
    this.tasks.set(spec.name, {
      spec,
      nextAt: this.deps.now() + firstDelayMs,
      running: false,
      failures: 0,
      lastRunAt: null,
      lastDurationMs: null,
      lastError: null,
    });
  }

  /** Antecipa a próxima execução (ex.: mudança de contexto). */
  runSoon(name: string, delayMs = 0): void {
    const t = this.tasks.get(name);
    if (t) t.nextAt = Math.min(t.nextAt, this.deps.now() + delayMs);
  }

  tick(): void {
    if (this.disposed) return;
    const now = this.deps.now();
    const paused = this.deps.pausedUntil() > now;
    const degraded = this.deps.degraded();
    for (const t of this.tasks.values()) {
      if (t.running || t.nextAt > now || !t.spec.enabled()) continue;
      if (paused) continue;
      if (degraded && !t.spec.essential) continue;
      void this.execute(t);
    }
  }

  private async execute(t: TaskState): Promise<void> {
    t.running = true;
    const started = this.deps.now();
    try {
      await t.spec.run();
      t.failures = 0;
      t.lastError = null;
      t.nextAt = this.deps.now() + t.spec.interval();
    } catch (err) {
      t.lastError = err instanceof Error ? err.message : String(err);
      this.deps.onError(t.spec.name, err);
      if (this.deps.isRateLimit(err)) {
        t.nextAt = Math.max(this.deps.pausedUntil(), this.deps.now()) + t.spec.interval();
      } else {
        t.failures += 1;
        t.nextAt = this.deps.now() + Math.min(t.spec.interval(), backoffDelay(t.failures - 1));
      }
    } finally {
      t.running = false;
      t.lastRunAt = started;
      t.lastDurationMs = this.deps.now() - started;
    }
  }

  status(): {
    name: string;
    nextAt: number;
    running: boolean;
    failures: number;
    lastRunAt: number | null;
    lastDurationMs: number | null;
    lastError: string | null;
  }[] {
    return [...this.tasks.values()].map((t) => ({
      name: t.spec.name,
      nextAt: t.nextAt,
      running: t.running,
      failures: t.failures,
      lastRunAt: t.lastRunAt,
      lastDurationMs: t.lastDurationMs,
      lastError: t.lastError,
    }));
  }

  dispose(): void {
    this.disposed = true;
    this.tasks.clear();
  }
}
