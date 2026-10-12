/**
 * Normalização e validação dos contratos públicos do Lichess.
 * Formatos conferidos com respostas reais em 12/10/2026 (ver tests/fixtures/lichess e docs/M0-RELATORIO.md).
 */
import { clocksFromStream } from '../../../domain/entities/clock';
import type { GameIdentity, GamePlayer, GameStreamMessage, Winner } from '../../../domain/entities/game';
import { asGameStatus } from '../../../domain/entities/game';
import type { GameId, TeamId, TournamentId, UserId } from '../../../domain/entities/ids';
import { asGameId, asTeamId, asTournamentId, normalizeUserId } from '../../../domain/entities/ids';
import type {
  CurrentDuel,
  FeaturedGame,
  TeamBattleTeam,
  TeamStanding,
  TournamentFormat,
  TournamentInfo,
  TournamentStatus,
} from '../../../domain/entities/tournament';
import type { RankingEntry } from '../../../domain/ranking/batch';
import type { ResolvedGame } from '../../../domain/selection/gameAssociation';
import { completeShortFen } from '../../../domain/entities/fen';
import { arr, ContractError, int, isRecord, num, str } from '../../../shared/validate';

// ---------------------------------------------------------------- torneio

function parseVariant(v: unknown): string {
  if (typeof v === 'string') return v;
  if (isRecord(v) && typeof v.key === 'string') return v.key;
  return 'unknown';
}

function parseTime(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function parseTeamBattleTeams(tb: Record<string, unknown>): TeamBattleTeam[] {
  const teams: TeamBattleTeam[] = [];
  const raw = tb.teams;
  if (isRecord(raw)) {
    // Formato de /api/tournament/{id}: { teamId: [nome, flair] }
    for (const [id, value] of Object.entries(raw)) {
      const teamId = asTeamId(id);
      if (!teamId) continue;
      const name =
        Array.isArray(value) && typeof value[0] === 'string'
          ? value[0]
          : typeof value === 'string'
            ? value
            : id;
      teams.push({ teamId, name });
    }
  } else if (Array.isArray(raw)) {
    // Formato da lista de torneios: [teamId, ...]
    for (const id of raw) {
      const teamId = asTeamId(id);
      if (teamId) teams.push({ teamId, name: teamId });
    }
  }
  return teams;
}

export function parseTournament(json: unknown, now: number): TournamentInfo {
  if (!isRecord(json)) throw new ContractError('tournament', 'resposta não é um objeto');
  const tournamentId = asTournamentId(json.id);
  if (!tournamentId) throw new ContractError('tournament', 'campo id ausente ou inválido');

  const system = str(json.system);
  let format: TournamentFormat = 'unknown';
  if (system === 'arena' || system === null) format = 'arena';
  const tb = isRecord(json.teamBattle) ? json.teamBattle : null;
  if (tb) format = 'teamBattle';

  let status: TournamentStatus = 'unknown';
  if (json.isFinished === true) status = 'finished';
  else if (json.isStarted === true) status = 'started';
  else if (num(json.secondsToStart) !== null) status = 'created';
  else if (json.status === 30) status = 'finished';
  else if (json.status === 20) status = 'started';
  else if (json.status === 10) status = 'created';

  const clockRaw = isRecord(json.clock) ? json.clock : null;
  const clock =
    clockRaw && num(clockRaw.limit) !== null && num(clockRaw.increment) !== null
      ? { limitSeconds: clockRaw.limit as number, incrementSeconds: clockRaw.increment as number }
      : null;

  const duels: CurrentDuel[] = [];
  for (const d of arr(json.duels) ?? []) {
    if (!isRecord(d)) continue;
    const gameId = asGameId(d.id);
    const ps = arr(d.p);
    if (!gameId || !ps) continue;
    const players: CurrentDuel['players'] = [];
    for (const p of ps) {
      if (!isRecord(p)) continue;
      const name = str(p.n);
      const userId = normalizeUserId(name);
      if (!name || !userId) continue;
      players.push({ name, userId, rating: num(p.r), rank: int(p.k) });
    }
    if (players.length === 2) duels.push({ gameId, players });
  }

  let featured: FeaturedGame | null = null;
  if (isRecord(json.featured)) {
    const f = json.featured;
    const gameId = asGameId(f.id);
    const fen = str(f.fen);
    const w = isRecord(f.white) ? f.white : null;
    const b = isRecord(f.black) ? f.black : null;
    const wId = normalizeUserId(w?.id ?? w?.name);
    const bId = normalizeUserId(b?.id ?? b?.name);
    if (gameId && fen && w && b && wId && bId) {
      featured = {
        gameId,
        fen: completeShortFen(fen),
        lastMove: str(f.lastMove),
        white: { name: str(w.name) ?? wId, userId: wId, rating: num(w.rating) },
        black: { name: str(b.name) ?? bId, userId: bId, rating: num(b.rating) },
      };
    }
  }

  const duelTeams: Record<string, TeamId> = {};
  if (isRecord(json.duelTeams)) {
    for (const [user, team] of Object.entries(json.duelTeams)) {
      const uid = normalizeUserId(user);
      const tid = asTeamId(team);
      if (uid && tid) duelTeams[uid] = tid;
    }
  }

  return {
    tournamentId,
    name: str(json.fullName) ?? str(json.name) ?? tournamentId,
    format,
    status,
    variant: parseVariant(json.variant),
    nbPlayers: int(json.nbPlayers),
    clock,
    startsAt: parseTime(json.startsAt),
    secondsToFinish: num(json.secondsToFinish),
    secondsToStart: num(json.secondsToStart),
    teams: tb ? parseTeamBattleTeams(tb) : [],
    nbLeaders: tb ? int(tb.nbLeaders) : null,
    duels,
    featured,
    duelTeams,
    fetchedAt: now,
  };
}

// ---------------------------------------------------------------- resultados (NDJSON)

export function parseResultLine(value: unknown): RankingEntry | null {
  if (!isRecord(value)) return null;
  const username = str(value.username);
  const userId = normalizeUserId(username);
  const rank = int(value.rank);
  const score = num(value.score);
  if (!username || !userId || rank === null || score === null) return null;
  return {
    userId,
    username,
    title: str(value.title),
    rank,
    score,
    rating: num(value.rating),
    performance: num(value.performance),
    teamId: asTeamId(value.team),
  };
}

// ---------------------------------------------------------------- placar dos teams

export function parseTeamStandings(json: unknown, tournamentId: TournamentId): TeamStanding[] {
  if (!isRecord(json)) throw new ContractError('teams', 'resposta não é um objeto');
  if (json.id !== undefined && json.id !== tournamentId) {
    throw new ContractError('teams', 'placar pertence a outro torneio');
  }
  const teams = arr(json.teams);
  if (!teams) throw new ContractError('teams', 'campo teams ausente');
  const out: TeamStanding[] = [];
  for (const t of teams) {
    if (!isRecord(t)) continue;
    const teamId = asTeamId(t.id);
    const rank = int(t.rank);
    const score = num(t.score);
    if (!teamId || rank === null || score === null) continue;
    const topPlayers: TeamStanding['topPlayers'] = [];
    for (const p of arr(t.players) ?? []) {
      if (!isRecord(p)) continue;
      const user = isRecord(p.user) ? p.user : null;
      const userId = normalizeUserId(user?.id ?? user?.name);
      if (!user || !userId) continue;
      topPlayers.push({ userId, name: str(user.name) ?? userId, score: num(p.score) ?? 0 });
    }
    out.push({ rank, teamId, name: teamId, score, topPlayers });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

// ---------------------------------------------------------------- membros do team (NDJSON)

export function parseTeamMember(value: unknown): { userId: UserId; username: string } | null {
  if (!isRecord(value)) return null;
  // Formato atual: { name, id, url, joinedTeamAt }. Formatos antigos: { username, id } ou { user: {...} }.
  const src = isRecord(value.user) ? value.user : value;
  const username = str(src.name) ?? str(src.username) ?? str(src.id);
  const userId = normalizeUserId(src.id ?? username);
  if (!username || !userId) return null;
  return { userId, username };
}

// ---------------------------------------------------------------- usuário público

export interface PublicUser {
  userId: UserId;
  username: string;
  title: string | null;
  disabled: boolean;
}

export function parsePublicUser(json: unknown): PublicUser {
  if (!isRecord(json)) throw new ContractError('user', 'resposta não é um objeto');
  const username = str(json.username) ?? str(json.name);
  const userId = normalizeUserId(json.id ?? username);
  if (!username || !userId) throw new ContractError('user', 'usuário sem id');
  return {
    userId,
    username,
    title: str(json.title),
    disabled: json.disabled === true || json.tosViolation === true,
  };
}

// ---------------------------------------------------------------- partida (current-game / export)

function parsePlayer(value: unknown): GamePlayer {
  if (!isRecord(value))
    return { userId: null, name: 'Anônimo', title: null, rating: null, isAnonymous: true };
  const user = isRecord(value.user) ? value.user : null;
  if (!user) {
    const ai = int(value.aiLevel);
    return {
      userId: null,
      name: ai !== null ? `Stockfish nível ${ai}` : 'Anônimo',
      title: null,
      rating: num(value.rating),
      isAnonymous: true,
    };
  }
  const name = str(user.name) ?? str(user.id) ?? 'Anônimo';
  return {
    userId: normalizeUserId(user.id ?? name),
    name,
    title: str(user.title),
    rating: num(value.rating),
    isAnonymous: false,
  };
}

function parseWinner(value: unknown): Winner {
  return value === 'white' || value === 'black' ? value : null;
}

export type ExportedGame = ResolvedGame;

/** Resposta JSON de /api/user/{u}/current-game e /api/game/export (status como string). */
export function parseExportedGame(json: unknown): ExportedGame {
  if (!isRecord(json)) throw new ContractError('game', 'resposta não é um objeto');
  const gameId = asGameId(json.id);
  if (!gameId) throw new ContractError('game', 'partida sem id');
  const players = isRecord(json.players) ? json.players : {};
  const white = parsePlayer(players.white);
  const black = parsePlayer(players.black);
  const arenaTour = isRecord(json.arenaTour) ? json.arenaTour : null;
  const tournamentId = asTournamentId(arenaTour?.id ?? json.tournament ?? json.tournamentId);
  return {
    gameId,
    status: asGameStatus(json.status),
    tournamentId,
    whiteUserId: white.userId,
    blackUserId: black.userId,
    white,
    black,
    winner: parseWinner(json.winner),
    variant: parseVariant(json.variant),
  };
}

// ---------------------------------------------------------------- stream de lances

export type StreamMessage = GameStreamMessage;

/**
 * /api/stream/game/{id}: a primeira linha descreve a partida (sem status quando em andamento),
 * seguem linhas {fen, lm, wc, bc} (wc/bc em segundos) e, ao terminar, uma descrição final com
 * status {id, name} e winner. Os três últimos lances de partidas em andamento são omitidos.
 */
export function parseStreamMessage(value: unknown, expectedGameId: GameId): StreamMessage {
  if (!isRecord(value)) throw new ContractError('stream', 'registro não é um objeto');
  if (value.id !== undefined) {
    const gameId = asGameId(value.id);
    if (gameId !== expectedGameId) throw new ContractError('stream', 'descrição de outra partida no stream');
    const players = isRecord(value.players) ? value.players : {};
    const statusRaw = isRecord(value.status) ? value.status.name : value.status;
    const identity: GameIdentity = {
      gameId,
      tournamentId: asTournamentId(value.tournamentId),
      variant: parseVariant(value.variant),
      white: parsePlayer(players.white),
      black: parsePlayer(players.black),
      speed: str(value.speed),
    };
    const hasClocks = num(value.wc) !== null || num(value.bc) !== null;
    return {
      kind: 'descriptor',
      identity,
      fen: str(value.fen),
      lastMove: str(value.lastMove) ?? str(value.lm),
      status: statusRaw === undefined ? null : asGameStatus(statusRaw),
      winner: parseWinner(value.winner),
      clocks: hasClocks ? clocksFromStream(value.wc, value.bc) : null,
    };
  }
  const fen = str(value.fen);
  if (!fen) throw new ContractError('stream', 'registro sem fen');
  return { kind: 'move', fen, lastMove: str(value.lm), clocks: clocksFromStream(value.wc, value.bc) };
}
