import type { Repositories } from '../../application/ports';
import type { UserId } from '../../domain/entities/ids';
import { asTeamId, normalizeUserId } from '../../domain/entities/ids';
import type {
  LayoutPreset,
  PhotoAsset,
  PlayerProfile,
  TeamProfile,
  Watchlist,
} from '../../domain/entities/profiles';
import { sanitizePreset } from '../../presentation/layouts/presets';
import { sha256Hex } from '../../shared/encoding';
import type { Settings } from '../../shared/settings';
import { sanitizeSettings } from '../../shared/settings';
import { isRecord, newId } from '../../shared/validate';
import { createZip, readZip, ZipError } from '../../shared/zip';
import { detectImageType } from '../photos/photoProcessing';
import { req, txDone } from '../db';
import { SCHEMA_VERSION, STORES } from '../migrations';

/**
 * Backup versionado (SPEC 10, RF12, T12): ZIP com manifest.json, profiles.json, settings.json e
 * photos/. O manifest traz schemaVersion, appVersion, exportedAt, arquivos, tamanhos e SHA-256.
 * Nunca contém token, cookies, chat ou sessão autenticada. A importação valida tudo antes e aplica
 * em uma única transação; um pacote inválido não altera os dados existentes.
 */

export const BACKUP_FORMAT = 1;

export interface ManifestFile {
  path: string;
  size: number;
  sha256: string;
}

export interface BackupManifest {
  format: number;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  includesHistory: boolean;
  files: ManifestFile[];
}

interface PhotoMeta {
  photoId: string;
  path: string;
  width: number;
  height: number;
  mime: string;
  hash: string;
  createdAt: number;
}

interface ProfilesFile {
  players: PlayerProfile[];
  teams: TeamProfile[];
  watchlists: Watchlist[];
  photos: PhotoMeta[];
}

interface SettingsFile {
  settings: Settings;
  presets: LayoutPreset[];
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function json(value: unknown): Uint8Array {
  return enc.encode(JSON.stringify(value, null, 2));
}

function extFor(mime: string): string {
  return mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp';
}

export async function exportBackup(
  repos: Repositories,
  opts: { appVersion: string; includeHistory: boolean; db?: IDBDatabase; now?: Date },
): Promise<{ bytes: Uint8Array; manifest: BackupManifest }> {
  const [players, teams, watchlists, photos, presets, settings] = await Promise.all([
    repos.players.list(),
    repos.teams.list(),
    repos.watchlists.list(),
    repos.photos.list(),
    repos.presets.list(),
    repos.settings.get(),
  ]);
  const files: { path: string; data: Uint8Array }[] = [];
  const photoMeta: PhotoMeta[] = [];
  for (const p of photos) {
    const path = `photos/${p.photoId}.${extFor(p.mime)}`;
    files.push({ path, data: new Uint8Array(await p.blob.arrayBuffer()) });
    photoMeta.push({
      photoId: p.photoId,
      path,
      width: p.width,
      height: p.height,
      mime: p.mime,
      hash: p.hash,
      createdAt: p.createdAt,
    });
  }
  const profiles: ProfilesFile = { players, teams, watchlists, photos: photoMeta };
  const settingsFile: SettingsFile = { settings, presets: presets.filter((p) => !p.builtIn) };
  files.unshift(
    { path: 'profiles.json', data: json(profiles) },
    { path: 'settings.json', data: json(settingsFile) },
  );
  if (opts.includeHistory && opts.db) {
    const tx = opts.db.transaction([STORES.sessions, STORES.observations, STORES.selections], 'readonly');
    const [sessions, observations, selections] = await Promise.all([
      req(tx.objectStore(STORES.sessions).getAll()),
      req(tx.objectStore(STORES.observations).getAll()),
      req(tx.objectStore(STORES.selections).getAll()),
    ]);
    files.push({ path: 'history.json', data: json({ sessions, observations, selections }) });
  }
  const manifestFiles: ManifestFile[] = [];
  for (const f of files)
    manifestFiles.push({ path: f.path, size: f.data.length, sha256: await sha256Hex(f.data) });
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    appVersion: opts.appVersion,
    exportedAt: (opts.now ?? new Date()).toISOString(),
    includesHistory: files.some((f) => f.path === 'history.json'),
    files: manifestFiles,
  };
  const bytes = createZip([{ path: 'manifest.json', data: json(manifest) }, ...files], opts.now);
  return { bytes, manifest };
}

// ------------------------------------------------------------------ importação

function sanitizePlayer(v: unknown): PlayerProfile | null {
  if (!isRecord(v)) return null;
  const userId = normalizeUserId(v.userId);
  if (!userId) return null;
  const crop =
    isRecord(v.crop) &&
    [v.crop.x, v.crop.y, v.crop.size].every((n) => typeof n === 'number' && n >= 0 && n <= 1)
      ? { x: v.crop.x as number, y: v.crop.y as number, size: v.crop.size as number }
      : null;
  return {
    userId,
    usernameDisplay:
      typeof v.usernameDisplay === 'string' && normalizeUserId(v.usernameDisplay) === userId
        ? v.usernameDisplay
        : userId,
    displayName: typeof v.displayName === 'string' ? v.displayName.slice(0, 60) : null,
    photoId: typeof v.photoId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v.photoId) ? v.photoId : null,
    crop,
    updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0,
  };
}

function sanitizeTeam(v: unknown): TeamProfile | null {
  if (!isRecord(v)) return null;
  const teamId = asTeamId(v.teamId);
  if (!teamId) return null;
  const members: TeamProfile['members'] = [];
  for (const m of Array.isArray(v.members) ? v.members : []) {
    if (!isRecord(m)) continue;
    const userId = normalizeUserId(m.userId);
    if (!userId) continue;
    members.push({
      userId,
      username: typeof m.username === 'string' ? m.username : userId,
      source: m.source === 'public-import' ? 'public-import' : 'manual',
    });
  }
  const cov = isRecord(v.rosterCoverage) ? v.rosterCoverage : {};
  const kinds = ['complete', 'partial', 'unknown', 'unavailable'];
  return {
    teamId,
    name: typeof v.name === 'string' ? v.name.slice(0, 120) : teamId,
    logoId: null,
    rosterCoverage: {
      kind:
        typeof cov.kind === 'string' && kinds.includes(cov.kind)
          ? (cov.kind as TeamProfile['rosterCoverage']['kind'])
          : 'unknown',
      received: typeof cov.received === 'number' ? cov.received : members.length,
      total: typeof cov.total === 'number' ? cov.total : null,
    },
    rosterFetchedAt: typeof v.rosterFetchedAt === 'number' ? v.rosterFetchedAt : null,
    members,
  };
}

function sanitizeWatchlist(v: unknown): Watchlist | null {
  if (!isRecord(v)) return null;
  const teamId = asTeamId(v.teamId);
  if (!teamId) return null;
  const ids = (x: unknown): UserId[] =>
    Array.isArray(x) ? x.map(normalizeUserId).filter((u): u is UserId => !!u) : [];
  return {
    teamId,
    profileId: typeof v.profileId === 'string' && v.profileId.length <= 40 ? v.profileId : 'default',
    userIds: [...new Set(ids(v.userIds))],
    favorites: [...new Set(ids(v.favorites))],
    manualOrder: [...new Set(ids(v.manualOrder))],
    updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0,
  };
}

export interface BackupContents {
  manifest: BackupManifest;
  players: PlayerProfile[];
  teams: TeamProfile[];
  watchlists: Watchlist[];
  photos: PhotoAsset[];
  settings: Settings;
  presets: LayoutPreset[];
}

export interface BackupPreview {
  players: number;
  photos: number;
  teams: number;
  watchlists: number;
  presets: number;
  conflicts: { userId: UserId; existing: string; incoming: string }[];
  exportedAt: string;
  appVersion: string;
  includesHistory: boolean;
}

export type InspectResult =
  { ok: true; contents: BackupContents; preview: BackupPreview } | { ok: false; errors: string[] };

function parseJson(bytes: Uint8Array | undefined, name: string): unknown {
  if (!bytes) throw new Error(`${name} ausente`);
  try {
    return JSON.parse(dec.decode(bytes));
  } catch {
    throw new Error(`${name} não é um JSON válido`);
  }
}

/** Valida o pacote por completo e calcula a prévia — não altera nada. */
export async function inspectBackup(bytes: Uint8Array, repos: Repositories): Promise<InspectResult> {
  const errors: string[] = [];
  try {
    const files = await readZip(bytes);
    const manifestRaw = parseJson(files.get('manifest.json'), 'manifest.json');
    if (!isRecord(manifestRaw) || !Array.isArray(manifestRaw.files))
      throw new Error('manifest.json inválido');
    if (manifestRaw.format !== BACKUP_FORMAT)
      throw new Error(`formato de backup ${String(manifestRaw.format)} não suportado`);
    if (typeof manifestRaw.schemaVersion !== 'number' || manifestRaw.schemaVersion > SCHEMA_VERSION) {
      throw new Error('backup criado por uma versão mais nova da extensão');
    }
    const listed = new Map<string, ManifestFile>();
    for (const f of manifestRaw.files) {
      if (
        !isRecord(f) ||
        typeof f.path !== 'string' ||
        typeof f.size !== 'number' ||
        typeof f.sha256 !== 'string'
      ) {
        throw new Error('entrada inválida no manifest');
      }
      listed.set(f.path, { path: f.path, size: f.size, sha256: f.sha256 });
    }
    for (const [path, data] of files) {
      if (path === 'manifest.json') continue;
      const meta = listed.get(path);
      if (!meta) throw new Error(`arquivo não declarado no manifest: ${path}`);
      if (meta.size !== data.length) throw new Error(`tamanho divergente: ${path}`);
      if ((await sha256Hex(data)) !== meta.sha256) throw new Error(`hash SHA-256 divergente: ${path}`);
    }
    for (const path of listed.keys()) if (!files.has(path)) throw new Error(`arquivo ausente: ${path}`);

    const profilesRaw = parseJson(files.get('profiles.json'), 'profiles.json');
    const settingsRaw = parseJson(files.get('settings.json'), 'settings.json');
    if (!isRecord(profilesRaw) || !isRecord(settingsRaw)) throw new Error('conteúdo inválido');

    const players = (Array.isArray(profilesRaw.players) ? profilesRaw.players : []).map(sanitizePlayer);
    if (players.some((p) => p === null)) throw new Error('jogador inválido em profiles.json');
    const teams = (Array.isArray(profilesRaw.teams) ? profilesRaw.teams : []).map(sanitizeTeam);
    if (teams.some((t) => t === null)) throw new Error('team inválido em profiles.json');
    const watchlists = (Array.isArray(profilesRaw.watchlists) ? profilesRaw.watchlists : []).map(
      sanitizeWatchlist,
    );
    if (watchlists.some((w) => w === null)) throw new Error('lista de acompanhados inválida');
    const userIds = new Set<string>();
    for (const p of players as PlayerProfile[]) {
      if (userIds.has(p.userId)) throw new Error(`jogador duplicado: ${p.userId}`);
      userIds.add(p.userId);
    }

    const photos: PhotoAsset[] = [];
    for (const m of Array.isArray(profilesRaw.photos) ? profilesRaw.photos : []) {
      if (
        !isRecord(m) ||
        typeof m.photoId !== 'string' ||
        !/^[A-Za-z0-9-]{8,64}$/.test(m.photoId) ||
        typeof m.path !== 'string'
      ) {
        throw new Error('metadado de foto inválido');
      }
      const data = files.get(m.path);
      if (!data || !m.path.startsWith('photos/')) throw new Error(`foto ausente: ${m.path}`);
      const mime = detectImageType(data);
      if (!mime) throw new Error(`foto com formato inválido: ${m.path}`);
      if (data.length > 1024 * 1024) throw new Error(`foto grande demais: ${m.path}`);
      photos.push({
        photoId: m.photoId,
        blob: new Blob([data as BlobPart], { type: mime }),
        width: typeof m.width === 'number' ? m.width : 512,
        height: typeof m.height === 'number' ? m.height : 512,
        mime,
        hash: await sha256Hex(data),
        createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
      });
    }
    const photoIds = new Set(photos.map((p) => p.photoId));
    for (const p of players as PlayerProfile[]) {
      if (p.photoId && !photoIds.has(p.photoId)) p.photoId = null;
    }

    const presets = (Array.isArray(settingsRaw.presets) ? settingsRaw.presets : [])
      .map(sanitizePreset)
      .filter((p): p is LayoutPreset => p !== null);
    const settings = sanitizeSettings(settingsRaw.settings);

    const existing = await repos.players.list();
    const existingMap = new Map(existing.map((p) => [p.userId, p]));
    const conflicts: BackupPreview['conflicts'] = [];
    for (const p of players as PlayerProfile[]) {
      const e = existingMap.get(p.userId);
      if (
        e &&
        (e.displayName !== p.displayName ||
          e.photoId !== p.photoId ||
          e.usernameDisplay !== p.usernameDisplay)
      ) {
        conflicts.push({
          userId: p.userId,
          existing: e.displayName ?? e.usernameDisplay,
          incoming: p.displayName ?? p.usernameDisplay,
        });
      }
    }

    const manifest = manifestRaw as unknown as BackupManifest;
    return {
      ok: true,
      contents: {
        manifest,
        players: players as PlayerProfile[],
        teams: teams as TeamProfile[],
        watchlists: watchlists as Watchlist[],
        photos,
        settings,
        presets,
      },
      preview: {
        players: players.length,
        photos: photos.length,
        teams: teams.length,
        watchlists: watchlists.length,
        presets: presets.length,
        conflicts,
        exportedAt: typeof manifest.exportedAt === 'string' ? manifest.exportedAt : '?',
        appVersion: typeof manifest.appVersion === 'string' ? manifest.appVersion : '?',
        includesHistory: manifest.includesHistory === true,
      },
    };
  } catch (err) {
    errors.push(
      err instanceof ZipError
        ? `Pacote corrompido: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err),
    );
    return { ok: false, errors };
  }
}

/** Guarda um backup automático antes de aplicar uma importação (mantém os 3 mais recentes). */
export async function storeSafetyBackup(db: IDBDatabase, bytes: Uint8Array, reason: string): Promise<string> {
  const backupId = newId();
  const tx = db.transaction(STORES.backups, 'readwrite');
  const store = tx.objectStore(STORES.backups);
  store.put({
    backupId,
    createdAt: Date.now(),
    reason,
    blob: new Blob([bytes as BlobPart], { type: 'application/zip' }),
    size: bytes.length,
  });
  await txDone(tx);
  const tx2 = db.transaction(STORES.backups, 'readwrite');
  const all = (await req(tx2.objectStore(STORES.backups).getAll())) as {
    backupId: string;
    createdAt: number;
  }[];
  all.sort((a, b) => b.createdAt - a.createdAt);
  for (const old of all.slice(3)) tx2.objectStore(STORES.backups).delete(old.backupId);
  await txDone(tx2);
  return backupId;
}

export async function listSafetyBackups(
  db: IDBDatabase,
): Promise<{ backupId: string; createdAt: number; reason: string; blob: Blob; size: number }[]> {
  const tx = db.transaction(STORES.backups, 'readonly');
  const all = (await req(tx.objectStore(STORES.backups).getAll())) as {
    backupId: string;
    createdAt: number;
    reason: string;
    blob: Blob;
    size: number;
  }[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Aplica o conteúdo validado em uma única transação do IndexedDB (cadastro, fotos, teams,
 * acompanhados e presets). Em "replace" o cadastro e os presets personalizados são substituídos; em "merge" o registro
 * mais recente prevalece. Fotos sem referência são removidas no mesmo passo.
 */
export async function applyBackup(
  db: IDBDatabase,
  repos: Repositories,
  contents: BackupContents,
  mode: 'merge' | 'replace',
): Promise<void> {
  const stores = [STORES.players, STORES.photos, STORES.teams, STORES.watchlists, STORES.presets];
  const tx = db.transaction(stores, 'readwrite');
  const players = tx.objectStore(STORES.players);
  const photos = tx.objectStore(STORES.photos);
  const teams = tx.objectStore(STORES.teams);
  const watchlists = tx.objectStore(STORES.watchlists);
  const presets = tx.objectStore(STORES.presets);
  const done = txDone(tx);
  try {
    if (mode === 'replace') {
      for (const s of [players, photos, teams, watchlists, presets]) s.clear();
      for (const p of contents.photos) photos.put(p);
      for (const p of contents.players) players.put(p);
      for (const t of contents.teams) teams.put(t);
      for (const w of contents.watchlists) watchlists.put(w);
    } else {
      const existingPlayers = (await req(players.getAll())) as PlayerProfile[];
      const byId = new Map(existingPlayers.map((p) => [p.userId, p]));
      for (const p of contents.photos) photos.put(p);
      for (const p of contents.players) {
        const e = byId.get(p.userId);
        if (!e || p.updatedAt >= e.updatedAt) players.put(p);
      }
      const existingTeams = new Map(((await req(teams.getAll())) as TeamProfile[]).map((t) => [t.teamId, t]));
      for (const t of contents.teams) {
        const e = existingTeams.get(t.teamId);
        if (!e) teams.put(t);
        else {
          const members = new Map(e.members.map((m) => [m.userId, m]));
          for (const m of t.members) if (!members.has(m.userId)) members.set(m.userId, m);
          teams.put({ ...e, name: t.name || e.name, members: [...members.values()] });
        }
      }
      const existingWl = (await req(watchlists.getAll())) as Watchlist[];
      const wlKey = (w: Watchlist) => `${w.teamId}|${w.profileId}`;
      const wlMap = new Map(existingWl.map((w) => [wlKey(w), w]));
      for (const w of contents.watchlists) {
        const e = wlMap.get(wlKey(w));
        if (!e) watchlists.put(w);
        else {
          watchlists.put({
            ...e,
            userIds: [...new Set([...e.userIds, ...w.userIds])],
            favorites: [...new Set([...e.favorites, ...w.favorites])],
            manualOrder: [...new Set([...e.manualOrder, ...w.manualOrder])],
            updatedAt: Math.max(e.updatedAt, w.updatedAt),
          });
        }
      }
    }
    for (const p of contents.presets) presets.put(p);
    // Remove fotos sem referência após a mudança.
    const finalPlayers = (await req(players.getAll())) as PlayerProfile[];
    const referenced = new Set(finalPlayers.map((p) => p.photoId).filter(Boolean));
    const photoKeys = (await req(photos.getAllKeys())) as string[];
    for (const k of photoKeys) if (!referenced.has(k)) photos.delete(k);
  } catch (err) {
    tx.abort();
    await done.catch(() => undefined);
    throw err;
  }
  await done;
  // Preferências ficam em chrome.storage.local, fora da transação do IndexedDB.
  try {
    await repos.settings.update({ ...contents.settings });
  } catch (err) {
    throw new BackupSettingsError(err instanceof Error ? err.message : String(err));
  }
}

/** O cadastro foi aplicado, mas as preferências não puderam ser gravadas. */
export class BackupSettingsError extends Error {
  constructor(message: string) {
    super(`cadastro importado, mas as preferências não foram aplicadas: ${message}`);
    this.name = 'BackupSettingsError';
  }
}
