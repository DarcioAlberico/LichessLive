/** Estados de conexão separados por canal (SPEC 9.2 e 11.3). */

export type RestState =
  | { kind: 'idle' }
  | { kind: 'ok'; lastSuccessAt: number }
  | { kind: 'degraded'; lastSuccessAt: number | null; error: string; retryAt: number | null }
  | { kind: 'rateLimited'; pausedUntil: number }
  | { kind: 'offline'; lastSuccessAt: number | null };

export type StreamState =
  | { kind: 'idle' }
  | { kind: 'connecting'; since: number }
  | { kind: 'live'; since: number; lastMessageAt: number }
  | { kind: 'reconnecting'; attempt: number; retryAt: number; lastMessageAt: number | null; error: string }
  | { kind: 'ended'; at: number }
  | { kind: 'paused'; until: number }
  | { kind: 'error'; error: string };

export type PanelState = { kind: 'connected' } | { kind: 'disconnected'; since: number };

export interface ConnectionState {
  rest: RestState;
  gameStream: StreamState;
  panel: PanelState;
}

/** Estado exibido ao público (SPEC 11.3). */
export type PublicStatus =
  | 'loading'
  | 'updating'
  | 'apiDelayed'
  | 'noConnection'
  | 'partialData'
  | 'rateLimited'
  | 'tournamentFinished'
  | 'panelDisconnected';

/** Degraus de espera para erros transitórios: 1, 2, 4, 8, 16, 30 s. */
export const BACKOFF_STEPS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;

/** Espera com jitter (±20%) para a tentativa n (0-based). */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const idx = Math.min(Math.max(attempt, 0), BACKOFF_STEPS_MS.length - 1);
  const base = BACKOFF_STEPS_MS[idx] ?? 30000;
  const jitter = (random() * 0.4 - 0.2) * base;
  return Math.max(250, Math.round(base + jitter));
}

/** Pausa global após HTTP 429: pelo menos 60 s ou o Retry-After válido maior. */
export const MIN_RATE_LIMIT_PAUSE_MS = 60_000;

export function rateLimitPauseMs(retryAfterHeader: string | null | undefined, now: number): number {
  let retryMs = 0;
  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader);
    if (Number.isFinite(secs) && secs > 0) {
      retryMs = secs * 1000;
    } else {
      const date = Date.parse(retryAfterHeader);
      if (Number.isFinite(date) && date > now) retryMs = date - now;
    }
  }
  // Limita Retry-After absurdo a 1 hora para não travar a sessão indefinidamente.
  retryMs = Math.min(retryMs, 3_600_000);
  return Math.max(MIN_RATE_LIMIT_PAUSE_MS, retryMs);
}
