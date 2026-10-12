import type {
  ObservationRepository,
  ParticipantRepository,
  PhotoRepository,
  PlayerRepository,
  PresetRepository,
  SelectionRepository,
  SessionRepository,
  TeamRepository,
  WatchlistRepository,
} from '../../application/ports';
import type { TeamId, TournamentId, UserId } from '../../domain/entities/ids';
import type {
  GameSelectionRecord,
  LayoutPreset,
  PhotoAsset,
  PlayerProfile,
  RankObservation,
  TeamProfile,
  TournamentSessionRecord,
  Watchlist,
} from '../../domain/entities/profiles';
import type { TournamentParticipant } from '../../domain/entities/tournament';
import { req, txDone } from '../db';
import { STORES } from '../migrations';

type StoreName = (typeof STORES)[keyof typeof STORES];

class Base {
  constructor(protected readonly db: IDBDatabase) {}

  protected async getOne<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    const tx = this.db.transaction(store, 'readonly');
    return (await req(tx.objectStore(store).get(key))) as T | undefined;
  }

  protected async getAll<T>(store: StoreName): Promise<T[]> {
    const tx = this.db.transaction(store, 'readonly');
    return (await req(tx.objectStore(store).getAll())) as T[];
  }

  protected async putOne(store: StoreName, value: unknown): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    await txDone(tx);
  }

  protected async deleteOne(store: StoreName, key: IDBValidKey): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await txDone(tx);
  }
}

export class IdbPlayerRepository extends Base implements PlayerRepository {
  get(userId: UserId) {
    return this.getOne<PlayerProfile>(STORES.players, userId);
  }
  async getMany(userIds: readonly UserId[]) {
    const tx = this.db.transaction(STORES.players, 'readonly');
    const store = tx.objectStore(STORES.players);
    const out = new Map<UserId, PlayerProfile>();
    await Promise.all(
      [...new Set(userIds)].map(async (id) => {
        const p = (await req(store.get(id))) as PlayerProfile | undefined;
        if (p) out.set(id, p);
      }),
    );
    return out;
  }
  list() {
    return this.getAll<PlayerProfile>(STORES.players);
  }
  put(profile: PlayerProfile) {
    return this.putOne(STORES.players, profile);
  }
  delete(userId: UserId) {
    return this.deleteOne(STORES.players, userId);
  }
}

export class IdbPhotoRepository extends Base implements PhotoRepository {
  get(photoId: string) {
    return this.getOne<PhotoAsset>(STORES.photos, photoId);
  }
  list() {
    return this.getAll<PhotoAsset>(STORES.photos);
  }
  put(asset: PhotoAsset) {
    return this.putOne(STORES.photos, asset);
  }
  delete(photoId: string) {
    return this.deleteOne(STORES.photos, photoId);
  }
  async totalBytes() {
    const all = await this.list();
    return all.reduce((sum, p) => sum + (p.blob?.size ?? 0), 0);
  }
}

export class IdbTeamRepository extends Base implements TeamRepository {
  get(teamId: TeamId) {
    return this.getOne<TeamProfile>(STORES.teams, teamId);
  }
  list() {
    return this.getAll<TeamProfile>(STORES.teams);
  }
  put(team: TeamProfile) {
    return this.putOne(STORES.teams, team);
  }
  delete(teamId: TeamId) {
    return this.deleteOne(STORES.teams, teamId);
  }
}

export class IdbWatchlistRepository extends Base implements WatchlistRepository {
  get(teamId: TeamId, profileId = 'default') {
    return this.getOne<Watchlist>(STORES.watchlists, [teamId, profileId]);
  }
  list() {
    return this.getAll<Watchlist>(STORES.watchlists);
  }
  put(list: Watchlist) {
    return this.putOne(STORES.watchlists, list);
  }
}

export class IdbSessionRepository extends Base implements SessionRepository {
  get(sessionId: string) {
    return this.getOne<TournamentSessionRecord>(STORES.sessions, sessionId);
  }
  async latestForTournament(tournamentId: TournamentId) {
    const tx = this.db.transaction(STORES.sessions, 'readonly');
    const all = (await req(
      tx.objectStore(STORES.sessions).index('tournamentId').getAll(tournamentId),
    )) as TournamentSessionRecord[];
    return all.sort((a, b) => b.startedAt - a.startedAt)[0];
  }
  list() {
    return this.getAll<TournamentSessionRecord>(STORES.sessions);
  }
  put(session: TournamentSessionRecord) {
    return this.putOne(STORES.sessions, session);
  }
  async delete(sessionId: string) {
    const tx = this.db.transaction([STORES.sessions, STORES.selections], 'readwrite');
    tx.objectStore(STORES.sessions).delete(sessionId);
    tx.objectStore(STORES.selections).delete(sessionId);
    await txDone(tx);
  }
}

export class IdbSelectionRepository extends Base implements SelectionRepository {
  get(sessionId: string) {
    return this.getOne<GameSelectionRecord>(STORES.selections, sessionId);
  }
  put(selection: GameSelectionRecord) {
    return this.putOne(STORES.selections, selection);
  }
}

export class IdbObservationRepository extends Base implements ObservationRepository {
  async addMany(observations: RankObservation[]) {
    if (observations.length === 0) return;
    const tx = this.db.transaction(STORES.observations, 'readwrite');
    const store = tx.objectStore(STORES.observations);
    for (const o of observations) {
      const { id: _id, ...rest } = o;
      store.add(rest);
    }
    await txDone(tx);
  }
  async list(sessionId: string, scope: string, referenceId: string) {
    const tx = this.db.transaction(STORES.observations, 'readonly');
    const idx = tx.objectStore(STORES.observations).index('bySessionScopeRef');
    const rows = (await req(idx.getAll([sessionId, scope, referenceId]))) as RankObservation[];
    return rows.sort((a, b) => a.endedAt - b.endedAt || (a.id ?? 0) - (b.id ?? 0));
  }
  async countForSession(sessionId: string) {
    const tx = this.db.transaction(STORES.observations, 'readonly');
    return req(tx.objectStore(STORES.observations).index('bySession').count(sessionId));
  }
  async deleteForSession(sessionId: string) {
    const tx = this.db.transaction(STORES.observations, 'readwrite');
    const idx = tx.objectStore(STORES.observations).index('bySession');
    const keys = await req(idx.getAllKeys(sessionId));
    const store = tx.objectStore(STORES.observations);
    for (const k of keys) store.delete(k);
    await txDone(tx);
  }
  async deleteOlderThan(timestamp: number) {
    const tx = this.db.transaction(STORES.observations, 'readwrite');
    const idx = tx.objectStore(STORES.observations).index('byEndedAt');
    const keys = await req(idx.getAllKeys(IDBKeyRange.upperBound(timestamp, true)));
    const store = tx.objectStore(STORES.observations);
    for (const k of keys) store.delete(k);
    await txDone(tx);
    return keys.length;
  }
}

export class IdbParticipantRepository extends Base implements ParticipantRepository {
  async putMany(participants: TournamentParticipant[]) {
    if (participants.length === 0) return;
    const tx = this.db.transaction(STORES.participants, 'readwrite');
    const store = tx.objectStore(STORES.participants);
    for (const p of participants) store.put(p);
    await txDone(tx);
  }
  async listForTournament(tournamentId: TournamentId) {
    const tx = this.db.transaction(STORES.participants, 'readonly');
    return (await req(
      tx.objectStore(STORES.participants).index('tournamentId').getAll(tournamentId),
    )) as TournamentParticipant[];
  }
}

export class IdbPresetRepository extends Base implements PresetRepository {
  list() {
    return this.getAll<LayoutPreset>(STORES.presets);
  }
  get(presetId: string) {
    return this.getOne<LayoutPreset>(STORES.presets, presetId);
  }
  put(preset: LayoutPreset) {
    return this.putOne(STORES.presets, preset);
  }
  delete(presetId: string) {
    return this.deleteOne(STORES.presets, presetId);
  }
}
