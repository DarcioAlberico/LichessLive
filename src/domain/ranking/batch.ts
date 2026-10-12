import type { Coverage } from '../entities/coverage';
import { computeCoverage } from '../entities/coverage';
import type { TeamId, TournamentId, UserId } from '../entities/ids';

/**
 * Coleta de classificação em lote (SPEC 6.4): receber em buffer, validar esquema e duplicidades
 * e publicar o lote de uma vez. Lotes com contradição estrutural ficam para diagnóstico e o
 * último lote válido continua publicado. Mesmo um lote válido é provisório até o fim do torneio.
 */

export interface RankingEntry {
  userId: UserId;
  username: string;
  title: string | null;
  rank: number;
  score: number;
  rating: number | null;
  performance: number | null;
  teamId: TeamId | null;
}

export interface RankingBatch {
  collectionId: string;
  tournamentId: TournamentId;
  entries: RankingEntry[];
  startedAt: number;
  endedAt: number;
  /** Valor de nb pedido à fonte (limita a cobertura). */
  requestedNb: number;
  /** Total de participantes declarado pelos metadados, quando conhecido. */
  totalPlayers: number | null;
  /** Coleta feita após o encerramento do torneio. */
  final: boolean;
  /** Linhas descartadas pela validação de esquema (diagnóstico). */
  invalidLines: number;
}

export interface RankingSnapshot {
  collectionId: string;
  tournamentId: TournamentId;
  entries: RankingEntry[];
  byUser: ReadonlyMap<UserId, RankingEntry>;
  startedAt: number;
  endedAt: number;
  provisional: boolean;
  coverage: Coverage;
}

export type BatchValidation = { ok: true; snapshot: RankingSnapshot } | { ok: false; problems: string[] };

export function validateBatch(batch: RankingBatch): BatchValidation {
  const problems: string[] = [];
  const seenUsers = new Set<string>();
  const seenRanks = new Set<number>();

  if (batch.endedAt < batch.startedAt) problems.push('coleta com fim anterior ao início');
  if (batch.entries.length > batch.requestedNb) {
    problems.push(`fonte devolveu ${batch.entries.length} linhas para nb=${batch.requestedNb}`);
  }

  for (const e of batch.entries) {
    if (seenUsers.has(e.userId)) problems.push(`jogador repetido: ${e.username}`);
    seenUsers.add(e.userId);
    if (!Number.isInteger(e.rank) || e.rank < 1) problems.push(`posição inválida para ${e.username}`);
    else if (seenRanks.has(e.rank)) problems.push(`posição repetida: ${e.rank}`);
    seenRanks.add(e.rank);
    if (!Number.isFinite(e.score)) problems.push(`pontuação inválida para ${e.username}`);
  }

  const sorted = [...batch.entries].sort((a, b) => a.rank - b.rank);
  // O recorte de resultados começa no 1º e é contíguo.
  for (let i = 0; i < sorted.length; i++) {
    const expected = i + 1;
    if (sorted[i]!.rank !== expected) {
      problems.push(`posições não contíguas: esperada ${expected}, recebida ${sorted[i]!.rank}`);
      break;
    }
  }
  // A Arena ordena por pontuação: pontuação maior abaixo de uma menor é contradição.
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.score > sorted[i - 1]!.score) {
      problems.push(`ordem contraditória entre ${sorted[i - 1]!.rank}º e ${sorted[i]!.rank}º`);
      break;
    }
  }

  if (problems.length > 0) return { ok: false, problems: dedupe(problems).slice(0, 20) };

  const received = sorted.length;
  // Se a fonte devolveu menos linhas do que o pedido, o recorte cobre todos os participantes.
  let total = batch.totalPlayers;
  if (received < batch.requestedNb) total = received;
  else if (total !== null && total < received) total = received;
  const note = total !== null && received < total ? `limite nb=${batch.requestedNb}` : undefined;

  return {
    ok: true,
    snapshot: {
      collectionId: batch.collectionId,
      tournamentId: batch.tournamentId,
      entries: sorted,
      byUser: new Map(sorted.map((e) => [e.userId, e])),
      startedAt: batch.startedAt,
      endedAt: batch.endedAt,
      provisional: !batch.final,
      coverage: computeCoverage(received, total, note),
    },
  };
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

/** Posição relativa entre acompanhados (escopo "Entre acompanhados"). */
export function rankAmongWatched(snapshot: RankingSnapshot, watched: readonly UserId[]): Map<UserId, number> {
  const inCut = watched
    .map((id) => snapshot.byUser.get(id))
    .filter((e): e is RankingEntry => e !== undefined)
    .sort((a, b) => a.rank - b.rank);
  return new Map(inCut.map((e, i) => [e.userId, i + 1]));
}
