import type { Coverage } from './coverage';
import type { GameId, TeamId, TournamentId, UserId } from './ids';
import { asTournamentId } from './ids';

/** Formatos reconhecidos. Swiss é reconhecido e informado como não suportado na versão 1.0. */
export type TournamentFormat = 'arena' | 'teamBattle' | 'swiss' | 'unknown';

export type PageRecognition =
  | { kind: 'tournament'; tournamentId: TournamentId }
  | { kind: 'swiss'; swissId: string }
  | { kind: 'incompatible'; reason: string };

/** Reconhece a URL de uma página do Lichess (SPEC 8.2, T02). */
export function recognizeUrl(url: string): PageRecognition {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'incompatible', reason: 'URL inválida' };
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'lichess.org') {
    return { kind: 'incompatible', reason: 'Página fora de lichess.org' };
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts[0] === 'tournament' && parts.length === 2) {
    const id = asTournamentId(parts[1]);
    if (id) return { kind: 'tournament', tournamentId: id };
    return { kind: 'incompatible', reason: 'Página de torneio sem ID reconhecível' };
  }
  if (parts[0] === 'swiss' && parts.length === 2 && /^[A-Za-z0-9]{8}$/.test(parts[1] ?? '')) {
    return { kind: 'swiss', swissId: parts[1]! };
  }
  return { kind: 'incompatible', reason: 'Esta página não é um torneio Arena' };
}

export type TournamentStatus = 'created' | 'started' | 'finished' | 'unknown';

export interface TeamBattleTeam {
  teamId: TeamId;
  name: string;
}

export interface CurrentDuel {
  gameId: GameId;
  /** Ordem do Lichess; cores só são confirmadas pelo stream. */
  players: { name: string; userId: UserId; rating: number | null; rank: number | null }[];
}

export interface FeaturedGame {
  gameId: GameId;
  fen: string;
  lastMove: string | null;
  white: { name: string; userId: UserId; rating: number | null };
  black: { name: string; userId: UserId; rating: number | null };
}

export interface TournamentInfo {
  tournamentId: TournamentId;
  name: string;
  format: TournamentFormat;
  status: TournamentStatus;
  variant: string;
  nbPlayers: number | null;
  clock: { limitSeconds: number; incrementSeconds: number } | null;
  startsAt: number | null;
  /** Segundos para o fim, como informados pela fonte, e o instante em que foram recebidos. */
  secondsToFinish: number | null;
  secondsToStart: number | null;
  /** Times do Team Battle (apenas quando format = teamBattle). */
  teams: TeamBattleTeam[];
  nbLeaders: number | null;
  duels: CurrentDuel[];
  featured: FeaturedGame | null;
  /** Vínculo jogador→team nos duelos atuais, quando a fonte informa (duelTeams). */
  duelTeams: Record<string, TeamId>;
  fetchedAt: number;
}

export function formatLabel(format: TournamentFormat): string {
  switch (format) {
    case 'arena':
      return 'Arena';
    case 'teamBattle':
      return 'Arena Team Battle';
    case 'swiss':
      return 'Swiss (não suportado)';
    default:
      return 'Formato desconhecido';
  }
}

export interface TournamentParticipant {
  tournamentId: TournamentId;
  userId: UserId;
  username: string;
  title: string | null;
  rank: number;
  score: number;
  rating: number | null;
  performance: number | null;
  /** Team do participante neste torneio (tem precedência sobre o cadastro de membros). */
  tournamentTeamId: TeamId | null;
}

export interface TeamStanding {
  rank: number;
  teamId: TeamId;
  name: string;
  score: number;
  /** Principais pontuadores segundo a fonte oficial (não é a lista completa). */
  topPlayers: { userId: UserId; name: string; score: number }[];
}

export interface TeamStandings {
  tournamentId: TournamentId;
  teams: TeamStanding[];
  fetchedAt: number;
  coverage: Coverage;
}
