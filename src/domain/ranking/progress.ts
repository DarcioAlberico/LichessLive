import type { UserId } from '../entities/ids';
import type { ReferenceMode } from '../entities/profiles';

/**
 * Cálculo do progresso de posição (SPEC 6).
 *
 * deltaPosicao = posicaoReferencia - posicaoAtual. Posição menor é melhor, portanto delta positivo
 * indica subida. O cálculo só compara observações com o mesmo torneio, escopo, rulesVersion e
 * referenceId — a aplicação garante isso ao filtrar o histórico entregue a esta função.
 * deltaRank, deltaScore e ratingDiff são grandezas separadas.
 */

export const RULES_VERSION = 'arena-rank-v1';

export type ProgressScope = 'general' | 'watched';

export interface PlayerObservation {
  collectionId: string;
  rank: number | null;
  score: number | null;
  /** Jogador presente no recorte desta coleta. */
  inCut: boolean;
  endedAt: number;
}

export type ProgressStatus =
  | 'new' // primeira observação válida: cria referência, não alega ganho
  | 'unchanged' // 0 posições
  | 'resetByMark' // 0 após marcação manual
  | 'up'
  | 'down'
  | 'outOfCut' // ausente do recorte: não inferir abandono nem posição
  | 'noData'; // nenhum dado observado nesta referência

export interface ProgressRow {
  userId: UserId;
  status: ProgressStatus;
  currentRank: number | null;
  referenceRank: number | null;
  deltaRank: number | null;
  deltaScore: number | null;
  /** Duas observações válidas consecutivas sustentam a direção (destaque permitido). */
  confirmed: boolean;
  referenceAt: number | null;
  observedAt: number | null;
  /** Os dados exibidos não foram atualizados na última coleta (falha ou dado antigo). */
  stale: boolean;
}

export interface ProgressInput {
  userId: UserId;
  /** Observações em ordem cronológica, já filtradas por sessão, escopo e referenceId. */
  history: readonly PlayerObservation[];
  mode: ReferenceMode;
  /** A última coleta falhou ou ficou antiga: manter último valor e suspender novo delta. */
  stale: boolean;
  /** ID da coleta válida mais recente da sessão (para detectar ausência do recorte). */
  latestCollectionId: string | null;
}

export function computeProgress(input: ProgressInput): ProgressRow {
  const { userId, history, mode, stale } = input;
  const base: ProgressRow = {
    userId,
    status: 'noData',
    currentRank: null,
    referenceRank: null,
    deltaRank: null,
    deltaScore: null,
    confirmed: false,
    referenceAt: null,
    observedAt: null,
    stale,
  };
  if (history.length === 0) return base;

  const latest = history[history.length - 1]!;
  base.observedAt = latest.endedAt;

  if (!latest.inCut || latest.rank === null) {
    return { ...base, status: 'outOfCut' };
  }
  base.currentRank = latest.rank;

  const valid = history.filter((o) => o.inCut && o.rank !== null);
  const latestIdx = valid.length - 1;

  let ref: PlayerObservation | undefined;
  if (mode === 'lastUpdate') {
    ref = valid[latestIdx - 1];
  } else {
    // sessionStart e manualMark: primeira observação válida desta referência.
    ref = valid[0];
  }

  if (!ref || ref === latest) {
    if (mode === 'manualMark' && ref === latest) {
      return {
        ...base,
        status: 'resetByMark',
        referenceRank: latest.rank,
        deltaRank: 0,
        deltaScore: 0,
        referenceAt: latest.endedAt,
      };
    }
    return { ...base, status: 'new', referenceAt: latest.endedAt };
  }

  const deltaRank = ref.rank! - latest.rank;
  const deltaScore = ref.score !== null && latest.score !== null ? latest.score - ref.score : null;
  const status: ProgressStatus = deltaRank > 0 ? 'up' : deltaRank < 0 ? 'down' : 'unchanged';

  // Confirmação: a observação válida anterior à mais recente também sustenta a direção.
  let confirmed = false;
  if (deltaRank !== 0) {
    const previous = valid[latestIdx - 1];
    if (previous && previous !== ref && previous.rank !== null) {
      const prevDelta = ref.rank! - previous.rank;
      confirmed = Math.sign(prevDelta) === Math.sign(deltaRank);
    } else if (previous && previous === ref && mode === 'lastUpdate') {
      // Em "desde a última atualização", a confirmação exige a coleta anterior também ter movido.
      const beforePrev = valid[latestIdx - 2];
      confirmed =
        !!beforePrev &&
        beforePrev.rank !== null &&
        Math.sign(beforePrev.rank - ref.rank!) === Math.sign(deltaRank);
    }
  }

  return {
    ...base,
    status,
    referenceRank: ref.rank,
    deltaRank,
    deltaScore,
    confirmed,
    referenceAt: ref.endedAt,
  };
}

/** Texto do delta sem depender de cor: seta e sinal (SPEC 4.2). */
export function deltaLabel(row: Pick<ProgressRow, 'status' | 'deltaRank'>): string {
  switch (row.status) {
    case 'new':
      return 'Novo';
    case 'outOfCut':
      return 'Fora do recorte';
    case 'noData':
      return 'Sem dados';
    case 'resetByMark':
      return '0 após marcação';
    case 'unchanged':
      return '0 posições';
    case 'up':
    case 'down': {
      const d = row.deltaRank ?? 0;
      const n = Math.abs(d);
      const word = n === 1 ? 'posição' : 'posições';
      return d > 0 ? `▲ +${n} ${word}` : `▼ -${n} ${word}`;
    }
  }
}

export function referenceModeLabel(mode: ReferenceMode): string {
  switch (mode) {
    case 'sessionStart':
      return 'Desde o início do acompanhamento';
    case 'lastUpdate':
      return 'Desde a última atualização';
    case 'manualMark':
      return 'Desde a marcação do apresentador';
  }
}
