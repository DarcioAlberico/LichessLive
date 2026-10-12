/** Cobertura dos dados: nunca apresentar um recorte parcial como completo. */
export type CoverageKind = 'complete' | 'partial' | 'unknown' | 'unavailable';

export interface Coverage {
  kind: CoverageKind;
  /** Itens recebidos da fonte. */
  received: number;
  /** Total declarado pela fonte, quando conhecido. */
  total: number | null;
  /** Explicação curta para o operador (ex.: "limite nb=200"). */
  note?: string;
}

export function computeCoverage(received: number, total: number | null | undefined, note?: string): Coverage {
  if (total === null || total === undefined || !Number.isFinite(total)) {
    return {
      kind: received > 0 ? 'unknown' : 'unavailable',
      received,
      total: null,
      ...(note ? { note } : {}),
    };
  }
  if (received >= total) return { kind: 'complete', received, total, ...(note ? { note } : {}) };
  return { kind: 'partial', received, total, ...(note ? { note } : {}) };
}

export const UNAVAILABLE: Coverage = { kind: 'unavailable', received: 0, total: null };

export function coverageLabel(c: Coverage): string {
  switch (c.kind) {
    case 'complete':
      return `Completa (${c.received})`;
    case 'partial':
      return `Parcial: ${c.received} de ${c.total ?? '?'}`;
    case 'unknown':
      return `Desconhecida (${c.received} recebidos)`;
    case 'unavailable':
      return 'Indisponível';
  }
}
