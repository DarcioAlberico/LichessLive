import type { Repositories, SettingsStore } from '../application/ports';
import type { OpenResult } from './db';
import { openDatabase } from './db';
import {
  IdbObservationRepository,
  IdbParticipantRepository,
  IdbPhotoRepository,
  IdbPlayerRepository,
  IdbPresetRepository,
  IdbSelectionRepository,
  IdbSessionRepository,
  IdbTeamRepository,
  IdbWatchlistRepository,
} from './repositories/idbRepositories';
import { ChromeSettingsStore } from './repositories/settingsStore';

export interface Persistence {
  repos: Repositories;
  db: IDBDatabase;
  open: OpenResult;
}

export function createRepositories(db: IDBDatabase, settings: SettingsStore): Repositories {
  return {
    players: new IdbPlayerRepository(db),
    photos: new IdbPhotoRepository(db),
    teams: new IdbTeamRepository(db),
    watchlists: new IdbWatchlistRepository(db),
    sessions: new IdbSessionRepository(db),
    selections: new IdbSelectionRepository(db),
    observations: new IdbObservationRepository(db),
    participants: new IdbParticipantRepository(db),
    presets: new IdbPresetRepository(db),
    settings,
  };
}

export async function openPersistence(): Promise<Persistence> {
  const open = await openDatabase();
  return { repos: createRepositories(open.db, new ChromeSettingsStore()), db: open.db, open };
}
