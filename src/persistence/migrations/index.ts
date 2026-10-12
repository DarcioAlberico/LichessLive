/**
 * Migrações versionadas do IndexedDB (SPEC 9.3). Cada migração roda dentro da transação
 * "versionchange": se falhar, a transação é abortada e o banco permanece na versão anterior,
 * sem apagar dados.
 */

export interface Migration {
  version: number;
  description: string;
  up(db: IDBDatabase, tx: IDBTransaction): void;
}

export const STORES = {
  players: 'players',
  photos: 'photos',
  teams: 'teams',
  watchlists: 'watchlists',
  sessions: 'sessions',
  participants: 'participants',
  observations: 'observations',
  selections: 'selections',
  presets: 'presets',
  backups: 'backups',
  meta: 'meta',
} as const;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Esquema inicial: cadastro, fotos, sessões, observações e presets',
    up(db) {
      db.createObjectStore(STORES.players, { keyPath: 'userId' });
      db.createObjectStore(STORES.photos, { keyPath: 'photoId' });
      db.createObjectStore(STORES.teams, { keyPath: 'teamId' });
      db.createObjectStore(STORES.watchlists, { keyPath: ['teamId', 'profileId'] });
      const sessions = db.createObjectStore(STORES.sessions, { keyPath: 'sessionId' });
      sessions.createIndex('tournamentId', 'tournamentId');
      sessions.createIndex('startedAt', 'startedAt');
      const participants = db.createObjectStore(STORES.participants, { keyPath: ['tournamentId', 'userId'] });
      participants.createIndex('tournamentId', 'tournamentId');
      const obs = db.createObjectStore(STORES.observations, { keyPath: 'id', autoIncrement: true });
      obs.createIndex('bySessionScopeRef', ['sessionId', 'scope', 'referenceId']);
      obs.createIndex('bySession', 'sessionId');
      obs.createIndex('byEndedAt', 'endedAt');
      db.createObjectStore(STORES.selections, { keyPath: 'sessionId' });
      db.createObjectStore(STORES.presets, { keyPath: 'presetId' });
      const backups = db.createObjectStore(STORES.backups, { keyPath: 'backupId' });
      backups.createIndex('createdAt', 'createdAt');
      db.createObjectStore(STORES.meta, { keyPath: 'key' });
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
