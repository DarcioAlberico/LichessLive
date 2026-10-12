/**
 * Horas exibidas no fuso configurado (padrão America/Sao_Paulo). Internamente tudo é persistido em
 * milissegundos UTC; durações de interface usam relógio monotônico (performance.now).
 */

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string, withSeconds: boolean): Intl.DateTimeFormat {
  const key = `${timezone}|${withSeconds}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      ...(withSeconds ? { second: '2-digit' } : {}),
      hour12: false,
    });
    cache.set(key, f);
  }
  return f;
}

/** "20:10" ou "20:10:05". */
export function formatTime(utcMs: number, timezone: string, withSeconds = false): string {
  return formatter(timezone, withSeconds).format(new Date(utcMs));
}

/** "20h10" — usado no rótulo "Progresso desde 20h10". */
export function formatHourLabel(utcMs: number, timezone: string): string {
  return formatTime(utcMs, timezone).replace(':', 'h');
}

export function monotonicNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
