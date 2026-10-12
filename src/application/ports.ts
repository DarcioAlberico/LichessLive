/** Portas abstratas da camada de aplicação: persistência, relógio e armazenamento de preferências. */
import type { GameId, TeamId, TournamentId, UserId } from '../domain/entities/ids';
import type {
  GameSelectionRecord,
  LayoutPreset,
  PhotoAsset,
  PlayerProfile,
  RankObservation,
  TeamProfile,
  TournamentSessionRecord,
  Watchlist,
} from '../domain/entities/profiles';
import type { TeamStanding, TournamentInfo, TournamentParticipant } from '../domain/entities/tournament';
import type { StreamState } from '../domain/entities/connection';
import type { GameStreamMessage } from '../domain/entities/game';
import type { RankingEntry } from '../domain/ranking/batch';
import type { ResolvedGame } from '../domain/selection/gameAssociation';
import type { Settings } from '../shared/settings';

export interface PlayerRepository {
  get(userId: UserId): Promise<PlayerProfile | undefined>;
  getMany(userIds: readonly UserId[]): Promise<Map<UserId, PlayerProfile>>;
  list(): Promise<PlayerProfile[]>;
  put(profile: PlayerProfile): Promise<void>;
  delete(userId: UserId): Promise<void>;
}

export interface PhotoRepository {
  get(photoId: string): Promise<PhotoAsset | undefined>;
  list(): Promise<PhotoAsset[]>;
  put(asset: PhotoAsset): Promise<void>;
  delete(photoId: string): Promise<void>;
  totalBytes(): Promise<number>;
}

export interface TeamRepository {
  get(teamId: TeamId): Promise<TeamProfile | undefined>;
  list(): Promise<TeamProfile[]>;
  put(team: TeamProfile): Promise<void>;
  delete(teamId: TeamId): Promise<void>;
}

export interface WatchlistRepository {
  get(teamId: TeamId, profileId?: string): Promise<Watchlist | undefined>;
  list(): Promise<Watchlist[]>;
  put(list: Watchlist): Promise<void>;
}

export interface SessionRepository {
  get(sessionId: string): Promise<TournamentSessionRecord | undefined>;
  latestForTournament(tournamentId: TournamentId): Promise<TournamentSessionRecord | undefined>;
  list(): Promise<TournamentSessionRecord[]>;
  put(session: TournamentSessionRecord): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

export interface SelectionRepository {
  get(sessionId: string): Promise<GameSelectionRecord | undefined>;
  put(selection: GameSelectionRecord): Promise<void>;
}

export interface ObservationRepository {
  addMany(observations: RankObservation[]): Promise<void>;
  list(sessionId: string, scope: string, referenceId: string): Promise<RankObservation[]>;
  countForSession(sessionId: string): Promise<number>;
  deleteForSession(sessionId: string): Promise<void>;
  deleteOlderThan(timestamp: number): Promise<number>;
}

export interface ParticipantRepository {
  putMany(participants: TournamentParticipant[]): Promise<void>;
  listForTournament(tournamentId: TournamentId): Promise<TournamentParticipant[]>;
}

export interface PresetRepository {
  list(): Promise<LayoutPreset[]>;
  get(presetId: string): Promise<LayoutPreset | undefined>;
  put(preset: LayoutPreset): Promise<void>;
  delete(presetId: string): Promise<void>;
}

export interface SettingsStore {
  get(): Promise<Settings>;
  update(patch: Partial<Settings>): Promise<Settings>;
}

export interface Repositories {
  players: PlayerRepository;
  photos: PhotoRepository;
  teams: TeamRepository;
  watchlists: WatchlistRepository;
  sessions: SessionRepository;
  selections: SelectionRepository;
  observations: ObservationRepository;
  participants: ParticipantRepository;
  presets: PresetRepository;
  settings: SettingsStore;
}

// ---------------------------------------------------------------- fontes de dados

export interface ResultsCollectionData {
  entries: RankingEntry[];
  invalidLines: number;
  startedAt: number;
  endedAt: number;
  requestedNb: number;
}

/** Porta para os contratos públicos do Lichess usados pela sessão. */
export interface LichessPort {
  tournament(id: TournamentId, opts?: { signal?: AbortSignal; fresh?: boolean }): Promise<TournamentInfo>;
  results(id: TournamentId, nb: number, opts?: { signal?: AbortSignal }): Promise<ResultsCollectionData>;
  teamStandings(id: TournamentId, opts?: { signal?: AbortSignal }): Promise<TeamStanding[]>;
  currentGame(
    userId: UserId,
    opts?: { signal?: AbortSignal; priority?: 'high' | 'normal' },
  ): Promise<ResolvedGame | null>;
}

export interface GameStreamSubscriber {
  onMessage(msg: GameStreamMessage): void;
  onState(state: StreamState): void;
  onDiagnostic(kind: 'invalidLine' | 'contract' | 'transport', message: string): void;
}

/** Porta para streams de partida; deduplica conexões do mesmo gameId. */
export interface GameStreamPort {
  subscribe(gameId: GameId, subscriber: GameStreamSubscriber): () => void;
}

/** Estado da fila REST exposto ao agendador. */
export interface RestStatusPort {
  pausedUntil(): number;
  frequencyFactor(): number;
  lastError(): string | null;
  lastSuccessAt(): number | null;
}
