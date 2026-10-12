import { vi } from 'vitest';
import type {
  GameStreamPort,
  GameStreamSubscriber,
  LichessPort,
  ResultsCollectionData,
} from '../../src/application/ports';
import type { SessionContext } from '../../src/application/session/tournamentSession';
import { TournamentSession } from '../../src/application/session/tournamentSession';
import { createMetrics, DiagnosticsLog } from '../../src/diagnostics';
import type { GameStatusName, GameStreamMessage } from '../../src/domain/entities/game';
import type { GameId, TeamId, TournamentId, UserId } from '../../src/domain/entities/ids';
import type { TournamentSessionRecord } from '../../src/domain/entities/profiles';
import type { TeamStanding, TournamentInfo } from '../../src/domain/entities/tournament';
import type { RankingEntry } from '../../src/domain/ranking/batch';
import { RULES_VERSION } from '../../src/domain/ranking/progress';
import type { ResolvedGame } from '../../src/domain/selection/gameAssociation';
import { clocksFromStream } from '../../src/domain/entities/clock';
import { openDatabase } from '../../src/persistence/db';
import { createRepositories } from '../../src/persistence';
import { MemorySettingsStore } from '../../src/persistence/repositories/settingsStore';
import { sanitizeSettings } from '../../src/shared/settings';
import { TID } from '../helpers';

export class FakeStreams implements GameStreamPort {
  subs = new Map<GameId, Set<GameStreamSubscriber>>();
  history: GameId[] = [];
  unsubscribed: GameId[] = [];
  subscribe(gameId: GameId, sub: GameStreamSubscriber) {
    this.history.push(gameId);
    const set = this.subs.get(gameId) ?? new Set();
    set.add(sub);
    this.subs.set(gameId, set);
    return () => {
      set.delete(sub);
      this.unsubscribed.push(gameId);
      if (set.size === 0) this.subs.delete(gameId);
    };
  }
  /** Entrega a mensagem a todos que já assinaram este gameId (inclusive assinaturas antigas). */
  emit(gameId: GameId, msg: GameStreamMessage) {
    for (const s of this.subs.get(gameId) ?? []) s.onMessage(msg);
  }
  /** Simula uma mensagem atrasada para um assinante que já saiu. */
  captured = new Map<GameId, GameStreamSubscriber[]>();
  active(): number {
    return [...this.subs.values()].reduce((n, s) => n + s.size, 0);
  }
}

export class FakeLichess implements LichessPort {
  info: TournamentInfo;
  resultsQueue: RankingEntry[][] = [];
  lastResults: RankingEntry[] = [];
  standings: TeamStanding[] = [];
  current = new Map<string, Promise<ResolvedGame | null> | ResolvedGame | null>();
  calls: string[] = [];
  constructor(info: Partial<TournamentInfo> = {}) {
    this.info = tournamentInfo(info);
  }
  async tournament() {
    this.calls.push('tournament');
    return { ...this.info, fetchedAt: Date.now() };
  }
  async results(_id: TournamentId, nb: number): Promise<ResultsCollectionData> {
    this.calls.push('results');
    const entries = this.resultsQueue.shift() ?? this.lastResults;
    this.lastResults = entries;
    const now = Date.now();
    return {
      entries: entries.slice(0, nb),
      invalidLines: 0,
      startedAt: now - 50,
      endedAt: now,
      requestedNb: nb,
    };
  }
  async teamStandings() {
    this.calls.push('teams');
    return this.standings.map((s) => ({ ...s }));
  }
  async currentGame(userId: UserId, opts?: { signal?: AbortSignal }) {
    this.calls.push(`current:${userId}`);
    const v = this.current.get(userId);
    const result = await Promise.resolve(v ?? null);
    if (opts?.signal?.aborted) throw new DOMException('Abortado', 'AbortError');
    return result;
  }
}

export function tournamentInfo(p: Partial<TournamentInfo> = {}): TournamentInfo {
  return {
    tournamentId: TID,
    name: 'Arena de Teste',
    format: 'arena',
    status: 'started',
    variant: 'standard',
    nbPlayers: 10,
    clock: { limitSeconds: 180, incrementSeconds: 0 },
    startsAt: null,
    secondsToFinish: 3600,
    secondsToStart: null,
    teams: [],
    nbLeaders: null,
    duels: [],
    featured: null,
    duelTeams: {},
    fetchedAt: Date.now(),
    ...p,
  };
}

export function resolved(
  gameId: string,
  white: string,
  black: string,
  status: ResolvedGame['status'],
  tournamentId: string | null = TID,
): ResolvedGame {
  const player = (n: string) => ({
    userId: n.toLowerCase() as UserId,
    name: n,
    title: null,
    rating: 1800,
    isAnonymous: false,
  });
  return {
    gameId: gameId as GameId,
    status,
    tournamentId: tournamentId as TournamentId | null,
    whiteUserId: white.toLowerCase() as UserId,
    blackUserId: black.toLowerCase() as UserId,
    white: player(white),
    black: player(black),
    winner: status === 'mate' ? 'white' : null,
    variant: 'standard',
  };
}

export function descriptor(
  gameId: string,
  white: string,
  black: string,
  opts: {
    tournamentId?: string | null;
    variant?: string;
    status?: GameStatusName | null;
    winner?: 'white' | 'black' | null;
    fen?: string;
  } = {},
): GameStreamMessage {
  const player = (n: string) => ({
    userId: n.toLowerCase() as UserId,
    name: n,
    title: null,
    rating: 1800,
    isAnonymous: false,
  });
  return {
    kind: 'descriptor',
    identity: {
      gameId: gameId as GameId,
      tournamentId: (opts.tournamentId === undefined ? TID : opts.tournamentId) as TournamentId | null,
      variant: opts.variant ?? 'standard',
      white: player(white),
      black: player(black),
      speed: 'blitz',
    },
    fen: opts.fen ?? null,
    lastMove: null,
    status: opts.status ?? null,
    winner: opts.winner ?? null,
    clocks: null,
  };
}

export const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

export function move(fen: string, lm: string | null = null, wc = 180, bc = 180): GameStreamMessage {
  return { kind: 'move', fen, lastMove: lm, clocks: clocksFromStream(wc, bc) };
}

let dbCounter = 0;

export async function makeHarness(
  opts: {
    info?: Partial<TournamentInfo>;
    teamId?: string | null;
    record?: Partial<TournamentSessionRecord>;
    dbName?: string;
  } = {},
) {
  const open = await openDatabase({ name: opts.dbName ?? `lts-test-${Date.now()}-${dbCounter++}` });
  const settingsStore = new MemorySettingsStore();
  const repos = createRepositories(open.db, settingsStore);
  const lichess = new FakeLichess(opts.info);
  const streams = new FakeStreams();
  const log = new DiagnosticsLog();
  const metrics = createMetrics();
  const ctx: SessionContext = {
    lichess,
    streams,
    rest: {
      pausedUntil: () => 0,
      frequencyFactor: () => 1,
      lastError: () => null,
      lastSuccessAt: () => null,
    },
    repos,
    log,
    metrics,
    now: () => Date.now(),
    monotonic: () => performance.now(),
    isRateLimitError: () => false,
    isAbortError: (e) => e instanceof DOMException && e.name === 'AbortError',
  };
  const record: TournamentSessionRecord = {
    sessionId: `s-${dbCounter}`,
    tournamentId: TID,
    type: 'unknown',
    teamId: (opts.teamId ?? null) as TeamId | null,
    startedAt: Date.now(),
    referenceMode: 'sessionStart',
    referenceId: `ref-${dbCounter}`,
    referenceMarkedAt: null,
    rulesVersion: RULES_VERSION,
    finishedAt: null,
    ...opts.record,
  };
  await repos.sessions.put(record);
  const settings = sanitizeSettings({});
  const make = (r: TournamentSessionRecord = record) => new TournamentSession(ctx, r, settings);
  const session = make();
  return { db: open.db, repos, lichess, streams, log, metrics, ctx, record, session, make, settings };
}

export async function settle(times = 5) {
  for (let i = 0; i < times; i++) await new Promise<void>((r) => setImmediate(r));
}

export { vi };
