import type { StreamState } from '../../domain/entities/connection';
import { describeMove } from '../../domain/entities/chess';
import { parseFen } from '../../domain/entities/fen';
import type {
  GameIdentity,
  GameOutcome,
  GamePosition,
  GameState,
  GameStreamMessage,
} from '../../domain/entities/game';
import { isFinishedStatus, SUPPORTED_VARIANTS } from '../../domain/entities/game';
import type { GameId, TeamId, TournamentId, UserId } from '../../domain/entities/ids';
import type {
  PlayerProfile,
  RankObservation,
  ReferenceMode,
  TournamentSessionRecord,
} from '../../domain/entities/profiles';
import type { TeamStanding, TournamentInfo, TournamentParticipant } from '../../domain/entities/tournament';
import type { RankingSnapshot } from '../../domain/ranking/batch';
import { rankAmongWatched, validateBatch } from '../../domain/ranking/batch';
import type { PlayerObservation, ProgressRow, ProgressScope } from '../../domain/ranking/progress';
import { computeProgress, RULES_VERSION } from '../../domain/ranking/progress';
import { ourTeamUserIds } from '../../domain/ranking/teamBattle';
import { associateGame, streamBelongsToTournament } from '../../domain/selection/gameAssociation';
import type { SelectionMode } from '../../domain/entities/profiles';
import type { SelectionState } from '../../domain/selection/selection';
import {
  beginResolve,
  beginSelection,
  commitSelection,
  dismissSuggestion,
  failSelection,
  flipOrientation,
  followUser,
  initialSelection,
  isCurrentGeneration,
  offerNewGame,
  pinCurrent,
  setAutoSwitch,
  setNotice,
  setOrientation,
} from '../../domain/selection/selection';
import type { DiagnosticsLog, Metrics } from '../../diagnostics';
import type { ProgramTab } from '../../shared/protocol/messages';
import type { Settings } from '../../shared/settings';
import { newId } from '../../shared/validate';
import type { GameStreamPort, LichessPort, Repositories, RestStatusPort } from '../ports';
import { TaskScheduler } from './scheduler';

export interface SessionContext {
  lichess: LichessPort;
  streams: GameStreamPort;
  rest: RestStatusPort;
  repos: Repositories;
  log: DiagnosticsLog;
  metrics: Metrics;
  now: () => number;
  monotonic: () => number;
  isRateLimitError: (err: unknown) => boolean;
  isAbortError: (err: unknown) => boolean;
}

export type GameListStatus = 'playing' | 'finished' | 'unknown';

/** Partida identificada no torneio. A cobertura é oportunista: não é a lista completa. */
export interface IdentifiedGame {
  gameId: GameId;
  players: { userId: UserId; name: string; rating: number | null; rank: number | null }[];
  status: GameListStatus;
  source: 'duels' | 'featured' | 'resolved' | 'stream';
  firstSeenAt: number;
  lastSeenAt: number;
}

interface LoadingGame {
  gameId: GameId;
  generation: number;
  streamToken: number;
  identity: GameIdentity | null;
  position: GamePosition | null;
  outcome: GameOutcome | null;
  explicit: boolean;
  startedMono: number;
  unlinked: boolean;
  previous: { gameId: GameId; mode: SelectionMode; followedUserId: UserId | null } | null;
}

export interface CollectionStatus {
  at: number;
  ok: boolean;
  problems: string[];
  durationMs: number;
}

const MAX_IDENTIFIED_GAMES = 400;

export class TournamentSession {
  record: TournamentSessionRecord;
  tournament: TournamentInfo | null = null;
  tournamentError: string | null = null;
  snapshot: RankingSnapshot | null = null;
  lastCollection: CollectionStatus | null = null;
  rejectedBatches = 0;
  teamStandings: TeamStanding[] | null = null;
  teamStandingsAt: number | null = null;
  watchlist: UserId[] = [];
  favorites: UserId[] = [];
  profiles = new Map<UserId, PlayerProfile>();
  teamNames = new Map<TeamId, string>();
  identifiedGames = new Map<GameId, IdentifiedGame>();
  selection: SelectionState = initialSelection();
  game: GameState | null = null;
  loading: LoadingGame | null = null;
  streamState: StreamState = { kind: 'idle' };
  lastStreamMessageAt: number | null = null;
  earlyOutcome: { gameId: GameId; outcome: GameOutcome; source: string } | null = null;
  progress = new Map<ProgressScope, ProgressRow[]>();
  hideResults = false;
  activeTab: ProgramTab = 'team';
  presetId = 'single-1080';
  /** Instante do primeiro dado de ranking da referência (rótulo "Progresso desde 20h10"). */
  referenceStartAt: number | null = null;
  /** Última verificação de partida de cada acompanhado (descoberta leve do team). */
  readonly teamScanAt = new Map<UserId, number>();

  private observations = new Map<ProgressScope, Map<UserId, PlayerObservation[]>>();
  private readonly listeners = new Set<(kind: ChangeKind) => void>();
  private streamUnsub: (() => void) | null = null;
  private streamToken = 0;
  private resolveController: AbortController | null = null;
  private readonly scheduler: TaskScheduler;
  private settings: Settings;
  private finalCollected = false;
  private disposed = false;
  private restoringPrevious = false;
  /** Partida e intenção do último pacote efetivamente exibido. */
  private lastCommitted: { gameId: GameId; mode: SelectionMode; followedUserId: UserId | null } | null = null;
  /** Instante da última troca de aba (manual ou automática), para a rotação. */
  private tabChangedAt = 0;
  private scanCursor = 0;

  constructor(
    private readonly ctx: SessionContext,
    record: TournamentSessionRecord,
    settings: Settings,
  ) {
    this.record = record;
    this.settings = settings;
    this.hideResults = settings.hideResultsDefault;
    this.activeTab = settings.lastTab;
    this.presetId = settings.activePresetId;
    this.tabChangedAt = ctx.now();
    this.selection = setAutoSwitch(this.selection, settings.autoSwitch);
    this.scheduler = new TaskScheduler({
      now: ctx.now,
      pausedUntil: () => ctx.rest.pausedUntil(),
      degraded: () =>
        (this.lastCollection?.ok === false && (this.lastCollection.durationMs ?? 0) > 20_000) ||
        ctx.rest.frequencyFactor() > 2,
      onError: (task, err) => this.onTaskError(task, err),
      isRateLimit: ctx.isRateLimitError,
    });
    this.scheduler.add({
      name: 'meta',
      interval: () => 60_000,
      enabled: () => !this.isFinalDone(),
      essential: true,
      run: () => this.refreshMeta(),
    });
    this.scheduler.add(
      {
        name: 'ranking',
        interval: () => this.settings.rankingIntervalSec * 1000 * ctx.rest.frequencyFactor(),
        enabled: () =>
          this.tournament !== null && this.tournament.status !== 'created' && !this.finalCollected,
        essential: true,
        run: () => this.collectRanking(),
      },
      1_500,
    );
    this.scheduler.add(
      {
        name: 'teams',
        interval: () => this.settings.teamsIntervalSec * 1000 * ctx.rest.frequencyFactor(),
        enabled: () =>
          this.tournament?.format === 'teamBattle' &&
          this.tournament.status !== 'created' &&
          !this.teamsFinalDone(),
        essential: false,
        run: () => this.collectTeams(),
      },
      (settings.rankingIntervalSec * 1000) / 2,
    );
    this.scheduler.add(
      {
        name: 'follow',
        interval: () => 20_000 * ctx.rest.frequencyFactor(),
        enabled: () => this.needsFollowCheck(),
        essential: false,
        run: () => this.followCheck(),
      },
      20_000,
    );
    // Descoberta leve das partidas do team: uma consulta serializada a cada ~8 s, em rodízio.
    this.scheduler.add(
      {
        name: 'teamScan',
        interval: () => 8_000 * ctx.rest.frequencyFactor(),
        enabled: () => this.tournament?.status === 'started' && this.trackedUserIds().length > 0,
        essential: false,
        run: () => this.teamScanStep(),
      },
      5_000,
    );
  }

  get tournamentId(): TournamentId {
    return this.record.tournamentId;
  }

  get sessionId(): string {
    return this.record.sessionId;
  }

  // ------------------------------------------------------------------ ciclo de vida

  async start(): Promise<void> {
    await this.reloadLocalData();
    await this.loadObservations();
    const saved = await this.ctx.repos.selections.get(this.sessionId);
    if (this.disposed) return;
    if (saved) {
      // A geração continua de onde parou: programas conectados ignoram gerações menores.
      this.selection = {
        ...this.selection,
        generation: Math.max(this.selection.generation, saved.generation),
        orientation: saved.orientation,
        orientationLocked: false,
      };
      // Restaurar a última intenção e resolver novamente a partida e as conexões (SPEC 3.3).
      if (saved.mode === 'follow' && saved.followedUserId) {
        void this.selectPlayer(saved.followedUserId, 'follow');
      } else if (saved.gameId) {
        const gid = saved.gameId as GameId;
        this.selectGame(gid, { followedUserId: saved.followedUserId, mode: saved.mode, explicit: true });
      }
    }
    this.scheduler.runSoon('meta');
    this.tick();
    this.emit('all');
  }

  tick(): void {
    if (this.disposed) return;
    this.scheduler.tick();
    this.maybeRotateTab();
  }

  /** Abas com conteúdo, na ordem de exibição (a rotação pula as vazias). */
  rotationTabs(): ProgramTab[] {
    const tracked = this.trackedUserIds().length > 0;
    const tabs: ProgramTab[] = [];
    if ([...this.identifiedGames.values()].some((g) => g.status === 'playing')) tabs.push('games');
    if (tracked) tabs.push('team');
    if (this.snapshot) tabs.push('ranking');
    if (tracked && this.snapshot) tabs.push('progress');
    if (this.tournament?.format === 'teamBattle' && (this.teamStandings?.length ?? 0) > 0) tabs.push('teams');
    return tabs;
  }

  private maybeRotateTab(): void {
    const sec = this.settings.rotateTabsSec;
    if (!sec) return;
    const now = this.ctx.now();
    if (now - this.tabChangedAt < sec * 1000) return;
    const tabs = this.rotationTabs();
    this.tabChangedAt = now;
    if (tabs.length < 2) return;
    const i = tabs.indexOf(this.activeTab);
    this.activeTab = tabs[(i + 1) % tabs.length]!;
    this.emit('layout');
  }

  dispose(): void {
    this.disposed = true;
    this.scheduler.dispose();
    this.closeStream();
    this.resolveController?.abort();
    this.listeners.clear();
  }

  onChange(listener: (kind: ChangeKind) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(kind: ChangeKind): void {
    for (const l of this.listeners) l(kind);
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
    this.selection = setAutoSwitch(this.selection, settings.autoSwitch);
    this.emit('all');
  }

  schedulerStatus() {
    return this.scheduler.status();
  }

  /** Pausa global por limitação de acesso (HTTP 429), em ms UTC; 0 quando não há pausa. */
  restPausedUntil(): number {
    return this.ctx.rest.pausedUntil();
  }

  get inPageShortcuts(): boolean {
    return this.settings.inPageShortcuts;
  }

  /** Atualização pedida pelo operador: antecipa metadados, classificação e placar (sem sobreposição). */
  requestRefresh(): void {
    this.scheduler.runSoon('meta');
    this.scheduler.runSoon('ranking', 500);
    this.scheduler.runSoon('teams', 1000);
    this.tick();
  }

  /** Recarrega cadastro local (acompanhados, fotos, teams) após mudanças nas configurações. */
  async reloadLocalData(): Promise<void> {
    const teamId = this.record.teamId;
    if (teamId) {
      const wl = await this.ctx.repos.watchlists.get(teamId);
      this.watchlist = wl ? [...wl.userIds] : [];
      this.favorites = wl ? [...wl.favorites] : [];
      const team = await this.ctx.repos.teams.get(teamId);
      if (team) this.teamNames.set(teamId, team.name);
    } else {
      this.watchlist = [];
      this.favorites = [];
    }
    const ids = new Set<UserId>(this.watchlist);
    for (const g of this.identifiedGames.values()) for (const p of g.players) ids.add(p.userId);
    if (this.game) {
      if (this.game.identity.white.userId) ids.add(this.game.identity.white.userId);
      if (this.game.identity.black.userId) ids.add(this.game.identity.black.userId);
    }
    if (this.snapshot) for (const e of this.snapshot.entries.slice(0, 50)) ids.add(e.userId);
    this.profiles = await this.ctx.repos.players.getMany([...ids]);
    // Acompanhados recém-adicionados recebem a observação da coleta vigente (aparecem como "Novo").
    if (this.snapshot) {
      await this.recordObservations(this.snapshot);
      this.recomputeProgress();
    }
    this.emit('profiles');
  }

  private async ensureProfiles(ids: (UserId | null)[]): Promise<void> {
    const missing = ids.filter((id): id is UserId => !!id && !this.profiles.has(id));
    if (missing.length === 0) return;
    const found = await this.ctx.repos.players.getMany(missing);
    if (found.size === 0) return;
    for (const [k, v] of found) this.profiles.set(k, v);
    this.emit('profiles');
  }

  // ------------------------------------------------------------------ contexto do torneio

  async setTeam(teamId: TeamId | null): Promise<void> {
    if (this.record.teamId === teamId) return;
    this.record = { ...this.record, teamId };
    await this.ctx.repos.sessions.put(this.record);
    await this.reloadLocalData();
    this.recomputeProgress();
    this.emit('all');
  }

  /** Escolha do team pela aba Teams do programa: só teams deste Team Battle. */
  async selectTournamentTeam(teamId: TeamId): Promise<boolean> {
    if (this.tournament?.format !== 'teamBattle') return false;
    if (!this.tournament.teams.some((t) => t.teamId === teamId)) return false;
    await this.setTeam(teamId);
    return true;
  }

  setTab(tab: ProgramTab): void {
    this.activeTab = tab;
    // Uma escolha manual reinicia a contagem da rotação.
    this.tabChangedAt = this.ctx.now();
    this.emit('layout');
  }

  get gamesOnlyTracked(): boolean {
    return this.settings.gamesOnlyTracked;
  }

  get tournamentClockLimitMs(): number | null {
    const c = this.tournament?.clock;
    return c ? c.limitSeconds * 1000 : null;
  }

  setHideResults(hide: boolean): void {
    this.hideResults = hide;
    this.emit('all');
  }

  setPreset(presetId: string): void {
    this.presetId = presetId;
    this.emit('layout');
  }

  private isFinalDone(): boolean {
    return this.tournament?.status === 'finished' && this.finalCollected && this.teamsFinalDone();
  }

  private teamsFinalDone(): boolean {
    return (
      this.tournament?.status === 'finished' &&
      this.teamStandingsAt !== null &&
      this.teamStandingsAt > (this.tournament.fetchedAt ?? 0)
    );
  }

  async refreshMeta(fresh = false): Promise<void> {
    const t0 = this.ctx.monotonic();
    let info: TournamentInfo;
    try {
      info = await this.ctx.lichess.tournament(this.tournamentId, { fresh });
    } catch (err) {
      this.tournamentError = err instanceof Error ? err.message : String(err);
      this.emit('meta');
      throw err;
    }
    this.tournamentError = null;
    const wasFinished = this.tournament?.status === 'finished';
    this.tournament = info;
    for (const t of info.teams) this.teamNames.set(t.teamId, t.name);
    if (
      this.record.type === 'unknown' ||
      this.record.type !== (info.format === 'teamBattle' ? 'teamBattle' : 'arena')
    ) {
      this.record = { ...this.record, type: info.format === 'teamBattle' ? 'teamBattle' : 'arena' };
      await this.ctx.repos.sessions.put(this.record);
    }
    this.absorbDuels(info);
    if (info.status === 'finished' && !wasFinished) {
      this.ctx.log.info('tournament', 'torneio encerrado; coletando classificação final');
      this.scheduler.runSoon('ranking');
      this.scheduler.runSoon('teams');
      if (!this.record.finishedAt) {
        this.record = { ...this.record, finishedAt: this.ctx.now() };
        await this.ctx.repos.sessions.put(this.record);
      }
    }
    this.ctx.log.info('rest', 'metadados do torneio', { durationMs: this.ctx.monotonic() - t0 });
    void this.ensureProfiles(info.duels.flatMap((d) => d.players.map((p) => p.userId)));
    this.emit('meta');
  }

  private absorbDuels(info: TournamentInfo): void {
    const now = this.ctx.now();
    const current = new Set<GameId>();
    for (const d of info.duels) {
      current.add(d.gameId);
      const prev = this.identifiedGames.get(d.gameId);
      this.identifiedGames.set(d.gameId, {
        gameId: d.gameId,
        players: d.players,
        status: 'playing',
        source: 'duels',
        firstSeenAt: prev?.firstSeenAt ?? now,
        lastSeenAt: now,
      });
    }
    if (info.featured) {
      const f = info.featured;
      current.add(f.gameId);
      const prev = this.identifiedGames.get(f.gameId);
      // O destaque não traz a colocação; a partida costuma estar também nos duelos, que trazem.
      const rankOf = (userId: UserId) => prev?.players.find((p) => p.userId === userId)?.rank ?? null;
      this.identifiedGames.set(f.gameId, {
        gameId: f.gameId,
        players: [
          {
            userId: f.white.userId,
            name: f.white.name,
            rating: f.white.rating,
            rank: rankOf(f.white.userId),
          },
          {
            userId: f.black.userId,
            name: f.black.name,
            rating: f.black.rating,
            rank: rankOf(f.black.userId),
          },
        ],
        status: 'playing',
        source: prev?.source ?? 'featured',
        firstSeenAt: prev?.firstSeenAt ?? now,
        lastSeenAt: now,
      });
    }
    // Partidas que saíram da lista da fonte: a fonte não confirma mais atividade.
    for (const g of this.identifiedGames.values()) {
      if (
        g.status === 'playing' &&
        !current.has(g.gameId) &&
        (g.source === 'duels' || g.source === 'featured')
      ) {
        g.status = 'unknown';
      }
    }
    this.pruneGames();
    // Acompanhar jogador: nova partida do mesmo torneio identificada.
    const followed = this.selection.mode === 'follow' ? this.selection.followedUserId : null;
    if (followed) {
      const game = info.duels.find((d) => d.players.some((p) => p.userId === followed));
      if (game) this.offerGame(followed, game.gameId);
    }
  }

  private pruneGames(): void {
    if (this.identifiedGames.size <= MAX_IDENTIFIED_GAMES) return;
    const removable = [...this.identifiedGames.values()]
      .filter((g) => g.status !== 'playing' && g.gameId !== this.game?.identity.gameId)
      .sort((a, b) => a.lastSeenAt - b.lastSeenAt);
    for (const g of removable) {
      if (this.identifiedGames.size <= MAX_IDENTIFIED_GAMES) break;
      this.identifiedGames.delete(g.gameId);
    }
  }

  // ------------------------------------------------------------------ classificação

  /** Usuários acompanhados nesta sessão (lista local + vínculo do team no Team Battle). */
  trackedUserIds(): UserId[] {
    return ourTeamUserIds(
      this.record.teamId,
      this.snapshot,
      this.watchlist,
      this.tournament?.format === 'teamBattle',
    );
  }

  async collectRanking(): Promise<void> {
    if (!this.tournament) return;
    const final = this.tournament.status === 'finished';
    const nb = Math.min(1000, Math.max(10, this.settings.rankingNb));
    const t0 = this.ctx.monotonic();
    const data = await this.ctx.lichess.results(this.tournamentId, nb);
    const batch = {
      collectionId: newId(),
      tournamentId: this.tournamentId,
      entries: data.entries,
      startedAt: data.startedAt,
      endedAt: data.endedAt,
      requestedNb: data.requestedNb,
      totalPlayers: this.tournament.nbPlayers,
      final,
      invalidLines: data.invalidLines,
    };
    const durationMs = this.ctx.monotonic() - t0;
    this.ctx.metrics.rankingCollection.add(durationMs);
    const result = validateBatch(batch);
    if (!result.ok) {
      this.rejectedBatches += 1;
      this.lastCollection = { at: this.ctx.now(), ok: false, problems: result.problems, durationMs };
      this.ctx.log.warn('ranking', 'lote rejeitado; mantido o último lote válido', {
        detail: result.problems.join('; '),
      });
      this.emit('ranking');
      return;
    }
    this.snapshot = result.snapshot;
    this.lastCollection = { at: this.ctx.now(), ok: true, problems: [], durationMs };
    if (data.invalidLines > 0)
      this.ctx.log.warn('ranking', `${data.invalidLines} linhas inválidas ignoradas`);
    if (final) this.finalCollected = true;
    this.ctx.log.info('ranking', final ? 'classificação final recebida' : 'coleta provisória publicada', {
      durationMs,
      coverage: `${result.snapshot.coverage.kind} ${result.snapshot.coverage.received}/${result.snapshot.coverage.total ?? '?'}`,
    });
    await this.recordObservations(result.snapshot);
    await this.persistParticipants(result.snapshot);
    void this.ensureProfiles(this.trackedUserIds());
    this.recomputeProgress();
    this.emit('ranking');
  }

  private async persistParticipants(snapshot: RankingSnapshot): Promise<void> {
    const tracked = new Set(this.trackedUserIds());
    const participants: TournamentParticipant[] = snapshot.entries
      .filter((e) => tracked.has(e.userId))
      .map((e) => ({
        tournamentId: this.tournamentId,
        userId: e.userId,
        username: e.username,
        title: e.title,
        rank: e.rank,
        score: e.score,
        rating: e.rating,
        performance: e.performance,
        tournamentTeamId: e.teamId,
      }));
    await this.ctx.repos.participants.putMany(participants).catch((err: unknown) => {
      this.ctx.log.warn('persistence', 'falha ao gravar participantes', { error: String(err) });
    });
  }

  private obsMap(scope: ProgressScope): Map<UserId, PlayerObservation[]> {
    let m = this.observations.get(scope);
    if (!m) {
      m = new Map();
      this.observations.set(scope, m);
    }
    return m;
  }

  private async loadObservations(): Promise<void> {
    this.observations.clear();
    this.referenceStartAt = null;
    for (const scope of ['general', 'watched'] as ProgressScope[]) {
      const rows = await this.ctx.repos.observations.list(this.sessionId, scope, this.record.referenceId);
      const m = this.obsMap(scope);
      for (const r of rows) {
        if (r.rulesVersion !== RULES_VERSION || r.tournamentId !== this.tournamentId) continue;
        const list = m.get(r.userId) ?? [];
        list.push({
          collectionId: r.collectionId,
          rank: r.rank,
          score: r.score,
          inCut: r.inCut,
          endedAt: r.endedAt,
        });
        m.set(r.userId, list);
        if (scope === 'general' && (this.referenceStartAt === null || r.endedAt < this.referenceStartAt))
          this.referenceStartAt = r.endedAt;
      }
    }
  }

  private async recordObservations(
    snapshot: RankingSnapshot,
    override?: { collectionId: string; endedAt: number },
  ): Promise<void> {
    const tracked = this.trackedUserIds();
    if (tracked.length === 0) return;
    const relative = rankAmongWatched(snapshot, tracked);
    const collectionId = override?.collectionId ?? snapshot.collectionId;
    const endedAt = override?.endedAt ?? snapshot.endedAt;
    const rows: RankObservation[] = [];
    for (const userId of tracked) {
      const entry = snapshot.byUser.get(userId);
      const common = {
        sessionId: this.sessionId,
        referenceId: this.record.referenceId,
        rulesVersion: RULES_VERSION,
        collectionId,
        tournamentId: this.tournamentId,
        userId,
        source: snapshot.provisional ? ('results-live' as const) : ('results-final' as const),
        startedAt: snapshot.startedAt,
        endedAt,
        provisional: snapshot.provisional,
      };
      rows.push({
        ...common,
        scope: 'general',
        rank: entry?.rank ?? null,
        score: entry?.score ?? null,
        inCut: !!entry,
      });
      const rel = relative.get(userId);
      rows.push({
        ...common,
        scope: 'watched',
        rank: rel ?? null,
        score: entry?.score ?? null,
        inCut: rel !== undefined,
      });
    }
    // Uma observação por coleta e por jogador: registros repetidos da mesma coleta são ignorados.
    const fresh: RankObservation[] = [];
    for (const r of rows) {
      const m = this.obsMap(r.scope as ProgressScope);
      const list = m.get(r.userId) ?? [];
      if (!list.some((o) => o.collectionId === r.collectionId)) {
        list.push({
          collectionId: r.collectionId,
          rank: r.rank,
          score: r.score,
          inCut: r.inCut,
          endedAt: r.endedAt,
        });
        m.set(r.userId, list);
        fresh.push(r);
      }
    }
    if (fresh.length === 0) return;
    if (this.referenceStartAt === null) this.referenceStartAt = endedAt;
    try {
      await this.ctx.repos.observations.addMany(fresh);
    } catch (err) {
      this.ctx.log.error('persistence', 'falha ao gravar observações', { error: String(err) });
    }
  }

  isRankingStale(): boolean {
    if (!this.snapshot) return false;
    if (this.lastCollection && !this.lastCollection.ok) return true;
    if (this.finalCollected) return false;
    const interval = this.settings.rankingIntervalSec * 1000 * this.ctx.rest.frequencyFactor();
    return this.ctx.now() - this.snapshot.endedAt > Math.max(90_000, interval * 2.5);
  }

  recomputeProgress(): void {
    const stale = this.isRankingStale();
    const tracked = this.trackedUserIds();
    const mode = this.record.referenceMode;
    const markedAt = this.record.referenceMarkedAt;
    for (const scope of ['general', 'watched'] as ProgressScope[]) {
      const m = this.obsMap(scope);
      const rows = tracked.map((userId) => {
        let history = m.get(userId) ?? [];
        if (mode === 'manualMark' && markedAt !== null) {
          // A referência começa na observação registrada no instante da marcação.
          const idx = history.findIndex((o) => o.collectionId.startsWith('mark-') && o.endedAt === markedAt);
          history = idx >= 0 ? history.slice(idx) : history.filter((o) => o.endedAt >= markedAt);
        }
        return computeProgress({
          userId,
          history,
          mode,
          stale,
          latestCollectionId: this.snapshot?.collectionId ?? null,
        });
      });
      this.progress.set(scope, rows);
    }
  }

  /** Muda o modo de referência. Os registros da referência atual são preservados. */
  async setReferenceMode(mode: ReferenceMode): Promise<void> {
    // A marcação é estritamente posterior à última coleta, mesmo no mesmo milissegundo.
    const now = Math.max(this.ctx.now(), (this.snapshot?.endedAt ?? 0) + 1);
    this.record = {
      ...this.record,
      referenceMode: mode,
      referenceMarkedAt: mode === 'manualMark' ? now : null,
    };
    await this.ctx.repos.sessions.put(this.record);
    if (mode === 'manualMark' && this.snapshot) {
      await this.recordObservations(this.snapshot, { collectionId: `mark-${newId()}`, endedAt: now });
    }
    this.ctx.log.info('progress', `referência: ${mode}`);
    this.recomputeProgress();
    this.emit('ranking');
  }

  /** Marca nova referência agora (registra ação e instante). */
  markReference(): Promise<void> {
    return this.setReferenceMode('manualMark');
  }

  /** Inicia nova referência (ex.: mudança de política de ranking), preservando a anterior. */
  async newReference(): Promise<void> {
    this.record = { ...this.record, referenceId: newId(), referenceMarkedAt: null };
    await this.ctx.repos.sessions.put(this.record);
    await this.loadObservations();
    if (this.snapshot) await this.recordObservations(this.snapshot);
    this.recomputeProgress();
    this.emit('ranking');
  }

  async collectTeams(): Promise<void> {
    const standings = await this.ctx.lichess.teamStandings(this.tournamentId);
    for (const s of standings) s.name = this.teamNames.get(s.teamId) ?? s.teamId;
    this.teamStandings = standings;
    this.teamStandingsAt = this.ctx.now();
    this.emit('ranking');
  }

  // ------------------------------------------------------------------ seleção de partidas

  /** Seleciona uma partida pelo gameId (clique em Partidas, entrada manual ou resolução). */
  selectGame(
    gameId: GameId,
    opts: {
      followedUserId?: UserId | null;
      mode?: SelectionMode;
      explicit?: boolean;
      restore?: boolean;
    } = {},
  ): void {
    if (this.disposed) return;
    this.resolveController?.abort();
    this.resolveController = null;
    // Restaura a última intenção efetivamente exibida, não a seleção já sobrescrita.
    const previous = this.game && !opts.restore ? this.lastCommitted : null;
    this.selection = beginSelection(this.selection, {
      gameId,
      followedUserId: opts.followedUserId ?? null,
      mode: opts.mode ?? 'pinned',
      now: this.ctx.now(),
    });
    if (this.earlyOutcome?.gameId !== gameId) this.earlyOutcome = null;
    this.openStream(gameId, this.selection.generation, opts.explicit ?? true, previous);
    void this.persistSelection();
    this.emit('selection');
  }

  /** Resolve a partida atual de um jogador (Nosso team / Classificação). */
  async selectPlayer(userId: UserId, mode: SelectionMode = 'follow'): Promise<void> {
    const known = this.findPlayingGame(userId);
    if (known) {
      this.selectGame(known.gameId, { followedUserId: userId, mode, explicit: false });
      return;
    }
    this.resolveController?.abort();
    const controller = new AbortController();
    this.resolveController = controller;
    this.selection = beginResolve(this.selection, userId, mode);
    const generation = this.selection.generation;
    void this.persistSelection();
    this.emit('selection');
    try {
      const game = await this.ctx.lichess.currentGame(userId, {
        signal: controller.signal,
        priority: 'high',
      });
      if (!isCurrentGeneration(this.selection, generation) || this.disposed) return;
      if (!game) {
        this.selection = setNotice(this.selection, generation, { kind: 'notFound', userId });
        this.emit('selection');
        return;
      }
      const assoc = associateGame(game, userId, this.tournamentId);
      switch (assoc.kind) {
        case 'current':
          this.registerResolvedGame(game.gameId, game.white, game.black, 'playing');
          this.selectGame(assoc.gameId, { followedUserId: userId, mode, explicit: false });
          return;
        case 'lastFinished':
          this.registerResolvedGame(game.gameId, game.white, game.black, 'finished');
          this.selection = setNotice(this.selection, generation, {
            kind: 'noCurrentGame',
            userId,
            lastGameId: assoc.gameId,
          });
          break;
        case 'otherTournament':
          this.selection = setNotice(this.selection, generation, {
            kind: 'otherTournament',
            userId,
            gameId: assoc.gameId,
          });
          break;
        case 'unlinked':
          this.selection = setNotice(this.selection, generation, {
            kind: 'unlinked',
            userId,
            gameId: assoc.gameId,
          });
          break;
        case 'playerMismatch':
          this.selection = setNotice(this.selection, generation, { kind: 'notFound', userId });
          break;
      }
      this.emit('selection');
    } catch (err) {
      if (this.ctx.isAbortError(err) || !isCurrentGeneration(this.selection, generation)) return;
      this.selection = setNotice(this.selection, generation, {
        kind: 'error',
        message: this.ctx.isRateLimitError(err)
          ? 'Limitação de acesso: tente após a pausa'
          : 'Falha ao consultar a partida atual',
      });
      this.ctx.log.warn('selection', 'falha na resolução de jogador', { error: String(err) });
      this.emit('selection');
    }
  }

  /** Abre a última partida encerrada como replay, quando oferecida. */
  acceptReplay(): void {
    const n = this.selection.notice;
    if (n?.kind === 'noCurrentGame' && n.lastGameId) {
      this.selectGame(n.lastGameId, { followedUserId: n.userId, mode: 'replay', explicit: true });
    }
  }

  /** Abre explicitamente uma partida sem vínculo confirmado (escolha do operador). */
  acceptUnlinked(): void {
    const n = this.selection.notice;
    if (n?.kind === 'unlinked')
      this.selectGame(n.gameId, { followedUserId: n.userId, mode: 'pinned', explicit: true });
  }

  acceptSuggestion(): void {
    const s = this.selection.suggestion;
    if (s) this.selectGame(s.gameId, { followedUserId: s.forUserId, mode: 'follow', explicit: false });
  }

  dismissSuggestion(): void {
    this.selection = dismissSuggestion(this.selection);
    this.emit('selection');
  }

  flip(): void {
    this.selection = flipOrientation(this.selection);
    void this.persistSelection();
    this.emit('selection');
  }

  pin(): void {
    this.selection = pinCurrent(this.selection);
    if (this.lastCommitted) this.lastCommitted = { ...this.lastCommitted, mode: this.selection.mode };
    void this.persistSelection();
    this.emit('selection');
  }

  follow(userId: UserId): void {
    this.selection = followUser(this.selection, userId);
    if (this.lastCommitted)
      this.lastCommitted = { ...this.lastCommitted, mode: 'follow', followedUserId: userId };
    void this.persistSelection();
    this.scheduler.runSoon('follow', 1000);
    this.emit('selection');
  }

  setAutoSwitch(value: boolean): void {
    this.selection = setAutoSwitch(this.selection, value);
    this.emit('selection');
  }

  /**
   * Vai para a próxima partida em andamento com jogador acompanhado (ordem pela melhor posição),
   * acompanhando esse jogador. Sem partidas conhecidas, antecipa a descoberta do team.
   */
  async nextTeamGame(): Promise<'switched' | 'only' | 'none'> {
    const tracked = new Set(this.trackedUserIds());
    const rankOf = (u: UserId) => this.snapshot?.byUser.get(u)?.rank ?? 1e9;
    const live = [...this.identifiedGames.values()]
      .filter((g) => g.status === 'playing' && g.players.some((p) => tracked.has(p.userId)))
      .map((g) => {
        const best = g.players
          .filter((p) => tracked.has(p.userId))
          .sort((a, b) => rankOf(a.userId) - rankOf(b.userId))[0]!;
        return { gameId: g.gameId, best: best.userId };
      })
      .sort((a, b) => rankOf(a.best) - rankOf(b.best) || a.gameId.localeCompare(b.gameId));
    if (live.length === 0) {
      this.scheduler.runSoon('teamScan');
      this.ctx.log.info('selection', 'nenhuma partida do team conhecida; descoberta antecipada');
      return 'none';
    }
    const current = this.selection.gameId;
    const i = live.findIndex((x) => x.gameId === current);
    const next = live[(i + 1) % live.length]!;
    if (next.gameId === current) return 'only';
    this.selectGame(next.gameId, { followedUserId: next.best, mode: 'follow', explicit: false });
    return 'switched';
  }

  /** Um passo da descoberta: consulta a partida atual do próximo acompanhado no rodízio. */
  private async teamScanStep(): Promise<void> {
    const rankOf = (u: UserId) => this.snapshot?.byUser.get(u)?.rank ?? 1e9;
    const tracked = this.trackedUserIds().sort((a, b) => rankOf(a) - rankOf(b));
    const n = tracked.length;
    for (let k = 0; k < n; k++) {
      const userId = tracked[(this.scanCursor + k) % n]!;
      // Partidas vindas dos duelos do torneio já são atualizadas pelos metadados.
      if (this.findPlayingGame(userId)?.source === 'duels') continue;
      this.scanCursor = (this.scanCursor + k + 1) % n;
      await this.checkPlayerGame(userId);
      return;
    }
  }

  private async checkPlayerGame(userId: UserId): Promise<void> {
    const game = await this.ctx.lichess.currentGame(userId, { priority: 'normal' });
    this.teamScanAt.set(userId, this.ctx.now());
    // Partidas resolvidas antes e que não são a atual deixam de ser apresentadas como "em andamento".
    const settle = (keep: GameId | null) => {
      for (const g of this.identifiedGames.values()) {
        if (
          g.status === 'playing' &&
          g.source === 'resolved' &&
          g.gameId !== keep &&
          g.players.some((p) => p.userId === userId)
        ) {
          g.status = 'unknown';
        }
      }
    };
    if (!game) {
      settle(null);
      this.emit('meta');
      return;
    }
    const assoc = associateGame(game, userId, this.tournamentId);
    if (assoc.kind === 'current') {
      settle(assoc.gameId);
      this.registerResolvedGame(game.gameId, game.white, game.black, 'playing');
    } else {
      settle(null);
      if (assoc.kind === 'lastFinished') {
        const known = this.identifiedGames.get(assoc.gameId);
        if (known) known.status = 'finished';
      }
    }
    this.emit('meta');
  }

  findPlayingGame(userId: UserId): IdentifiedGame | undefined {
    let best: IdentifiedGame | undefined;
    for (const g of this.identifiedGames.values()) {
      if (g.status !== 'playing' || !g.players.some((p) => p.userId === userId)) continue;
      if (!best || g.lastSeenAt > best.lastSeenAt) best = g;
    }
    return best;
  }

  private registerResolvedGame(
    gameId: GameId,
    white: { userId: UserId | null; name: string; rating: number | null },
    black: { userId: UserId | null; name: string; rating: number | null },
    status: GameListStatus,
  ): void {
    if (!white.userId || !black.userId) return;
    const now = this.ctx.now();
    const prev = this.identifiedGames.get(gameId);
    this.identifiedGames.set(gameId, {
      gameId,
      players: [
        {
          userId: white.userId,
          name: white.name,
          rating: white.rating,
          rank: this.snapshot?.byUser.get(white.userId)?.rank ?? null,
        },
        {
          userId: black.userId,
          name: black.name,
          rating: black.rating,
          rank: this.snapshot?.byUser.get(black.userId)?.rank ?? null,
        },
      ],
      status,
      source: prev?.source ?? 'resolved',
      firstSeenAt: prev?.firstSeenAt ?? now,
      lastSeenAt: now,
    });
    this.pruneGames();
  }

  private offerGame(userId: UserId, gameId: GameId): void {
    const { state, action } = offerNewGame(this.selection, userId, gameId, this.ctx.now());
    this.selection = state;
    if (action === 'switch') {
      this.ctx.log.info('selection', 'troca automática para nova partida do jogador acompanhado');
      this.selectGame(gameId, { followedUserId: userId, mode: 'follow', explicit: false });
    } else if (action === 'suggest') {
      this.ctx.log.info('selection', 'nova partida do jogador acompanhado sugerida');
      this.emit('selection');
    }
  }

  private needsFollowCheck(): boolean {
    if (this.selection.mode !== 'follow' || !this.selection.followedUserId) return false;
    if (this.selection.pending || this.selection.notice?.kind === 'resolving') return false;
    if (this.tournament?.status === 'finished') return false;
    const g = this.game;
    if (!g || g.identity.gameId !== this.selection.gameId) return true;
    return isFinishedStatus(g.status) || this.streamState.kind === 'ended';
  }

  /** Verificação serializada da próxima partida do jogador acompanhado. */
  private async followCheck(): Promise<void> {
    const userId = this.selection.followedUserId;
    if (!userId) return;
    const generation = this.selection.generation;
    const game = await this.ctx.lichess.currentGame(userId, { priority: 'normal' });
    if (!game || !isCurrentGeneration(this.selection, generation)) return;
    const assoc = associateGame(game, userId, this.tournamentId);
    if (assoc.kind === 'current') {
      this.registerResolvedGame(game.gameId, game.white, game.black, 'playing');
      this.offerGame(userId, assoc.gameId);
    } else if (
      assoc.kind === 'lastFinished' &&
      this.game?.identity.gameId === assoc.gameId &&
      !this.game.outcome
    ) {
      // Resultado conhecido antes do tabuleiro atrasado: apenas para o operador.
      this.earlyOutcome = {
        gameId: assoc.gameId,
        outcome: { status: game.status, winner: game.winner },
        source: 'current-game',
      };
      this.emit('selection');
    }
  }

  // ------------------------------------------------------------------ stream da partida

  private openStream(
    gameId: GameId,
    generation: number,
    explicit: boolean,
    previous: LoadingGame['previous'],
  ): void {
    if (this.disposed) return;
    // Encerra o stream anterior antes de solicitar outro (orçamento de conexões).
    this.closeStream();
    const token = ++this.streamToken;
    this.loading = {
      gameId,
      generation,
      streamToken: token,
      identity: null,
      position: null,
      outcome: null,
      explicit,
      startedMono: this.ctx.monotonic(),
      unlinked: false,
      previous,
    };
    this.streamState = { kind: 'connecting', since: this.ctx.now() };
    this.streamUnsub = this.ctx.streams.subscribe(gameId, {
      onMessage: (msg) => this.onStreamMessage(token, msg),
      onState: (state) => {
        if (token !== this.streamToken) return;
        this.streamState = state;
        if (state.kind === 'error' && this.loading?.streamToken === token) {
          this.failLoading({ kind: 'invalidGame', gameId, reason: state.error });
        }
        this.emit('stream');
      },
      onDiagnostic: (kind, message) => {
        if (token !== this.streamToken) return;
        const level = kind === 'contract' ? 'error' : 'warn';
        this.ctx.log.log(level, 'stream', kind, { detail: message });
      },
    });
  }

  private closeStream(): void {
    this.streamUnsub?.();
    this.streamUnsub = null;
    this.streamToken += 1;
  }

  private failLoading(notice: Parameters<typeof failSelection>[2]): void {
    const loading = this.loading;
    if (!loading) return;
    this.selection = failSelection(this.selection, loading.generation, notice);
    this.loading = null;
    this.closeStream();
    this.streamState = { kind: 'idle' };
    this.ctx.log.warn('selection', 'carga de partida recusada', { detail: notice.kind });
    // Mantém o tabuleiro anterior atualizado: reabre a partida anterior uma única vez.
    const prev = loading.previous;
    if (prev && !this.restoringPrevious) {
      this.restoringPrevious = true;
      const keptNotice = this.selection.notice;
      this.selectGame(prev.gameId, {
        followedUserId: prev.followedUserId,
        mode: prev.mode,
        explicit: true,
        restore: true,
      });
      this.selection = { ...this.selection, notice: keptNotice };
      this.restoringPrevious = false;
    }
    this.emit('selection');
  }

  private onStreamMessage(token: number, msg: GameStreamMessage): void {
    if (token !== this.streamToken || this.disposed) return;
    this.lastStreamMessageAt = this.ctx.now();
    const loading = this.loading;
    if (loading && loading.streamToken === token) {
      this.applyToLoading(loading, msg);
      return;
    }
    const game = this.game;
    if (!game) return;
    if (msg.kind === 'move') {
      const pos = this.toPosition(msg.fen, msg.lastMove, msg.clocks, game.position);
      if (pos) {
        this.game = { ...game, position: pos };
        this.emit('board');
      }
    } else {
      this.applyDescriptor(game, msg);
    }
  }

  private applyDescriptor(game: GameState, msg: Extract<GameStreamMessage, { kind: 'descriptor' }>): void {
    let next: GameState = game;
    if (msg.fen) {
      const pos = this.toPosition(
        msg.fen,
        msg.lastMove,
        msg.clocks ?? game.position?.clocks ?? null,
        game.position,
      );
      if (pos) next = { ...next, position: pos };
    }
    if (msg.status) {
      next = { ...next, status: msg.status };
      if (isFinishedStatus(msg.status)) {
        next = { ...next, outcome: { status: msg.status, winner: msg.winner } };
        const g = this.identifiedGames.get(game.identity.gameId);
        if (g) g.status = 'finished';
        this.earlyOutcome = null;
        this.ctx.log.info('stream', 'resultado recebido pela fonte do tabuleiro');
      }
    }
    this.game = next;
    this.emit('board');
  }

  private toPosition(
    fen: string,
    lastMove: string | null,
    clocks: GamePosition['clocks'] | null,
    previous: GamePosition | null = null,
  ): GamePosition | null {
    const parsed = parseFen(fen);
    if (!parsed.ok) {
      this.ctx.log.warn('stream', 'FEN inválida descartada', { detail: parsed.error });
      return null;
    }
    let move: GamePosition['move'] = null;
    if (previous && previous.fen === parsed.fen) {
      // Mesma posição repetida (ex.: descrição final): mantém a notação já conferida.
      move = previous.move ?? null;
    } else if (previous && lastMove) {
      const d = describeMove(previous.fen, lastMove, parsed.fen);
      move = d ? { label: d.label, side: d.side } : null;
    }
    return {
      fen: parsed.fen,
      lastMove,
      clocks: clocks ?? { whiteMs: null, blackMs: null, unit: 'seconds', anchoredToPosition: true },
      receivedAt: this.ctx.now(),
      move,
    };
  }

  private applyToLoading(loading: LoadingGame, msg: GameStreamMessage): void {
    if (msg.kind === 'descriptor') {
      if (!SUPPORTED_VARIANTS.has(msg.identity.variant)) {
        this.failLoading({
          kind: 'unsupportedVariant',
          gameId: loading.gameId,
          variant: msg.identity.variant,
        });
        return;
      }
      const belongs = streamBelongsToTournament(msg.identity.tournamentId, this.tournamentId);
      if (belongs === 'other') {
        // Nunca exibir silenciosamente uma partida de outro torneio.
        this.failLoading({
          kind: 'otherTournament',
          userId: this.selection.followedUserId,
          gameId: loading.gameId,
        });
        return;
      }
      if (belongs === 'unknown') {
        if (!loading.explicit) {
          this.failLoading({
            kind: 'unlinked',
            userId: this.selection.followedUserId,
            gameId: loading.gameId,
          });
          return;
        }
        loading.unlinked = true;
      }
      loading.identity = msg.identity;
      if (msg.fen) {
        const pos = this.toPosition(msg.fen, msg.lastMove, msg.clocks, loading.position);
        if (pos) loading.position = pos;
      }
      if (msg.status && isFinishedStatus(msg.status))
        loading.outcome = { status: msg.status, winner: msg.winner };
    } else {
      const pos = this.toPosition(msg.fen, msg.lastMove, msg.clocks, loading.position);
      if (pos) loading.position = pos;
    }
    if (loading.identity && loading.position) this.commitLoading(loading);
  }

  private commitLoading(loading: LoadingGame): void {
    if (!isCurrentGeneration(this.selection, loading.generation)) return;
    const identity = loading.identity!;
    this.game = {
      identity,
      position: loading.position,
      status: loading.outcome?.status ?? 'started',
      outcome: loading.outcome,
      source: 'api-stream',
      generation: loading.generation,
    };
    this.selection = commitSelection(this.selection, loading.generation);
    if (loading.unlinked) {
      this.selection = {
        ...this.selection,
        notice: { kind: 'unlinked', userId: this.selection.followedUserId, gameId: loading.gameId },
      };
    }
    const followed = this.selection.followedUserId;
    if (followed) {
      const orientation = identity.black.userId === followed ? 'black' : 'white';
      this.selection = setOrientation(this.selection, orientation, false);
    }
    this.loading = null;
    this.lastCommitted = {
      gameId: identity.gameId,
      mode: this.selection.mode,
      followedUserId: this.selection.followedUserId,
    };
    this.ctx.metrics.switchToBoard.add(this.ctx.monotonic() - loading.startedMono);
    this.registerResolvedGame(
      identity.gameId,
      identity.white,
      identity.black,
      loading.outcome ? 'finished' : 'playing',
    );
    void this.ensureProfiles([identity.white.userId, identity.black.userId]);
    void this.persistSelection();
    this.emit('selection');
  }

  private async persistSelection(): Promise<void> {
    const s = this.selection;
    try {
      await this.ctx.repos.selections.put({
        sessionId: this.sessionId,
        gameId: s.gameId,
        followedUserId: s.followedUserId,
        mode: s.mode,
        orientation: s.orientation,
        generation: s.generation,
        updatedAt: this.ctx.now(),
      });
    } catch (err) {
      this.ctx.log.warn('persistence', 'falha ao gravar seleção', { error: String(err) });
    }
  }

  private onTaskError(task: string, err: unknown): void {
    if (this.ctx.isAbortError(err)) return;
    const message = err instanceof Error ? err.message : String(err);
    if (task === 'ranking') {
      this.lastCollection = { at: this.ctx.now(), ok: false, problems: [message], durationMs: 0 };
      this.recomputeProgress();
    }
    this.ctx.log.warn(task, 'falha na tarefa', { error: message });
    this.emit('ranking');
  }
}

export type ChangeKind =
  'all' | 'meta' | 'ranking' | 'selection' | 'board' | 'stream' | 'layout' | 'profiles';
