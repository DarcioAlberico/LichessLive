import { describe, expect, it } from 'vitest';
import type { TeamId, UserId } from '../../src/domain/entities/ids';
import type { PlayerProfile } from '../../src/domain/entities/profiles';
import { createRepositories } from '../../src/persistence';
import {
  applyBackup,
  exportBackup,
  inspectBackup,
  listSafetyBackups,
  storeSafetyBackup,
} from '../../src/persistence/backup/backup';
import { openDatabase } from '../../src/persistence/db';
import type { Migration } from '../../src/persistence/migrations';
import { MIGRATIONS } from '../../src/persistence/migrations';
import { MemorySettingsStore } from '../../src/persistence/repositories/settingsStore';
import { createZip, readZip } from '../../src/shared/zip';

let n = 0;
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3, 4,
]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 9, 9, 9]);

async function fresh() {
  const open = await openDatabase({ name: `lts-p-${Date.now()}-${n++}` });
  return { open, repos: createRepositories(open.db, new MemorySettingsStore()) };
}

function player(userId: string, extra: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    userId: userId as UserId,
    usernameDisplay: userId,
    displayName: null,
    photoId: null,
    crop: null,
    updatedAt: 1,
    ...extra,
  };
}

async function seed(repos: Awaited<ReturnType<typeof fresh>>['repos']) {
  await repos.photos.put({
    photoId: 'photo-0001',
    blob: new Blob([WEBP], { type: 'image/webp' }),
    width: 512,
    height: 512,
    mime: 'image/webp',
    hash: 'h',
    createdAt: 1,
  });
  await repos.players.put(
    player('darcioalberico', {
      usernameDisplay: 'DarcioAlberico',
      displayName: 'Dárcio',
      photoId: 'photo-0001',
      crop: { x: 0.1, y: 0.2, size: 0.5 },
    }),
  );
  await repos.players.put(player('enxadristaheterodoxo'));
  await repos.teams.put({
    teamId: 'meu-team' as TeamId,
    name: 'Meu Team',
    logoId: null,
    rosterCoverage: { kind: 'partial', received: 1, total: 3 },
    rosterFetchedAt: 5,
    members: [{ userId: 'darcioalberico' as UserId, username: 'DarcioAlberico', source: 'manual' }],
  });
  await repos.watchlists.put({
    teamId: 'meu-team' as TeamId,
    profileId: 'default',
    userIds: ['darcioalberico' as UserId],
    favorites: [],
    manualOrder: [],
    updatedAt: 1,
  });
  await repos.settings.update({ timezone: 'America/Manaus', rankingNb: 300 });
}

describe('migrações de schema', () => {
  it('cria o esquema v1 e registra a migração', async () => {
    const { open } = await fresh();
    expect(open.version).toBe(MIGRATIONS.at(-1)!.version);
    expect(open.migrationError).toBeNull();
    expect([...open.db.objectStoreNames]).toEqual(
      expect.arrayContaining(['players', 'photos', 'observations', 'sessions', 'backups', 'meta']),
    );
  });
  it('falha de migração preserva os dados na versão anterior', async () => {
    const name = `lts-mig-${Date.now()}`;
    const first = await openDatabase({ name });
    const repos = createRepositories(first.db, new MemorySettingsStore());
    await repos.players.put(player('guardado'));
    first.db.close();
    const broken: Migration = {
      version: 2,
      description: 'migração quebrada',
      up(db) {
        db.createObjectStore('novo');
        throw new Error('erro proposital');
      },
    };
    const second = await openDatabase({ name, migrations: [...MIGRATIONS, broken] });
    expect(second.migrationError).toMatch(/erro proposital/);
    expect(second.version).toBe(1);
    expect([...second.db.objectStoreNames]).not.toContain('novo');
    const again = createRepositories(second.db, new MemorySettingsStore());
    expect((await again.players.get('guardado' as UserId))?.userId).toBe('guardado');
  });
  it('migração versionada aplicada sobre dados existentes', async () => {
    const name = `lts-mig2-${Date.now()}`;
    const first = await openDatabase({ name });
    first.db.close();
    const v2: Migration = {
      version: 2,
      description: 'índice extra',
      up(_db, tx) {
        tx.objectStore('players').createIndex('updatedAt', 'updatedAt');
      },
    };
    const second = await openDatabase({ name, migrations: [...MIGRATIONS, v2] });
    expect(second.version).toBe(2);
    expect(second.migratedFrom).toBe(1);
    expect([...second.db.transaction('players').objectStore('players').indexNames]).toContain('updatedAt');
  });
});

describe('repositórios', () => {
  it('IDs com diferença de caixa não criam dois cadastros', async () => {
    const { repos } = await fresh();
    await repos.players.put(player('darcio'));
    await repos.players.put(player('darcio', { displayName: 'D' }));
    expect(await repos.players.list()).toHaveLength(1);
  });
  it('observações por sessão, escopo e referência; descarte por idade', async () => {
    const { repos } = await fresh();
    const base = {
      sessionId: 's1',
      scope: 'general',
      referenceId: 'r1',
      rulesVersion: 'v',
      collectionId: 'c',
      tournamentId: 'Tour1234' as never,
      userId: 'a' as UserId,
      rank: 1,
      score: 1,
      source: 'results-live' as const,
      startedAt: 0,
      provisional: true,
      inCut: true,
    };
    await repos.observations.addMany([
      { ...base, endedAt: 10 },
      { ...base, endedAt: 20, referenceId: 'r2' },
      { ...base, endedAt: 30, scope: 'watched' },
    ]);
    expect(await repos.observations.list('s1', 'general', 'r1')).toHaveLength(1);
    expect(await repos.observations.countForSession('s1')).toBe(3);
    expect(await repos.observations.deleteOlderThan(25)).toBe(2);
    expect(await repos.observations.countForSession('s1')).toBe(1);
  });
});

describe('backup versionado (T12, RF12)', () => {
  it('exporta e restaura fotos, perfis e configurações em perfil limpo', async () => {
    const a = await fresh();
    await seed(a.repos);
    const { bytes, manifest } = await exportBackup(a.repos, { appVersion: '1.0.0', includeHistory: false });
    expect(manifest.files.map((f) => f.path)).toEqual(
      expect.arrayContaining(['profiles.json', 'settings.json', 'photos/photo-0001.webp']),
    );
    expect(manifest.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    const text = new TextDecoder().decode(bytes);
    expect(text).not.toMatch(/token|cookie/i);

    const b = await fresh();
    const res = await inspectBackup(bytes, b.repos);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.preview).toMatchObject({ players: 2, photos: 1, teams: 1, watchlists: 1, conflicts: [] });
    await applyBackup(b.open.db, b.repos, res.contents, 'replace');
    const d = await b.repos.players.get('darcioalberico' as UserId);
    expect(d).toMatchObject({
      displayName: 'Dárcio',
      photoId: 'photo-0001',
      crop: { x: 0.1, y: 0.2, size: 0.5 },
    });
    const photo = await b.repos.photos.get('photo-0001');
    expect(new Uint8Array(await photo!.blob.arrayBuffer())).toEqual(WEBP);
    expect((await b.repos.settings.get()).timezone).toBe('America/Manaus');
    expect((await b.repos.watchlists.get('meu-team' as TeamId))?.userIds).toEqual(['darcioalberico']);
  });

  it('pacote corrompido não altera os dados existentes', async () => {
    const a = await fresh();
    await seed(a.repos);
    const { bytes } = await exportBackup(a.repos, { appVersion: '1.0.0', includeHistory: false });
    const corrupted = bytes.slice();
    corrupted[200] = corrupted[200]! ^ 0xff;
    const truncated = bytes.slice(0, bytes.length - 40);
    const b = await fresh();
    await b.repos.players.put(player('existente'));
    for (const pkg of [corrupted, truncated, new Uint8Array([1, 2, 3])]) {
      const res = await inspectBackup(pkg, b.repos);
      expect(res.ok).toBe(false);
    }
    expect((await b.repos.players.list()).map((p) => p.userId)).toEqual(['existente']);
  });

  it('rejeita caminhos absolutos, travessia e arquivos não declarados', async () => {
    const b = await fresh();
    const enc = new TextEncoder();
    for (const path of ['../evil.json', '/abs.json', 'C:/x.json', 'a\\b.json']) {
      const zip = createZip([
        { path: 'manifest.json', data: enc.encode('{}') },
        { path, data: enc.encode('x') },
      ]);
      const res = await inspectBackup(zip, b.repos);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.errors.join()).toMatch(/caminho inválido|corrompido/);
    }
    const a = await fresh();
    await seed(a.repos);
    const { bytes } = await exportBackup(a.repos, { appVersion: '1.0.0', includeHistory: false });
    const files = await readZip(bytes);
    files.set('extra.bin', enc.encode('surpresa'));
    const repacked = createZip([...files].map(([path, data]) => ({ path, data })));
    const res = await inspectBackup(repacked, b.repos);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join()).toMatch(/não declarado/);
  });

  it('mesclar mantém o registro mais recente e informa conflitos; guarda backup anterior', async () => {
    const a = await fresh();
    await seed(a.repos);
    const { bytes } = await exportBackup(a.repos, { appVersion: '1.0.0', includeHistory: false });
    const b = await fresh();
    await b.repos.players.put(player('darcioalberico', { displayName: 'Mais novo', updatedAt: 999 }));
    await b.repos.players.put(player('outro'));
    const res = await inspectBackup(bytes, b.repos);
    if (!res.ok) throw new Error(res.errors.join());
    expect(res.preview.conflicts.map((c) => c.userId)).toEqual(['darcioalberico']);
    const safety = await exportBackup(b.repos, { appVersion: '1.0.0', includeHistory: false });
    await storeSafetyBackup(b.open.db, safety.bytes, 'antes de importar');
    await applyBackup(b.open.db, b.repos, res.contents, 'merge');
    expect((await b.repos.players.get('darcioalberico' as UserId))?.displayName).toBe('Mais novo');
    expect((await b.repos.players.list()).map((p) => p.userId).sort()).toEqual([
      'darcioalberico',
      'enxadristaheterodoxo',
      'outro',
    ]);
    // A foto do backup ficou sem referência (registro local mais novo sem foto) e foi removida.
    expect(await b.repos.photos.get('photo-0001')).toBeUndefined();
    expect(await listSafetyBackups(b.open.db)).toHaveLength(1);
  });

  it('inclui histórico apenas quando solicitado', async () => {
    const a = await fresh();
    await seed(a.repos);
    const without = await exportBackup(a.repos, { appVersion: '1', includeHistory: false, db: a.open.db });
    const withH = await exportBackup(a.repos, { appVersion: '1', includeHistory: true, db: a.open.db });
    expect(without.manifest.includesHistory).toBe(false);
    expect(withH.manifest.files.some((f) => f.path === 'history.json')).toBe(true);
  });

  it('aceita foto PNG válida e rejeita foto com formato inválido', async () => {
    const a = await fresh();
    await a.repos.photos.put({
      photoId: 'photo-png1',
      blob: new Blob([PNG], { type: 'image/png' }),
      width: 1,
      height: 1,
      mime: 'image/png',
      hash: 'h',
      createdAt: 1,
    });
    await a.repos.players.put(player('p', { photoId: 'photo-png1' }));
    const { bytes } = await exportBackup(a.repos, { appVersion: '1', includeHistory: false });
    const b = await fresh();
    expect((await inspectBackup(bytes, b.repos)).ok).toBe(true);
    const files = await readZip(bytes);
    files.set('photos/photo-png1.png', new TextEncoder().encode('<svg/>'));
    // Hash do manifest deixa de bater: rejeitado antes de olhar o conteúdo.
    const repacked = createZip([...files].map(([path, data]) => ({ path, data })));
    expect((await inspectBackup(repacked, b.repos)).ok).toBe(false);
  });
});
