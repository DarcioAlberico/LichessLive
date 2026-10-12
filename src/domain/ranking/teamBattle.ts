import type { TeamId, UserId } from '../entities/ids';
import type { RankingSnapshot } from './batch';

/**
 * Regras de Team Battle (SPEC 7.1 e 4.3):
 * - O team do participante no torneio tem precedência sobre associações do perfil: um usuário pode
 *   pertencer a vários teams.
 * - O placar dos teams vem da fonte oficial; nunca somar pontos de todos os membros, pois o placar
 *   considera apenas os pontuadores (nbLeaders).
 */

export type TeamLinkSource = 'tournament' | 'duel' | 'roster' | 'none';

export interface TeamLink {
  teamId: TeamId | null;
  source: TeamLinkSource;
}

export function resolveTournamentTeam(
  userId: UserId,
  snapshot: RankingSnapshot | null,
  duelTeams: Readonly<Record<string, TeamId>>,
  rosterTeams: readonly TeamId[],
): TeamLink {
  const entry = snapshot?.byUser.get(userId);
  if (entry?.teamId) return { teamId: entry.teamId, source: 'tournament' };
  const duel = duelTeams[userId];
  if (duel) return { teamId: duel, source: 'duel' };
  // O cadastro local só informa; não define o vínculo no torneio quando há vários teams.
  if (rosterTeams.length === 1) return { teamId: rosterTeams[0]!, source: 'roster' };
  return { teamId: null, source: 'none' };
}

/**
 * Jogadores do "Nosso team" em um torneio: participantes vinculados ao team no torneio
 * (Team Battle) unidos à lista local de acompanhados. Em Team Battle, um acompanhado
 * vinculado a outro team no torneio é marcado, não removido.
 */
export function ourTeamUserIds(
  teamId: TeamId | null,
  snapshot: RankingSnapshot | null,
  watched: readonly UserId[],
  isTeamBattle: boolean,
): UserId[] {
  const ids = new Set<UserId>(watched);
  if (isTeamBattle && teamId && snapshot) {
    for (const e of snapshot.entries) if (e.teamId === teamId) ids.add(e.userId);
  }
  return [...ids];
}
