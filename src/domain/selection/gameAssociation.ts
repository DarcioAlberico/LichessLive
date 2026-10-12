import type { GamePlayer, GameStatusName, Winner } from '../entities/game';
import { isFinishedStatus } from '../entities/game';
import type { GameId, TournamentId, UserId } from '../entities/ids';

/**
 * Associação entre partida, jogador e torneio (SPEC 7.2, T03).
 * Nunca exibir silenciosamente uma partida de outro torneio; nunca apresentar a última partida
 * encerrada como se estivesse em andamento.
 */

export interface GameSummary {
  gameId: GameId;
  status: GameStatusName;
  tournamentId: TournamentId | null;
  whiteUserId: UserId | null;
  blackUserId: UserId | null;
}

export type Association =
  | { kind: 'current'; gameId: GameId }
  | { kind: 'lastFinished'; gameId: GameId }
  | { kind: 'otherTournament'; gameId: GameId; tournamentId: TournamentId | null }
  | { kind: 'unlinked'; gameId: GameId }
  | { kind: 'playerMismatch'; gameId: GameId };

export function associateGame(game: GameSummary, userId: UserId, tournamentId: TournamentId): Association {
  if (game.whiteUserId !== userId && game.blackUserId !== userId) {
    return { kind: 'playerMismatch', gameId: game.gameId };
  }
  if (game.tournamentId === null) return { kind: 'unlinked', gameId: game.gameId };
  if (game.tournamentId !== tournamentId) {
    return { kind: 'otherTournament', gameId: game.gameId, tournamentId: game.tournamentId };
  }
  if (isFinishedStatus(game.status)) return { kind: 'lastFinished', gameId: game.gameId };
  if (game.status === 'started' || game.status === 'created') return { kind: 'current', gameId: game.gameId };
  // Estado desconhecido: não confirmar como atual.
  return { kind: 'unlinked', gameId: game.gameId };
}

/** Verifica um pacote de identidade recebido pelo stream contra o torneio da sessão. */
export function streamBelongsToTournament(
  streamTournamentId: TournamentId | null,
  sessionTournamentId: TournamentId,
): 'same' | 'other' | 'unknown' {
  if (streamTournamentId === null) return 'unknown';
  return streamTournamentId === sessionTournamentId ? 'same' : 'other';
}

/** Partida obtida por consulta REST (current-game ou exportação), com jogadores e vencedor. */
export interface ResolvedGame extends GameSummary {
  white: GamePlayer;
  black: GamePlayer;
  winner: Winner;
  variant: string;
}
