/**
 * Relógios normalizados em milissegundos, com registro da unidade original (SPEC 9.2).
 * - Stream de posições (wc/bc): segundos.
 * - Exportação JSON de partida (clocks): centésimos de segundo.
 * - Campo "featured.c" do torneio: segundos.
 * Nunca aplicar o mesmo fator aos dois formatos.
 */

export type ClockUnit = 'seconds' | 'centiseconds';

export interface ClockReading {
  /** Tempo restante em ms, ou null quando indisponível. */
  whiteMs: number | null;
  blackMs: number | null;
  unit: ClockUnit;
  /** Relógios pertencem à posição transmitida, não ao instante atual. */
  anchoredToPosition: true;
}

function toMs(value: unknown, unit: ClockUnit): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return unit === 'seconds' ? Math.round(value * 1000) : Math.round(value * 10);
}

export function clocksFromStream(wc: unknown, bc: unknown): ClockReading {
  return {
    whiteMs: toMs(wc, 'seconds'),
    blackMs: toMs(bc, 'seconds'),
    unit: 'seconds',
    anchoredToPosition: true,
  };
}

export function clocksFromCentis(white: unknown, black: unknown): ClockReading {
  return {
    whiteMs: toMs(white, 'centiseconds'),
    blackMs: toMs(black, 'centiseconds'),
    unit: 'centiseconds',
    anchoredToPosition: true,
  };
}

/** Formata um relógio: m:ss, ou h:mm:ss, com décimos abaixo de 10 s. */
export function formatClock(ms: number | null): string {
  if (ms === null) return '—';
  const totalTenths = Math.floor(ms / 100);
  const totalSeconds = Math.floor(totalTenths / 10);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (totalSeconds < 10) return `0:0${s}.${totalTenths % 10}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
