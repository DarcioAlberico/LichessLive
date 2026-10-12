import type { TeamId, TournamentId, UserId } from '../../../domain/entities/ids';
import type { TeamStanding, TournamentInfo } from '../../../domain/entities/tournament';
import type { RankingEntry } from '../../../domain/ranking/batch';
import { ContractError } from '../../../shared/validate';
import type { ExportedGame, PublicUser } from '../schemas';
import {
  parseExportedGame,
  parsePublicUser,
  parseResultLine,
  parseTeamMember,
  parseTeamStandings,
  parseTournament,
} from '../schemas';
import { readNdjsonBody } from '../streams/ndjson';
import type { RestQueue } from './restQueue';
import { HttpError } from './restQueue';

/**
 * Cliente dos endpoints públicos usados pela extensão. Cada método monta a URL a partir de IDs já
 * validados; não existe método que aceite URL arbitrária (SPEC 12, T13).
 */

const API = 'https://lichess.org/api';

export const LIMITS = {
  /** Máximo de membros importados da lista pública (a fonte limita a 5000). */
  maxTeamMembers: 5000,
  /** Máximo de linhas de resultados por coleta. */
  maxResults: 1000,
} as const;

export interface ResultsCollection {
  entries: RankingEntry[];
  invalidLines: number;
  startedAt: number;
  endedAt: number;
  requestedNb: number;
}

export interface TeamMembersImport {
  members: { userId: UserId; username: string }[];
  truncated: boolean;
  invalidLines: number;
}

export class LichessClient {
  constructor(
    private readonly queue: RestQueue,
    private readonly now: () => number = Date.now,
  ) {}

  async tournament(
    id: TournamentId,
    opts: { signal?: AbortSignal; fresh?: boolean } = {},
  ): Promise<TournamentInfo> {
    if (opts.fresh) this.queue.invalidate(`tournament:${id}`);
    return this.queue.request(
      `tournament:${id}`,
      `${API}/tournament/${encodeURIComponent(id)}`,
      async (res) => parseTournament(await res.json(), this.now()),
      { ttlMs: 5_000, signal: opts.signal, headers: { Accept: 'application/json' } },
    );
  }

  async results(
    id: TournamentId,
    nb: number,
    opts: { signal?: AbortSignal } = {},
  ): Promise<ResultsCollection> {
    const requestedNb = Math.max(1, Math.min(LIMITS.maxResults, Math.floor(nb)));
    return this.queue.request(
      `results:${id}:${requestedNb}`,
      `${API}/tournament/${encodeURIComponent(id)}/results?nb=${requestedNb}&sheet=false`,
      async (res, signal) => {
        const startedAt = this.now();
        const entries: RankingEntry[] = [];
        let invalidLines = 0;
        if (!res.body) throw new ContractError('results', 'resposta sem corpo');
        await readNdjsonBody(
          res.body,
          (e) => {
            if (e.kind === 'invalidLine') invalidLines += 1;
            else if (e.kind === 'record') {
              const entry = parseResultLine(e.value);
              if (entry) entries.push(entry);
              else invalidLines += 1;
            }
          },
          { maxRecords: requestedNb, signal },
        );
        return { entries, invalidLines, startedAt, endedAt: this.now(), requestedNb };
      },
      { signal: opts.signal, headers: { Accept: 'application/x-ndjson' } },
    );
  }

  async teamStandings(id: TournamentId, opts: { signal?: AbortSignal } = {}): Promise<TeamStanding[]> {
    return this.queue.request(
      `teams:${id}`,
      `${API}/tournament/${encodeURIComponent(id)}/teams`,
      async (res) => parseTeamStandings(await res.json(), id),
      { ttlMs: 5_000, signal: opts.signal, headers: { Accept: 'application/json' } },
    );
  }

  async teamMembers(
    teamId: TeamId,
    opts: { signal?: AbortSignal; max?: number } = {},
  ): Promise<TeamMembersImport> {
    const max = Math.min(opts.max ?? LIMITS.maxTeamMembers, LIMITS.maxTeamMembers);
    return this.queue.request(
      `team-users:${teamId}`,
      `${API}/team/${encodeURIComponent(teamId)}/users`,
      async (res, signal) => {
        const members: { userId: UserId; username: string }[] = [];
        let invalidLines = 0;
        if (!res.body) throw new ContractError('team-users', 'resposta sem corpo');
        const { truncated } = await readNdjsonBody(
          res.body,
          (e) => {
            if (e.kind === 'invalidLine') invalidLines += 1;
            else if (e.kind === 'record') {
              const m = parseTeamMember(e.value);
              if (m) members.push(m);
              else invalidLines += 1;
            }
          },
          { maxRecords: max, signal },
        );
        return { members, truncated, invalidLines };
      },
      // Cache inicial de 24 horas é aplicado pelo repositório; aqui apenas deduplica.
      { signal: opts.signal, headers: { Accept: 'application/x-ndjson' } },
    );
  }

  async teamInfo(
    teamId: TeamId,
    opts: { signal?: AbortSignal } = {},
  ): Promise<{ teamId: TeamId; name: string; nbMembers: number | null }> {
    return this.queue.request(
      `team:${teamId}`,
      `${API}/team/${encodeURIComponent(teamId)}`,
      async (res) => {
        const json = (await res.json()) as Record<string, unknown>;
        const name = typeof json.name === 'string' ? json.name : teamId;
        const nb = typeof json.nbMembers === 'number' ? json.nbMembers : null;
        return { teamId, name, nbMembers: nb };
      },
      { ttlMs: 60_000, signal: opts.signal, headers: { Accept: 'application/json' } },
    );
  }

  /** Partida atual (ou a última) do jogador. Retorna null quando não há partida (404). */
  async currentGame(
    userId: UserId,
    opts: { signal?: AbortSignal; priority?: 'high' | 'normal' } = {},
  ): Promise<ExportedGame | null> {
    try {
      return await this.queue.request(
        `current-game:${userId}`,
        `${API}/user/${encodeURIComponent(userId)}/current-game?moves=false&pgnInJson=false&tags=false&clocks=false&evals=false&opening=false`,
        async (res) => parseExportedGame(await res.json()),
        {
          ttlMs: 3_000,
          signal: opts.signal,
          priority: opts.priority,
          headers: { Accept: 'application/json' },
        },
      );
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  }

  async publicUser(userId: UserId, opts: { signal?: AbortSignal } = {}): Promise<PublicUser | null> {
    try {
      return await this.queue.request(
        `user:${userId}`,
        `${API}/user/${encodeURIComponent(userId)}`,
        async (res) => parsePublicUser(await res.json()),
        { ttlMs: 60_000, signal: opts.signal, priority: 'high', headers: { Accept: 'application/json' } },
      );
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  }

  /** Histórico finito de partidas de um jogador no torneio (conferência sob demanda; nunca polling). */
  async tournamentGamesOf(
    id: TournamentId,
    userId: UserId,
    max = 5,
    opts: { signal?: AbortSignal } = {},
  ): Promise<ExportedGame[]> {
    return this.queue.request(
      `tournament-games:${id}:${userId}:${max}`,
      `${API}/tournament/${encodeURIComponent(id)}/games?player=${encodeURIComponent(userId)}&max=${Math.min(max, 30)}&moves=false&pgnInJson=false&clocks=false&evals=false&opening=false`,
      async (res, signal) => {
        const games: ExportedGame[] = [];
        if (!res.body) return games;
        await readNdjsonBody(
          res.body,
          (e) => {
            if (e.kind !== 'record') return;
            try {
              games.push(parseExportedGame(e.value));
            } catch {
              /* linha inválida ignorada */
            }
          },
          { maxRecords: max, signal },
        );
        return games;
      },
      { ttlMs: 10_000, signal: opts.signal, headers: { Accept: 'application/x-ndjson' } },
    );
  }
}
