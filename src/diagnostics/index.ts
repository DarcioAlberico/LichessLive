/**
 * Diagnóstico local (SPEC 13.2): tipo de evento, canal, duração, cobertura e erro.
 * Nunca registra fotos, tokens, cookies ou conteúdo de chat. Exportar é ação explícita do operador.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEvent {
  at: number;
  level: LogLevel;
  channel: string;
  event: string;
  durationMs?: number;
  coverage?: string;
  error?: string;
  detail?: string;
}

const FORBIDDEN = /(token|cookie|authorization|bearer|password|senha|base64|data:image)/i;

function sanitize(text: string | undefined, max = 300): string | undefined {
  if (text === undefined) return undefined;
  const clean = text.replace(/[\r\n\t]+/g, ' ').slice(0, max);
  return FORBIDDEN.test(clean) ? '[removido]' : clean;
}

export class DiagnosticsLog {
  private readonly events: LogEvent[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly capacity = 1000) {}

  log(
    level: LogLevel,
    channel: string,
    event: string,
    extra: Omit<LogEvent, 'at' | 'level' | 'channel' | 'event'> = {},
  ): void {
    const entry: LogEvent = {
      at: Date.now(),
      level,
      channel: sanitize(channel, 40) ?? '',
      event: sanitize(event, 120) ?? '',
      ...(extra.durationMs !== undefined ? { durationMs: Math.round(extra.durationMs) } : {}),
      ...(extra.coverage !== undefined ? { coverage: sanitize(extra.coverage, 80) } : {}),
      ...(extra.error !== undefined ? { error: sanitize(extra.error) } : {}),
      ...(extra.detail !== undefined ? { detail: sanitize(extra.detail) } : {}),
    };
    this.events.push(entry);
    if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity);
    for (const l of this.listeners) l();
  }

  info(channel: string, event: string, extra?: Omit<LogEvent, 'at' | 'level' | 'channel' | 'event'>) {
    this.log('info', channel, event, extra);
  }
  warn(channel: string, event: string, extra?: Omit<LogEvent, 'at' | 'level' | 'channel' | 'event'>) {
    this.log('warn', channel, event, extra);
  }
  error(channel: string, event: string, extra?: Omit<LogEvent, 'at' | 'level' | 'channel' | 'event'>) {
    this.log('error', channel, event, extra);
  }

  list(): readonly LogEvent[] {
    return this.events;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.events.length = 0;
    for (const l of this.listeners) l();
  }
}

/** Amostras para percentis (p95) de métricas de desempenho. */
export class MetricSeries {
  private readonly samples: number[] = [];
  constructor(private readonly capacity = 2000) {}

  add(value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    this.samples.push(value);
    if (this.samples.length > this.capacity) this.samples.splice(0, this.samples.length - this.capacity);
  }

  count(): number {
    return this.samples.length;
  }

  percentile(p: number): number | null {
    if (this.samples.length === 0) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx]!;
  }
}

export interface Metrics {
  /** Evento recebido no parser até composição renderizada (medido no programa). */
  eventToRender: MetricSeries;
  /** Clique até retorno visual local. */
  clickToFeedback: MetricSeries;
  /** Troca de partida com dados em cache até tabuleiro consistente. */
  switchToBoard: MetricSeries;
  /** Duração das coletas de ranking. */
  rankingCollection: MetricSeries;
}

export function createMetrics(): Metrics {
  return {
    eventToRender: new MetricSeries(),
    clickToFeedback: new MetricSeries(),
    switchToBoard: new MetricSeries(),
    rankingCollection: new MetricSeries(),
  };
}

export interface DiagnosticsReport {
  generatedAt: string;
  appVersion: string;
  userAgent: string;
  metrics: Record<string, { count: number; p50: number | null; p95: number | null }>;
  events: readonly LogEvent[];
  state: unknown;
}

export function buildReport(
  appVersion: string,
  log: DiagnosticsLog,
  metrics: Metrics,
  state: unknown,
): DiagnosticsReport {
  const m: DiagnosticsReport['metrics'] = {};
  for (const [k, series] of Object.entries(metrics) as [string, MetricSeries][]) {
    m[k] = { count: series.count(), p50: series.percentile(50), p95: series.percentile(95) };
  }
  return {
    generatedAt: new Date().toISOString(),
    appVersion,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/d',
    metrics: m,
    events: log.list(),
    state,
  };
}
