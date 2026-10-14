import { useEffect, useState } from 'preact/hooks';
import type { LichessClient } from '../adapters/lichess/rest/lichessClient';
import { LIMITS } from '../adapters/lichess/rest/lichessClient';
import { RateLimitedError } from '../adapters/lichess/rest/restQueue';
import { computeCoverage } from '../domain/entities/coverage';
import type { UserId } from '../domain/entities/ids';
import { asTeamId, LOCAL_LIST_ID, normalizeUserId } from '../domain/entities/ids';
import type { PhotoCrop, PlayerProfile, TeamProfile, Watchlist } from '../domain/entities/profiles';
import type { Persistence } from '../persistence';
import type { BackupContents, BackupPreview } from '../persistence/backup/backup';
import {
  applyBackup,
  BackupSettingsError,
  exportBackup,
  inspectBackup,
  listSafetyBackups,
  storeSafetyBackup,
} from '../persistence/backup/backup';
import { renderPhoto, validateDimensions, validateUpload } from '../persistence/photos/photoProcessing';
import type { Settings } from '../shared/settings';
import { newId } from '../shared/validate';
import { downloadBytes, notifyDataChanged } from '../shared/extension';
import { PhotoEditor } from './PhotoEditor';

export interface OptionsDeps {
  persistence: Persistence;
  client: LichessClient;
  version: string;
}

function usePhotoUrls(players: PlayerProfile[], deps: OptionsDeps): Map<string, string> {
  const [urls, setUrls] = useState(new Map<string, string>());
  useEffect(() => {
    let alive = true;
    const created: string[] = [];
    void (async () => {
      const map = new Map<string, string>();
      for (const p of players) {
        if (!p.photoId) continue;
        const asset = await deps.persistence.repos.photos.get(p.photoId);
        if (asset) {
          const url = URL.createObjectURL(asset.blob);
          created.push(url);
          map.set(p.photoId, url);
        }
      }
      if (alive) setUrls(map);
    })();
    return () => {
      alive = false;
      for (const u of created) URL.revokeObjectURL(u);
    };
  }, [players]);
  return urls;
}

function PlayersSection({ deps }: { deps: OptionsDeps }) {
  const repos = deps.persistence.repos;
  const [players, setPlayers] = useState<PlayerProfile[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlayerProfile | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [crop, setCrop] = useState<PhotoCrop | null>(null);
  const [filter, setFilter] = useState('');
  const urls = usePhotoUrls(players, deps);

  const reload = async () =>
    setPlayers(
      (await repos.players.list()).sort((a, b) => a.usernameDisplay.localeCompare(b.usernameDisplay)),
    );
  useEffect(() => void reload(), []);

  const search = async () => {
    const id = normalizeUserId(query);
    if (!id) return setStatus('Username inválido.');
    setStatus('Consultando o Lichess…');
    try {
      const user = await deps.client.publicUser(id);
      if (!user) return setStatus(`Usuário "${query}" não encontrado no Lichess.`);
      const existing = await repos.players.get(user.userId);
      const profile: PlayerProfile = existing ?? {
        userId: user.userId,
        usernameDisplay: user.username,
        displayName: null,
        photoId: null,
        crop: null,
        updatedAt: Date.now(),
      };
      setEditing({ ...profile, usernameDisplay: user.username });
      setStatus(
        `Confirmado: ${user.title ? `${user.title} ` : ''}${user.username} (ID ${user.userId})${user.disabled ? ' — conta fechada' : ''}.`,
      );
    } catch (err) {
      setStatus(
        err instanceof RateLimitedError
          ? 'Limitação de acesso do Lichess; tente após a pausa.'
          : 'Falha na consulta. Você pode cadastrar mesmo assim.',
      );
      setEditing({
        userId: id,
        usernameDisplay: query.trim().replace(/^@/, ''),
        displayName: null,
        photoId: null,
        crop: null,
        updatedAt: Date.now(),
      });
    }
  };

  const pickFile = async (file: File) => {
    setBitmap(null);
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const v = validateUpload(file.type, file.size, head);
    if (!v.ok) return setStatus(v.error);
    try {
      const bmp = await createImageBitmap(file);
      const dimErr = validateDimensions(bmp.width, bmp.height);
      if (dimErr) {
        bmp.close();
        return setStatus(dimErr);
      }
      setBitmap(bmp);
      setCrop(null);
      setStatus(`Imagem ${bmp.width}×${bmp.height} carregada. Ajuste o recorte.`);
    } catch {
      setStatus('Não foi possível decodificar a imagem.');
    }
  };

  const save = async () => {
    if (!editing) return;
    let next: PlayerProfile = {
      ...editing,
      displayName: editing.displayName?.trim() || null,
      updatedAt: Date.now(),
    };
    const oldPhoto = (await repos.players.get(editing.userId))?.photoId ?? null;
    if (bitmap && crop) {
      const out = await renderPhoto(bitmap, crop);
      const photoId = newId();
      await repos.photos.put({
        photoId,
        blob: out.blob,
        width: out.width,
        height: out.height,
        mime: out.mime,
        hash: out.hash,
        createdAt: Date.now(),
      });
      next = { ...next, photoId, crop };
      setStatus(
        `Foto salva (${out.width}×${out.height}, ${Math.round(out.blob.size / 1024)} KB, metadados removidos).`,
      );
    }
    await repos.players.put(next);
    if (oldPhoto && oldPhoto !== next.photoId) await removePhotoIfUnreferenced(oldPhoto);
    bitmap?.close();
    setBitmap(null);
    setEditing(null);
    await reload();
    notifyDataChanged('profiles');
  };

  const removePhotoIfUnreferenced = async (photoId: string) => {
    const all = await repos.players.list();
    if (!all.some((p) => p.photoId === photoId)) await repos.photos.delete(photoId);
  };

  const removePhoto = async (p: PlayerProfile) => {
    await repos.players.put({ ...p, photoId: null, crop: null, updatedAt: Date.now() });
    if (p.photoId) await removePhotoIfUnreferenced(p.photoId);
    await reload();
    notifyDataChanged('profiles');
  };

  const removePlayer = async (p: PlayerProfile) => {
    if (!confirm(`Remover ${p.usernameDisplay} do cadastro local? A lista de acompanhados não é alterada.`))
      return;
    await repos.players.delete(p.userId);
    if (p.photoId) await removePhotoIfUnreferenced(p.photoId);
    await reload();
    notifyDataChanged('profiles');
  };

  const shown = players.filter(
    (p) =>
      !filter ||
      p.userId.includes(filter.toLowerCase()) ||
      (p.displayName ?? '').toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <section class="card" id="players">
      <header class="card-h">
        <h2>Jogadores e fotos</h2>
      </header>
      <p class="hint">
        Fotos ficam somente neste perfil do Chrome e não alteram o avatar no Lichess. Formatos: PNG, JPEG ou
        WebP até 5 MB e 4096×4096.
      </p>
      <div class="row">
        <label class="grow">
          Username no Lichess
          <input
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
          />
        </label>
        <button class="primary" onClick={() => void search()}>
          Pesquisar e confirmar
        </button>
      </div>
      {status ? (
        <p class="hint" role="status">
          {status}
        </p>
      ) : null}
      {editing ? (
        <div class="editor">
          <h3>
            {editing.usernameDisplay} <code>{editing.userId}</code>
          </h3>
          <label>
            Nome de exibição (opcional — não altera username nem ID)
            <input
              value={editing.displayName ?? ''}
              maxLength={60}
              onInput={(e) => setEditing({ ...editing, displayName: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label>
            Foto
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) void pickFile(f);
              }}
            />
          </label>
          {bitmap ? <PhotoEditor bitmap={bitmap} initial={null} onChange={setCrop} /> : null}
          <div class="row">
            <button class="primary" onClick={() => void save()}>
              Salvar
            </button>
            <button
              onClick={() => {
                bitmap?.close();
                setBitmap(null);
                setEditing(null);
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
      <div class="row">
        <label class="grow">
          Filtrar cadastro ({players.length})
          <input value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />
        </label>
      </div>
      <div class="player-grid">
        {shown.map((p) => (
          <div class="player" key={p.userId}>
            <div class="avatar">
              {p.photoId && urls.get(p.photoId) ? (
                <img src={urls.get(p.photoId)} alt="" />
              ) : (
                <span>{(p.displayName || p.usernameDisplay).slice(0, 2).toUpperCase()}</span>
              )}
            </div>
            <div class="pinfo">
              <strong>{p.displayName || p.usernameDisplay}</strong>
              <span class="muted">{p.usernameDisplay}</span>
            </div>
            <div class="actions">
              <button
                onClick={() => {
                  setEditing(p);
                  setStatus(null);
                }}
              >
                Editar
              </button>
              {p.photoId ? <button onClick={() => void removePhoto(p)}>Remover foto</button> : null}
              <button onClick={() => void removePlayer(p)} aria-label={`Remover ${p.usernameDisplay}`}>
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TeamsSection({ deps }: { deps: OptionsDeps }) {
  const repos = deps.persistence.repos;
  const [teams, setTeams] = useState<TeamProfile[]>([]);
  const [teamInput, setTeamInput] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<TeamProfile | null>(null);
  const [watch, setWatch] = useState<Watchlist | null>(null);
  const [filter, setFilter] = useState('');
  const [manual, setManual] = useState('');

  const reload = async () => setTeams(await repos.teams.list());
  useEffect(() => void reload(), []);
  useEffect(() => {
    if (selected) void repos.watchlists.get(selected.teamId).then((w) => setWatch(w ?? null));
  }, [selected?.teamId]);

  const importTeam = async () => {
    const teamId = asTeamId(teamInput);
    if (!teamId || teamId === LOCAL_LIST_ID) return setStatus('ID de team inválido.');
    setStatus('Importando membros públicos…');
    try {
      const info = await deps.client.teamInfo(teamId);
      const res = await deps.client.teamMembers(teamId);
      const existing = await repos.teams.get(teamId);
      const manualMembers = existing?.members.filter((m) => m.source === 'manual') ?? [];
      const members = new Map(manualMembers.map((m) => [m.userId, m]));
      for (const m of res.members)
        members.set(m.userId, { userId: m.userId, username: m.username, source: 'public-import' });
      const total = res.truncated ? null : (info.nbMembers ?? res.members.length);
      const coverage = computeCoverage(
        res.members.length,
        info.nbMembers ?? total,
        res.truncated ? `limite de ${LIMITS.maxTeamMembers}` : undefined,
      );
      const team: TeamProfile = {
        teamId,
        name: info.name,
        logoId: null,
        rosterCoverage: coverage,
        rosterFetchedAt: Date.now(),
        members: [...members.values()],
      };
      await repos.teams.put(team);
      await reload();
      setSelected(team);
      setStatus(
        `${res.members.length} membros importados de ${info.nbMembers ?? '?'} declarados${res.truncated ? ' (limite atingido)' : ''}. Complete manualmente se faltar alguém.`,
      );
      notifyDataChanged('teams');
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setStatus(
        err instanceof RateLimitedError
          ? 'Limitação de acesso do Lichess; tente após a pausa.'
          : /HTTP 40[13]/.test(text)
            ? 'A lista de membros deste team não é pública. Use o cadastro manual.'
            : /HTTP 404/.test(text)
              ? 'Team não encontrado.'
              : `Falha na importação: ${text}`,
      );
    }
  };

  const createLocalTeam = async () => {
    const teamId = asTeamId(teamInput);
    if (!teamId) return setStatus('ID inválido.');
    const existing = await repos.teams.get(teamId);
    const team: TeamProfile = existing ?? {
      teamId,
      name: teamId === LOCAL_LIST_ID ? 'Lista local' : teamId,
      logoId: null,
      rosterCoverage: { kind: 'unavailable', received: 0, total: null },
      rosterFetchedAt: null,
      members: [],
    };
    await repos.teams.put(team);
    await reload();
    setSelected(team);
  };

  const addManual = async () => {
    if (!selected) return;
    const ids = manual
      .split(/[\s,;]+/)
      .map((n) => ({ n, id: normalizeUserId(n) }))
      .filter((x): x is { n: string; id: UserId } => !!x.id);
    const members = new Map(selected.members.map((m) => [m.userId, m]));
    for (const { n, id } of ids)
      if (!members.has(id)) members.set(id, { userId: id, username: n.replace(/^@/, ''), source: 'manual' });
    const team = { ...selected, members: [...members.values()] };
    await repos.teams.put(team);
    setSelected(team);
    setManual('');
    await reload();
    notifyDataChanged('teams');
  };

  const toggleWatch = async (userId: UserId, username: string) => {
    if (!selected) return;
    const base: Watchlist = watch ?? {
      teamId: selected.teamId,
      profileId: 'default',
      userIds: [],
      favorites: [],
      manualOrder: [],
      updatedAt: 0,
    };
    const has = base.userIds.includes(userId);
    const next = {
      ...base,
      userIds: has ? base.userIds.filter((u) => u !== userId) : [...base.userIds, userId],
      updatedAt: Date.now(),
    };
    if (!has && !(await repos.players.get(userId))) {
      await repos.players.put({
        userId,
        usernameDisplay: username,
        displayName: null,
        photoId: null,
        crop: null,
        updatedAt: Date.now(),
      });
    }
    await repos.watchlists.put(next);
    setWatch(next);
    notifyDataChanged('watchlists');
  };

  const removeTeam = async (t: TeamProfile) => {
    if (!confirm(`Remover o team ${t.name} do cadastro local?`)) return;
    await repos.teams.delete(t.teamId);
    if (selected?.teamId === t.teamId) setSelected(null);
    await reload();
    notifyDataChanged('teams');
  };

  const members = (selected?.members ?? []).filter((m) => !filter || m.userId.includes(filter.toLowerCase()));
  return (
    <section class="card" id="teams">
      <header class="card-h">
        <h2>Teams, membros e acompanhados</h2>
      </header>
      <p class="hint">
        A importação usa a lista pública de membros (até {LIMITS.maxTeamMembers}). Listas privadas não são
        importadas nesta versão: use o cadastro manual. Em Team Battle, o vínculo no torneio prevalece sobre
        esta lista.
      </p>
      <div class="row">
        <label class="grow">
          ID do team (como na URL lichess.org/team/…) ou {LOCAL_LIST_ID}
          <input value={teamInput} onInput={(e) => setTeamInput((e.target as HTMLInputElement).value)} />
        </label>
        <button class="primary" onClick={() => void importTeam()}>
          Importar membros públicos
        </button>
        <button onClick={() => void createLocalTeam()}>Criar sem importar</button>
      </div>
      {status ? (
        <p class="hint" role="status">
          {status}
        </p>
      ) : null}
      <ul class="plain">
        {teams.map((t) => (
          <li key={t.teamId}>
            <button class={selected?.teamId === t.teamId ? 'primary' : ''} onClick={() => setSelected(t)}>
              {t.name}
            </button>{' '}
            <span class="muted">
              {t.members.length} membros · cobertura {t.rosterCoverage.kind}
              {t.rosterFetchedAt
                ? ` · importado em ${new Date(t.rosterFetchedAt).toLocaleString('pt-BR')}`
                : ''}
            </span>{' '}
            <button onClick={() => void removeTeam(t)} aria-label={`Remover ${t.name}`}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <div class="editor">
          <h3>
            {selected.name} — acompanhados: {watch?.userIds.length ?? 0}
          </h3>
          <div class="row">
            <label class="grow">
              Adicionar membros manualmente
              <input value={manual} onInput={(e) => setManual((e.target as HTMLInputElement).value)} />
            </label>
            <button onClick={() => void addManual()}>Adicionar</button>
          </div>
          <label>
            Filtrar membros
            <input value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />
          </label>
          <div class="scroll">
            <table class="grid">
              <tbody>
                {members.slice(0, 500).map((m) => (
                  <tr key={m.userId}>
                    <td>{m.username}</td>
                    <td class="muted">{m.source === 'manual' ? 'Cadastro manual' : 'Lista pública'}</td>
                    <td>
                      <label class="check">
                        <input
                          type="checkbox"
                          checked={watch?.userIds.includes(m.userId) ?? false}
                          onChange={() => void toggleWatch(m.userId, m.username)}
                        />
                        Acompanhar
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {members.length > 500 ? <p class="hint">Mostrando 500 de {members.length}; use o filtro.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function BackupSection({ deps, onImported }: { deps: OptionsDeps; onImported: () => void }) {
  const { repos, db } = deps.persistence;
  const [includeHistory, setIncludeHistory] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ p: BackupPreview; c: BackupContents } | null>(null);
  const [safety, setSafety] = useState<
    { backupId: string; createdAt: number; reason: string; blob: Blob; size: number }[]
  >([]);
  const reloadSafety = () => void listSafetyBackups(db).then(setSafety);
  useEffect(reloadSafety, []);

  const doExport = async () => {
    const { bytes } = await exportBackup(repos, { appVersion: deps.version, includeHistory, db });
    downloadBytes(
      bytes,
      `lichess-team-studio-backup-${new Date().toISOString().slice(0, 10)}.zip`,
      'application/zip',
    );
    setStatus(`Backup exportado (${Math.round(bytes.length / 1024)} KB).`);
  };
  const pick = async (file: File) => {
    setPreview(null);
    if (file.size > 260 * 1024 * 1024) return setStatus('Pacote grande demais.');
    const res = await inspectBackup(new Uint8Array(await file.arrayBuffer()), repos);
    if (!res.ok) return setStatus(`Pacote inválido — nada foi alterado. ${res.errors.join(' ')}`);
    setPreview({ p: res.preview, c: res.contents });
    setStatus(null);
  };
  const apply = async (mode: 'merge' | 'replace') => {
    if (!preview) return;
    const { bytes } = await exportBackup(repos, { appVersion: deps.version, includeHistory: false, db });
    await storeSafetyBackup(db, bytes, `antes de importar (${mode === 'merge' ? 'mesclar' : 'substituir'})`);
    try {
      await applyBackup(db, repos, preview.c, mode);
      setStatus(
        `Importação concluída (${mode === 'merge' ? 'mesclado' : 'substituído'}). Um backup anterior foi guardado abaixo.`,
      );
      notifyDataChanged('all');
      onImported();
    } catch (err) {
      if (err instanceof BackupSettingsError) {
        setStatus(`Importação parcial: ${err.message}. Ajuste as preferências manualmente.`);
        notifyDataChanged('all');
        onImported();
      } else {
        setStatus(
          `Falha ao aplicar; dados anteriores preservados. ${err instanceof Error ? err.message : ''}`,
        );
      }
    }
    setPreview(null);
    reloadSafety();
  };
  return (
    <section class="card" id="backup">
      <header class="card-h">
        <h2>Backup e restauração</h2>
      </header>
      <p class="hint">
        O backup (ZIP com manifest, hashes SHA-256, cadastro, configurações e fotos) não contém token,
        cookies, chat ou dados de sessão autenticada.
      </p>
      <div class="row">
        <label class="check">
          <input
            type="checkbox"
            checked={includeHistory}
            onChange={(e) => setIncludeHistory((e.target as HTMLInputElement).checked)}
          />
          Incluir histórico de sessões e observações
        </label>
        <button class="primary" onClick={() => void doExport()}>
          Exportar backup
        </button>
      </div>
      <div class="row">
        <label class="grow">
          Importar backup (.zip)
          <input
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) void pick(f);
            }}
          />
        </label>
      </div>
      {status ? (
        <p class="hint" role="status">
          {status}
        </p>
      ) : null}
      {preview ? (
        <div class="editor">
          <h3>Prévia da importação</h3>
          <p>
            Exportado em {preview.p.exportedAt} pela versão {preview.p.appVersion}: {preview.p.players}{' '}
            jogadores, {preview.p.photos} fotos, {preview.p.teams} teams, {preview.p.watchlists} listas de
            acompanhados, {preview.p.presets} presets
            {preview.p.includesHistory ? ' (histórico não é restaurado automaticamente)' : ''}.
          </p>
          <p>
            {preview.p.conflicts.length} conflito(s) com o cadastro atual
            {preview.p.conflicts.length
              ? `: ${preview.p.conflicts
                  .slice(0, 10)
                  .map((c) => c.userId)
                  .join(', ')}`
              : ''}
            .
          </p>
          <div class="row">
            <button class="primary" onClick={() => void apply('merge')}>
              Mesclar (o registro mais recente prevalece)
            </button>
            <button onClick={() => void apply('replace')}>Substituir cadastro</button>
            <button onClick={() => setPreview(null)}>Cancelar</button>
          </div>
        </div>
      ) : null}
      {safety.length ? (
        <>
          <h3>Backups automáticos anteriores à importação</h3>
          <ul class="plain">
            {safety.map((b) => (
              <li key={b.backupId}>
                {new Date(b.createdAt).toLocaleString('pt-BR')} · {b.reason} · {Math.round(b.size / 1024)} KB{' '}
                <button
                  onClick={() =>
                    void b.blob
                      .arrayBuffer()
                      .then((ab) =>
                        downloadBytes(
                          new Uint8Array(ab),
                          `lts-backup-anterior-${b.backupId.slice(0, 8)}.zip`,
                          'application/zip',
                        ),
                      )
                  }
                >
                  Baixar
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function StorageSection({ deps, settings }: { deps: OptionsDeps; settings: Settings }) {
  const repos = deps.persistence.repos;
  const [info, setInfo] = useState<{
    usage: number | null;
    quota: number | null;
    photos: number;
    local: number | null;
    sessions: number;
    observations: number;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const load = async () => {
    const est = navigator.storage?.estimate ? await navigator.storage.estimate() : {};
    const photos = await repos.photos.totalBytes();
    const local = chrome.storage.local.getBytesInUse ? await chrome.storage.local.getBytesInUse(null) : null;
    const sessions = await repos.sessions.list();
    let observations = 0;
    for (const s of sessions) observations += await repos.observations.countForSession(s.sessionId);
    setInfo({
      usage: est.usage ?? null,
      quota: est.quota ?? null,
      photos,
      local,
      sessions: sessions.length,
      observations,
    });
  };
  useEffect(() => void load(), []);
  const mb = (n: number | null) => (n === null ? '?' : `${(n / 1024 / 1024).toFixed(1)} MB`);
  const prune = async () => {
    const sessions = (await repos.sessions.list()).sort((a, b) => b.startedAt - a.startedAt);
    const old = sessions.slice(settings.retention.maxSessions);
    for (const s of old) {
      await repos.observations.deleteForSession(s.sessionId);
      await repos.sessions.delete(s.sessionId);
    }
    const removed = await repos.observations.deleteOlderThan(
      Date.now() - settings.retention.maxDays * 86_400_000,
    );
    setStatus(`${old.length} sessões antigas e ${removed} observações antigas descartadas.`);
    await load();
  };
  const overSessions = info ? info.sessions > settings.retention.maxSessions : false;
  const overPhotos = info ? info.photos > settings.retention.photosMb * 1024 * 1024 : false;
  return (
    <section class="card" id="storage">
      <header class="card-h">
        <h2>Armazenamento</h2>
      </header>
      {info ? (
        <dl class="kv">
          <dt>Total da extensão (IndexedDB e outros)</dt>
          <dd>
            {mb(info.usage)} de {mb(info.quota)} disponíveis
          </dd>
          <dt>Fotos</dt>
          <dd class={overPhotos ? 'warn' : ''}>
            {mb(info.photos)} (orçamento {settings.retention.photosMb} MB)
          </dd>
          <dt>Preferências (storage.local)</dt>
          <dd>{info.local === null ? '?' : `${Math.round(info.local / 1024)} KB`}</dd>
          <dt>Histórico</dt>
          <dd class={overSessions ? 'warn' : ''}>
            {info.sessions} sessões (limite {settings.retention.maxSessions}) · {info.observations}{' '}
            observações (mantidas por {settings.retention.maxDays} dias)
          </dd>
        </dl>
      ) : (
        <p>Calculando…</p>
      )}
      {overSessions ? (
        <p class="warn">Há mais sessões que o limite configurado. As mais antigas podem ser descartadas.</p>
      ) : null}
      <div class="row">
        <button onClick={() => void prune()}>Descartar sessões e observações além dos limites</button>
      </div>
      {status ? (
        <p class="hint" role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}

function PreferencesSection({
  deps,
  settings,
  onChange,
}: {
  deps: OptionsDeps;
  settings: Settings;
  onChange: (s: Settings) => void;
}) {
  const update = async (patch: Partial<Settings>) => {
    const next = await deps.persistence.repos.settings.update(patch);
    onChange(next);
    notifyDataChanged('settings');
  };
  return (
    <section class="card" id="prefs">
      <header class="card-h">
        <h2>Preferências</h2>
      </header>
      <div class="form-grid">
        <label>
          Fuso horário das horas exibidas
          <input
            value={settings.timezone}
            onChange={(e) => void update({ timezone: (e.target as HTMLInputElement).value })}
          />
        </label>
        <label>
          Cobertura pedida da classificação (nb, até 1000)
          <input
            type="number"
            min={10}
            max={1000}
            value={settings.rankingNb}
            onChange={(e) => void update({ rankingNb: Number((e.target as HTMLInputElement).value) })}
          />
        </label>
        <label>
          Intervalo nominal da classificação (s)
          <input
            type="number"
            min={15}
            max={300}
            value={settings.rankingIntervalSec}
            onChange={(e) =>
              void update({ rankingIntervalSec: Number((e.target as HTMLInputElement).value) })
            }
          />
        </label>
        <label>
          Intervalo do placar dos teams (s)
          <input
            type="number"
            min={30}
            max={300}
            value={settings.teamsIntervalSec}
            onChange={(e) => void update({ teamsIntervalSec: Number((e.target as HTMLInputElement).value) })}
          />
        </label>
        <label>
          Sessões mantidas
          <input
            type="number"
            min={1}
            max={500}
            value={settings.retention.maxSessions}
            onChange={(e) =>
              void update({
                retention: {
                  ...settings.retention,
                  maxSessions: Number((e.target as HTMLInputElement).value),
                },
              })
            }
          />
        </label>
        <label>
          Dias de observações
          <input
            type="number"
            min={1}
            max={365}
            value={settings.retention.maxDays}
            onChange={(e) =>
              void update({
                retention: { ...settings.retention, maxDays: Number((e.target as HTMLInputElement).value) },
              })
            }
          />
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={settings.autoSwitch}
            onChange={(e) => void update({ autoSwitch: (e.target as HTMLInputElement).checked })}
          />
          Troca automática ao acompanhar jogador (padrão: desligada)
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={settings.hideResultsDefault}
            onChange={(e) => void update({ hideResultsDefault: (e.target as HTMLInputElement).checked })}
          />
          Ocultar pontos e resultados por padrão
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={settings.inPageShortcuts}
            onChange={(e) => void update({ inPageShortcuts: (e.target as HTMLInputElement).checked })}
          />
          Atalhos também dentro da página de programa
        </label>
      </div>
      <p class="hint">
        Atalhos padrão: Alt+Shift+T (transmissão), Alt+Shift+B (girar), Alt+Shift+P (fixar), Alt+Shift+N
        (próxima partida do team). Para remapear, abra{' '}
        <button onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
          chrome://extensions/shortcuts
        </button>
        .
      </p>
    </section>
  );
}

export function OptionsApp({ deps }: { deps: OptionsDeps }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  /** Incrementado após uma importação: recarrega as seções a partir do armazenamento. */
  const [dataVersion, setDataVersion] = useState(0);
  useEffect(() => void deps.persistence.repos.settings.get().then(setSettings), [dataVersion]);
  return (
    <div class="options">
      <header class="studio-h">
        <h1>Lichess Team Studio · Cadastro e configurações</h1>
        <p class="muted">
          Versão {deps.version} · dados guardados apenas neste perfil do Chrome ·{' '}
          <a href="docs/privacidade.html" target="_blank">
            Política de dados locais
          </a>{' '}
          ·{' '}
          <a href="docs/licencas.html" target="_blank">
            Licenças
          </a>
        </p>
        {deps.persistence.open.migrationError ? (
          <p class="error">
            Falha de migração: {deps.persistence.open.migrationError}. Dados preservados — exporte um backup.
          </p>
        ) : null}
        <nav class="row">
          <a href="#players">Jogadores e fotos</a>
          <a href="#teams">Teams</a>
          <a href="#backup">Backup</a>
          <a href="#storage">Armazenamento</a>
          <a href="#prefs">Preferências</a>
        </nav>
      </header>
      <PlayersSection key={`p${dataVersion}`} deps={deps} />
      <TeamsSection key={`t${dataVersion}`} deps={deps} />
      <BackupSection deps={deps} onImported={() => setDataVersion((v) => v + 1)} />
      {settings ? <StorageSection key={`s${dataVersion}`} deps={deps} settings={settings} /> : null}
      {settings ? (
        <PreferencesSection key={`f${dataVersion}`} deps={deps} settings={settings} onChange={setSettings} />
      ) : null}
    </div>
  );
}
