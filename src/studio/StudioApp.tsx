import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TournamentSession } from '../application/session/tournamentSession';
import { formatClock } from '../domain/entities/clock';
import { coverageLabel } from '../domain/entities/coverage';
import { resultText, statusDescription } from '../domain/entities/game';
import type { TeamId, UserId } from '../domain/entities/ids';
import {
  asTeamId,
  asTournamentId,
  LOCAL_LIST_ID,
  normalizeUserId,
  parseGameIdInput,
} from '../domain/entities/ids';
import type { LayoutPreset, ReferenceMode, Watchlist } from '../domain/entities/profiles';
import { formatLabel, recognizeUrl } from '../domain/entities/tournament';
import { deltaLabel, referenceModeLabel } from '../domain/ranking/progress';
import { buildReport } from '../diagnostics';
import { BUILT_IN_PRESETS, sanitizePreset } from '../presentation/layouts/presets';
import type { ProgramTab } from '../shared/protocol/messages';
import type { RuntimeMessage } from '../shared/protocol/messages';
import { formatTime } from '../shared/time';
import { newId } from '../shared/validate';
import type { StudioRuntime } from './runtime';
import { downloadBytes } from '../shared/extension';
import { buildSessionReportCsv } from './sessionReport';

const TAB_LABEL: Record<ProgramTab, string> = {
  games: 'Partidas',
  team: 'Nosso team',
  ranking: 'Classificação',
  progress: 'Progresso',
  teams: 'Teams',
};

function useRuntimeTick(rt: StudioRuntime): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let pending = false;
    const bump = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        setN((x) => x + 1);
      }, 200);
    };
    const offC = rt.coordinator.onChange(bump);
    const offL = rt.log.subscribe(bump);
    const t = setInterval(bump, 1000);
    return () => {
      offC();
      offL();
      clearInterval(t);
    };
  }, [rt]);
  return n;
}

function Section(props: {
  title: string;
  children: preact.ComponentChildren;
  id?: string;
  right?: preact.ComponentChildren;
}) {
  return (
    <section class="card" id={props.id} aria-labelledby={props.id ? `${props.id}-h` : undefined}>
      <header class="card-h">
        <h2 id={props.id ? `${props.id}-h` : undefined}>{props.title}</h2>
        {props.right}
      </header>
      {props.children}
    </section>
  );
}

function OpenTournament({ rt }: { rt: StudioRuntime }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const open = () => {
    const direct = asTournamentId(text.trim());
    const rec = direct ? null : recognizeUrl(text.trim());
    const id = direct ?? (rec?.kind === 'tournament' ? rec.tournamentId : null);
    if (!id) {
      setErr('Informe o ID (8 caracteres) ou a URL de um torneio Arena.');
      return;
    }
    setErr(null);
    void rt.coordinator.ensureSession(id).then(() => rt.coordinator.focus(id));
  };
  return (
    <div class="row">
      <label class="grow">
        Preparar torneio (ID ou URL)
        <input
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          placeholder="https://lichess.org/tournament/AbCd1234"
        />
      </label>
      <button onClick={open}>Abrir sessão</button>
      {err ? (
        <p class="error" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}

function TournamentSection({ rt, s }: { rt: StudioRuntime; s: TournamentSession }) {
  const t = s.tournament;
  const programs = rt.coordinator.programsFor(s.tournamentId);
  const tz = rt.settings().timezone;
  const resize = (
    tabId: number | null,
    vp: { width: number; height: number; outerWidth: number; outerHeight: number; dpr: number },
    w: number,
    h: number,
  ) => {
    if (tabId === null) return;
    const cssW = Math.round(w / vp.dpr);
    const cssH = Math.round(h / vp.dpr);
    const msg: RuntimeMessage = {
      type: 'lts:resizeProgramWindow',
      tabId,
      width: cssW + (vp.outerWidth - vp.width),
      height: cssH + (vp.outerHeight - vp.height),
    };
    void chrome.runtime.sendMessage(msg);
  };
  return (
    <Section title="Torneio e sessão" id="sec-tournament">
      {t ? (
        <dl class="kv">
          <dt>Torneio</dt>
          <dd>
            <a href={`https://lichess.org/tournament/${s.tournamentId}`} target="_blank" rel="noreferrer">
              {t.name}
            </a>{' '}
            <span class="tag">{formatLabel(t.format)}</span>
            <span class="tag">
              {t.status === 'finished'
                ? 'Encerrado'
                : t.status === 'created'
                  ? 'Aguardando início'
                  : 'Em andamento'}
            </span>
          </dd>
          <dt>Participantes</dt>
          <dd>{t.nbPlayers ?? '?'}</dd>
          <dt>Variante</dt>
          <dd>{t.variant === 'standard' ? 'Xadrez padrão' : `${t.variant} — não suportada no tabuleiro`}</dd>
        </dl>
      ) : (
        <p>
          {s.tournamentError ? (
            <span class="error">Falha ao obter o torneio: {s.tournamentError}</span>
          ) : (
            'Carregando metadados…'
          )}
        </p>
      )}
      <dl class="kv">
        <dt>Sessão</dt>
        <dd>
          iniciada às {formatTime(s.record.startedAt, tz)} · <code>{s.sessionId.slice(0, 8)}</code>
        </dd>
      </dl>
      <div class="row">
        <button
          onClick={() => void rt.coordinator.restartSession(s.tournamentId, 'new')}
          title="Nova referência de progresso e nova seleção"
        >
          Iniciar nova sessão
        </button>
        <button onClick={() => void rt.coordinator.restartSession(s.tournamentId, 'continue')}>
          Continuar sessão anterior
        </button>
        <button onClick={() => s.requestRefresh()}>Atualizar agora</button>
      </div>
      <h3>Janelas de programa</h3>
      {programs.length === 0 ? (
        <p class="warn">
          Nenhuma aba do torneio em modo transmissão. Ative pelo ícone da extensão ou Alt+Shift+T na aba do
          Lichess.
        </p>
      ) : (
        <ul class="plain">
          {programs.map((p) => (
            <li key={p.channel.id}>
              Aba {p.channel.tabId ?? '?'} · área útil {p.page.viewport.width}×{p.page.viewport.height} px CSS
              (escala {Math.round(p.page.viewport.dpr * 100)}% ≈{' '}
              {Math.round(p.page.viewport.width * p.page.viewport.dpr)}×
              {Math.round(p.page.viewport.height * p.page.viewport.dpr)} capturados)
              <div class="row">
                <button onClick={() => resize(p.channel.tabId, p.page.viewport, 1920, 1080)}>
                  Ajustar para 1920×1080 úteis
                </button>
                <button onClick={() => resize(p.channel.tabId, p.page.viewport, 1280, 720)}>
                  Ajustar para 1280×720 úteis
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function TeamSection({ rt, s }: { rt: StudioRuntime; s: TournamentSession }) {
  const [savedTeams, setSavedTeams] = useState<{ teamId: string; name: string }[]>([]);
  const [teamInput, setTeamInput] = useState(s.record.teamId ?? '');
  const [addText, setAddText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [watch, setWatch] = useState<Watchlist | null>(null);
  const [members, setMembers] = useState<Set<string>>(new Set());
  const teamId = s.record.teamId;

  useEffect(() => {
    void rt.repos.teams
      .list()
      .then((ts) => setSavedTeams(ts.map((t) => ({ teamId: t.teamId, name: t.name }))));
  }, [rt]);
  useEffect(() => {
    setTeamInput(teamId ?? '');
    if (!teamId) {
      setWatch(null);
      setMembers(new Set());
      return;
    }
    void rt.repos.watchlists.get(teamId).then((w) => setWatch(w ?? null));
    void rt.repos.teams
      .get(teamId)
      .then((t) =>
        setMembers(
          new Set(t?.members.filter((m) => m.source === 'public-import').map((m) => m.userId) ?? []),
        ),
      );
  }, [rt, teamId, s.watchlist.length]);

  const isTB = s.tournament?.format === 'teamBattle';
  const applyTeam = async (value: string) => {
    const id = value === LOCAL_LIST_ID ? LOCAL_LIST_ID : value ? asTeamId(value) : null;
    if (value && !id) {
      setMsg('ID de team inválido.');
      return;
    }
    setMsg(null);
    await s.setTeam(id);
    await rt.setSettings({ lastTeamId: id });
  };

  const saveWatch = async (next: Watchlist) => {
    await rt.repos.watchlists.put(next);
    setWatch(next);
    await s.reloadLocalData();
    s.recomputeProgress();
  };

  const addPlayers = async () => {
    if (!teamId) return;
    const names = addText.split(/[\s,;]+/).filter(Boolean);
    const valid: UserId[] = [];
    const invalid: string[] = [];
    for (const n of names) {
      const id = normalizeUserId(n);
      if (id) valid.push(id);
      else invalid.push(n);
    }
    const base: Watchlist = watch ?? {
      teamId,
      profileId: 'default',
      userIds: [],
      favorites: [],
      manualOrder: [],
      updatedAt: 0,
    };
    for (const n of names) {
      const id = normalizeUserId(n);
      if (!id) continue;
      const existing = await rt.repos.players.get(id);
      if (!existing) {
        await rt.repos.players.put({
          userId: id,
          usernameDisplay: n.replace(/^@/, ''),
          displayName: null,
          photoId: null,
          crop: null,
          updatedAt: Date.now(),
        });
      }
    }
    await saveWatch({ ...base, userIds: [...new Set([...base.userIds, ...valid])], updatedAt: Date.now() });
    setAddText('');
    setMsg(
      invalid.length
        ? `Ignorados (inválidos): ${invalid.join(', ')}`
        : `${valid.length} jogador(es) adicionados.`,
    );
  };

  const remove = (id: UserId) =>
    watch &&
    void saveWatch({
      ...watch,
      userIds: watch.userIds.filter((u) => u !== id),
      favorites: watch.favorites.filter((u) => u !== id),
      updatedAt: Date.now(),
    });
  const toggleFav = (id: UserId) =>
    watch &&
    void saveWatch({
      ...watch,
      favorites: watch.favorites.includes(id)
        ? watch.favorites.filter((u) => u !== id)
        : [...watch.favorites, id],
      updatedAt: Date.now(),
    });

  const tracked = s.trackedUserIds();
  return (
    <Section title="Team e jogadores acompanhados" id="sec-team">
      <div class="row">
        {isTB ? (
          <label class="grow">
            Team no Team Battle
            <select
              value={teamId ?? ''}
              onChange={(e) => void applyTeam((e.target as HTMLSelectElement).value)}
            >
              <option value="">(nenhum)</option>
              <option value={LOCAL_LIST_ID}>Lista local (sem team)</option>
              {(s.tournament?.teams ?? [])
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((t) => (
                  <option key={t.teamId} value={t.teamId}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <>
            <label class="grow">
              Team (ID do Lichess) ou lista local
              <input
                list="saved-teams"
                value={teamInput}
                onInput={(e) => setTeamInput((e.target as HTMLInputElement).value)}
                placeholder="ex.: meu-clube ou _local"
              />
              <datalist id="saved-teams">
                <option value={LOCAL_LIST_ID}>Lista local</option>
                {savedTeams.map((t) => (
                  <option key={t.teamId} value={t.teamId}>
                    {t.name}
                  </option>
                ))}
              </datalist>
            </label>
            <button onClick={() => void applyTeam(teamInput.trim())}>Usar</button>
          </>
        )}
      </div>
      {isTB ? (
        <p class="hint">
          Em Team Battle, o vínculo do jogador vem do team dele neste torneio (tem precedência sobre o
          cadastro).
        </p>
      ) : null}
      {msg ? (
        <p class="hint" role="status">
          {msg}
        </p>
      ) : null}
      {!teamId ? (
        <p class="warn">Selecione um team ou a lista local para montar os acompanhados.</p>
      ) : (
        <>
          <div class="row">
            <label class="grow">
              Adicionar usernames (separados por vírgula ou espaço)
              <input
                value={addText}
                onInput={(e) => setAddText((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => e.key === 'Enter' && void addPlayers()}
              />
            </label>
            <button onClick={() => void addPlayers()}>Adicionar</button>
            <button onClick={() => void chrome.runtime.openOptionsPage()}>
              Fotos e importação de membros…
            </button>
          </div>
          <table class="grid">
            <thead>
              <tr>
                <th>Jogador</th>
                <th>Origem</th>
                <th>No torneio</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {tracked.length === 0 ? (
                <tr>
                  <td colSpan={4}>Nenhum jogador acompanhado.</td>
                </tr>
              ) : null}
              {tracked.map((id) => {
                const entry = s.snapshot?.byUser.get(id);
                const profile = s.profiles.get(id);
                const inWatch = watch?.userIds.includes(id) ?? false;
                const origins = [
                  profile ? 'Cadastro local' : null,
                  members.has(id) ? 'Membro (importado)' : null,
                  !inWatch && isTB ? 'Vínculo no torneio' : null,
                ].filter(Boolean);
                return (
                  <tr key={id}>
                    <td>
                      {watch?.favorites.includes(id) ? '★ ' : ''}
                      {profile?.displayName || entry?.username || profile?.usernameDisplay || id}
                    </td>
                    <td>{origins.join(' · ') || '—'}</td>
                    <td>
                      {entry
                        ? `${entry.rank}º · ${entry.score} pts${entry.teamId && isTB ? ` · ${s.teamNames.get(entry.teamId as TeamId) ?? entry.teamId}` : ''}`
                        : s.snapshot
                          ? s.snapshot.coverage.kind === 'complete'
                            ? 'Não inscrito'
                            : 'Fora do recorte'
                          : '—'}
                    </td>
                    <td class="actions">
                      <button onClick={() => void s.selectPlayer(id, 'pinned')}>Abrir partida</button>
                      <button onClick={() => void s.selectPlayer(id, 'follow')}>Acompanhar</button>
                      {inWatch ? (
                        <>
                          <button onClick={() => toggleFav(id)} aria-label="Favorito">
                            {watch?.favorites.includes(id) ? '★' : '☆'}
                          </button>
                          <button onClick={() => remove(id)} aria-label="Remover">
                            ✕
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}

function playerLabel(s: TournamentSession, userId: UserId | null): string {
  if (!userId) return '—';
  const p = s.profiles.get(userId);
  return p?.displayName || s.snapshot?.byUser.get(userId)?.username || p?.usernameDisplay || userId;
}

function noticeText(s: TournamentSession): string | null {
  const n = s.selection.notice;
  if (!n) return null;
  switch (n.kind) {
    case 'resolving':
      return `Resolvendo a partida atual de ${n.userId}…`;
    case 'noCurrentGame':
      return `${n.userId}: não há partida atual confirmada${n.lastGameId ? '. A última partida está disponível como replay.' : '.'}`;
    case 'unlinked':
      return `Partida ${n.gameId} sem vínculo confirmado com este torneio.`;
    case 'otherTournament':
      return `A partida ${n.gameId} pertence a outro torneio e não será exibida.`;
    case 'notFound':
      return `Nenhuma partida encontrada para ${n.userId}.`;
    case 'unsupportedVariant':
      return `Variante não suportada (${n.variant}).`;
    case 'invalidGame':
      return `Não foi possível carregar ${n.gameId}: ${n.reason}`;
    case 'error':
      return n.message;
  }
}

function streamText(s: TournamentSession, tz: string): string {
  const st = s.streamState;
  switch (st.kind) {
    case 'idle':
      return 'Sem stream';
    case 'connecting':
      return 'Conectando…';
    case 'live':
      return s.lastStreamMessageAt
        ? `Recebendo · última posição às ${formatTime(s.lastStreamMessageAt, tz, true)}`
        : 'Recebendo';
    case 'reconnecting':
      return `Sem conexão (${st.error}) · tentativa ${st.attempt} às ${formatTime(st.retryAt, tz, true)}`;
    case 'ended':
      return 'Stream encerrado após o resultado';
    case 'paused':
      return `Pausado por limitação de acesso até ${formatTime(st.until, tz, true)}`;
    case 'error':
      return `Erro: ${st.error}`;
  }
}

function GameSection({ rt, s }: { rt: StudioRuntime; s: TournamentSession }) {
  const [gameInput, setGameInput] = useState('');
  const [userInput, setUserInput] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [nextMsg, setNextMsg] = useState<string | null>(null);
  const tz = rt.settings().timezone;
  const g = s.game;
  const sel = s.selection;
  const notice = noticeText(s);
  const goNextTeamGame = async () => {
    const r = await s.nextTeamGame();
    setNextMsg(
      r === 'switched'
        ? null
        : r === 'only'
          ? 'Esta é a única partida do team em andamento conhecida.'
          : 'Nenhuma partida do team em andamento conhecida agora. A busca foi antecipada; tente de novo em alguns segundos.',
    );
  };
  const games = useMemo(
    () =>
      [...s.identifiedGames.values()]
        .filter((x) => x.status !== 'finished')
        .sort(
          (a, b) =>
            Math.min(...a.players.map((p) => s.snapshot?.byUser.get(p.userId)?.rank ?? p.rank ?? 1e9)) -
            Math.min(...b.players.map((p) => s.snapshot?.byUser.get(p.userId)?.rank ?? p.rank ?? 1e9)),
        )
        .slice(0, 60),
    [s.identifiedGames.size, s.snapshot, s.tournament?.fetchedAt],
  );
  const tracked = new Set(s.trackedUserIds());
  return (
    <Section title="Partida principal" id="sec-game">
      {g ? (
        <div class="game-now">
          <div>
            <strong>{g.identity.white.name}</strong> ({g.identity.white.rating ?? '?'}) ×{' '}
            <strong>{g.identity.black.name}</strong> ({g.identity.black.rating ?? '?'})
          </div>
          <div class="muted">
            <a href={`https://lichess.org/${g.identity.gameId}`} target="_blank" rel="noreferrer">
              {g.identity.gameId}
            </a>{' '}
            · relógios da posição transmitida: {formatClock(g.position?.clocks.whiteMs ?? null)} /{' '}
            {formatClock(g.position?.clocks.blackMs ?? null)} · geração {g.generation}
          </div>
          <div>
            Modo:{' '}
            <strong>
              {sel.mode === 'pinned'
                ? 'Partida fixada'
                : sel.mode === 'follow'
                  ? `Acompanhando ${playerLabel(s, sel.followedUserId)}`
                  : 'Replay'}
            </strong>{' '}
            · Orientação: {sel.orientation === 'white' ? 'brancas embaixo' : 'pretas embaixo'}
          </div>
          {g.outcome ? (
            <div>
              Resultado (fonte do tabuleiro): {resultText(g.outcome)} ·{' '}
              {statusDescription(g.outcome.status, g.outcome.winner)}
            </div>
          ) : null}
          <div class="muted">Stream: {streamText(s, tz)}</div>
        </div>
      ) : (
        <p>Nenhuma partida carregada.</p>
      )}
      {sel.pending ? (
        <p class="hint" role="status">
          Carregando {sel.pending.gameId}… o tabuleiro anterior continua visível até o pacote completo chegar.
        </p>
      ) : null}
      {s.earlyOutcome ? (
        <p class="warn" role="alert">
          Resultado antecipado ({s.earlyOutcome.source}):{' '}
          {resultText(s.earlyOutcome.outcome) ?? s.earlyOutcome.outcome.status}. O banner do programa aguarda
          a fonte do tabuleiro.
        </p>
      ) : null}
      {notice ? (
        <div class="notice" role="status">
          {notice}
          {sel.notice?.kind === 'noCurrentGame' && sel.notice.lastGameId ? (
            <button onClick={() => s.acceptReplay()}>Mostrar como replay</button>
          ) : null}
          {sel.notice?.kind === 'unlinked' ? (
            <button onClick={() => s.acceptUnlinked()}>Exibir mesmo assim</button>
          ) : null}
        </div>
      ) : null}
      {sel.suggestion ? (
        <div class="notice suggestion" role="alert">
          Nova partida de {sel.suggestion.forUserId} identificada ({sel.suggestion.gameId}).
          <button class="primary" onClick={() => s.acceptSuggestion()}>
            Trocar
          </button>
          <button onClick={() => s.dismissSuggestion()}>Ignorar</button>
        </div>
      ) : null}
      <div class="row">
        <button class="primary" onClick={() => void goNextTeamGame()} title="Alt+Shift+N">
          Próxima partida do team ▶
        </button>
        <button onClick={() => s.flip()} title="Alt+Shift+B">
          Girar tabuleiro
        </button>
        <button onClick={() => s.pin()} disabled={!sel.gameId} title="Alt+Shift+P">
          Fixar partida
        </button>
        {g?.identity.white.userId ? (
          <button onClick={() => s.follow(g.identity.white.userId!)}>Acompanhar brancas</button>
        ) : null}
        {g?.identity.black.userId ? (
          <button onClick={() => s.follow(g.identity.black.userId!)}>Acompanhar pretas</button>
        ) : null}
        <label class="check">
          <input
            type="checkbox"
            checked={sel.autoSwitch}
            onChange={(e) => void rt.setSettings({ autoSwitch: (e.target as HTMLInputElement).checked })}
          />
          Troca automática ao acompanhar
        </label>
      </div>
      <div class="row">
        <label class="grow">
          Jogador (username)
          <input value={userInput} onInput={(e) => setUserInput((e.target as HTMLInputElement).value)} />
        </label>
        <button
          onClick={() => {
            const id = normalizeUserId(userInput);
            if (!id) return setErr('Username inválido.');
            setErr(null);
            void s.selectPlayer(id, 'follow');
          }}
        >
          Acompanhar jogador
        </button>
        <label class="grow">
          Partida (ID ou URL)
          <input value={gameInput} onInput={(e) => setGameInput((e.target as HTMLInputElement).value)} />
        </label>
        <button
          onClick={() => {
            const id = parseGameIdInput(gameInput);
            if (!id) return setErr('ID de partida inválido.');
            setErr(null);
            s.selectGame(id, { mode: 'pinned', explicit: true });
          }}
        >
          Abrir partida
        </button>
      </div>
      {nextMsg ? (
        <p class="hint" role="status">
          {nextMsg}
        </p>
      ) : null}
      {err ? (
        <p class="error" role="alert">
          {err}
        </p>
      ) : null}
      <h3>Partidas identificadas ({games.length})</h3>
      <p class="hint">
        Lista oportunista (duelos informados pelo torneio e partidas resolvidas); não inclui todas as
        partidas.
      </p>
      <div class="scroll">
        <table class="grid">
          <tbody>
            {games.map((x) => {
              const fav = x.players.some((p) => tracked.has(p.userId));
              return (
                <tr key={x.gameId} class={x.gameId === sel.gameId ? 'selected' : ''}>
                  <td>{fav ? '★' : ''}</td>
                  <td>
                    {x.players
                      .map(
                        (p) =>
                          `${p.name}${s.snapshot?.byUser.get(p.userId)?.rank ? ` (${s.snapshot.byUser.get(p.userId)!.rank}º)` : ''}`,
                      )
                      .join(' × ')}
                  </td>
                  <td>{x.status === 'playing' ? 'Em andamento' : 'Desconhecido'}</td>
                  <td>
                    <button onClick={() => s.selectGame(x.gameId, { mode: 'pinned', explicit: false })}>
                      Abrir
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function ProgramSection({ rt, s }: { rt: StudioRuntime; s: TournamentSession }) {
  const [presets, setPresets] = useState<LayoutPreset[]>([]);
  const [editing, setEditing] = useState<LayoutPreset | null>(null);
  useEffect(() => {
    void rt.repos.presets.list().then(setPresets);
  }, [rt]);
  const all = [...BUILT_IN_PRESETS, ...presets];
  const current = rt.coordinator.presetFor(s.presetId);
  const tabs: ProgramTab[] =
    s.tournament?.format === 'teamBattle'
      ? ['games', 'team', 'ranking', 'progress', 'teams']
      : ['games', 'team', 'ranking', 'progress'];

  const choose = async (id: string) => {
    s.setPreset(id);
    await rt.setSettings({ activePresetId: id });
  };
  const savePreset = async () => {
    if (!editing) return;
    const clean = sanitizePreset({
      ...editing,
      presetId: editing.builtIn ? `custom-${newId().slice(0, 8)}` : editing.presetId,
    });
    if (!clean) return;
    await rt.repos.presets.put(clean);
    const list = await rt.repos.presets.list();
    setPresets(list);
    rt.coordinator.setCustomPresets(list);
    await choose(clean.presetId);
    setEditing(null);
  };
  const delPreset = async (id: string) => {
    await rt.repos.presets.delete(id);
    const list = await rt.repos.presets.list();
    setPresets(list);
    rt.coordinator.setCustomPresets(list);
    if (s.presetId === id) await choose('single-1080');
  };
  const set = (path: string, value: number | boolean | string) => {
    if (!editing) return;
    const copy = JSON.parse(JSON.stringify(editing)) as LayoutPreset;
    const [a, b] = path.split('.') as [keyof LayoutPreset, string];
    if (b) (copy[a] as unknown as Record<string, unknown>)[b] = value;
    else (copy as unknown as Record<string, unknown>)[a] = value;
    setEditing(copy);
  };
  return (
    <Section title="Programa (composição capturada)" id="sec-program">
      <div class="row" role="radiogroup" aria-label="Aba exibida no programa">
        {tabs.map((t) => (
          <button
            key={t}
            class={s.activeTab === t ? 'primary' : ''}
            aria-pressed={s.activeTab === t}
            onClick={() => s.setTab(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <div class="row">
        <label class="check">
          <input
            type="checkbox"
            checked={s.hideResults}
            onChange={(e) => s.setHideResults((e.target as HTMLInputElement).checked)}
          />
          Ocultar pontos e resultados (evitar spoilers)
        </label>
      </div>
      <div class="row">
        <label class="check">
          <input
            type="checkbox"
            checked={rt.settings().rotateTabsSec > 0}
            onChange={(e) =>
              void rt.setSettings({ rotateTabsSec: (e.target as HTMLInputElement).checked ? 20 : 0 })
            }
          />
          Rodar as abas automaticamente
        </label>
        {rt.settings().rotateTabsSec > 0 ? (
          <label>
            a cada (s)
            <input
              type="number"
              min={10}
              max={600}
              value={rt.settings().rotateTabsSec}
              onChange={(e) =>
                void rt.setSettings({ rotateTabsSec: Number((e.target as HTMLInputElement).value) })
              }
            />
          </label>
        ) : null}
        <label class="check">
          <input
            type="checkbox"
            checked={rt.settings().gamesOnlyTracked}
            onChange={(e) =>
              void rt.setSettings({ gamesOnlyTracked: (e.target as HTMLInputElement).checked })
            }
          />
          Aba Partidas: só partidas com acompanhados
        </label>
      </div>
      <p class="hint">A rotação pula abas sem conteúdo; escolher uma aba reinicia a contagem.</p>
      <div class="row">
        <label class="grow">
          Preset
          <select
            value={current.presetId}
            onChange={(e) => void choose((e.target as HTMLSelectElement).value)}
          >
            {all.map((p) => (
              <option key={p.presetId} value={p.presetId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => setEditing(JSON.parse(JSON.stringify(current)) as LayoutPreset)}>
          Editar como novo…
        </button>
        {!current.builtIn ? (
          <button onClick={() => void delPreset(current.presetId)}>Excluir preset</button>
        ) : null}
      </div>
      {editing ? (
        <div class="editor">
          <label>
            Nome{' '}
            <input value={editing.name} onInput={(e) => set('name', (e.target as HTMLInputElement).value)} />
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={editing.slots.webcam}
              onChange={(e) => set('slots.webcam', (e.target as HTMLInputElement).checked)}
            />{' '}
            Área de webcam/logo à esquerda
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={editing.slots.side}
              onChange={(e) => set('slots.side', (e.target as HTMLInputElement).checked)}
            />{' '}
            Lateral com abas
          </label>
          {(
            [
              ['dimensions.margin', 'Margem (px @1080p)', 0, 160],
              ['dimensions.leftWidth', 'Largura da área esquerda', 0, 800],
              ['dimensions.sideWidth', 'Largura da lateral', 200, 900],
              ['dimensions.gap', 'Intervalo', 0, 80],
              ['safeMargins.top', 'Margem segura superior', 0, 200],
              ['safeMargins.bottom', 'Margem segura inferior', 0, 200],
              ['safeMargins.left', 'Margem segura esquerda', 0, 200],
              ['safeMargins.right', 'Margem segura direita', 0, 200],
            ] as const
          ).map(([path, label, min, max]) => {
            const [a, b] = path.split('.') as [keyof LayoutPreset, string];
            const value = (editing[a] as unknown as Record<string, number>)[b];
            return (
              <label key={path}>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  value={value}
                  onInput={(e) => set(path, Number((e.target as HTMLInputElement).value))}
                />
              </label>
            );
          })}
          <label>
            Escala de texto
            <input
              type="number"
              step="0.05"
              min="0.7"
              max="1.6"
              value={editing.typography.scale}
              onInput={(e) => set('typography.scale', Number((e.target as HTMLInputElement).value))}
            />
          </label>
          <div class="row">
            <button class="primary" onClick={() => void savePreset()}>
              Salvar preset
            </button>
            <button onClick={() => setEditing(null)}>Cancelar</button>
          </div>
        </div>
      ) : null}
      <p class="hint">Trocar preset ou aba não reinicia o stream nem a seleção.</p>
    </Section>
  );
}

function ProgressSection({ rt, s }: { rt: StudioRuntime; s: TournamentSession }) {
  const tz = rt.settings().timezone;
  const rows = s.progress.get('general') ?? [];
  const watchedRows = new Map((s.progress.get('watched') ?? []).map((r) => [r.userId, r]));
  const modes: ReferenceMode[] = ['sessionStart', 'lastUpdate', 'manualMark'];
  return (
    <Section title="Progresso de posição" id="sec-progress">
      <div class="row" role="radiogroup" aria-label="Referência">
        {modes.map((m) => (
          <label class="check" key={m}>
            <input
              type="radio"
              name="refmode"
              checked={s.record.referenceMode === m}
              onChange={() => void s.setReferenceMode(m)}
            />
            {referenceModeLabel(m)}
          </label>
        ))}
      </div>
      <div class="row">
        <button onClick={() => void s.markReference()}>Marcar referência agora</button>
        <button
          onClick={() => void s.newReference()}
          title="Inicia nova referência preservando os registros anteriores"
        >
          Nova referência
        </button>
        <span class="muted">
          {s.referenceStartAt
            ? `Primeira observação às ${formatTime(s.referenceStartAt, tz)}`
            : 'Sem observações'}
          {s.record.referenceMarkedAt ? ` · marcação às ${formatTime(s.record.referenceMarkedAt, tz)}` : ''}
        </span>
      </div>
      <table class="grid">
        <thead>
          <tr>
            <th>Jogador</th>
            <th>Atual</th>
            <th>Referência</th>
            <th>Variação (geral)</th>
            <th>Entre acompanhados</th>
            <th>Pontos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const w = watchedRows.get(r.userId);
            return (
              <tr key={r.userId}>
                <td>
                  {s.profiles.get(r.userId)?.displayName ||
                    s.snapshot?.byUser.get(r.userId)?.username ||
                    r.userId}
                </td>
                <td>{r.currentRank ? `${r.currentRank}º` : '—'}</td>
                <td>{r.referenceRank ? `${r.referenceRank}º` : '—'}</td>
                <td>
                  {deltaLabel(r)}
                  {r.confirmed ? ' (confirmado)' : ''}
                  {r.stale ? ' · sem atualização' : ''}
                </td>
                <td>
                  {w ? `${w.currentRank !== null ? `${w.currentRank}º` : '—'} · ${deltaLabel(w)}` : '—'}
                </td>
                <td>{r.deltaScore !== null ? `${r.deltaScore > 0 ? '+' : ''}${r.deltaScore}` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="hint">
        Variação de posição (deltaRank) é separada da variação de pontos (deltaScore) e de rating. Posições
        são observadas a cada coleta e provisórias até o fim.
      </p>
    </Section>
  );
}

function RankingSection({ rt, s }: { rt: StudioRuntime; s: TournamentSession }) {
  const tz = rt.settings().timezone;
  const snap = s.snapshot;
  return (
    <Section title="Classificação e coletas" id="sec-ranking">
      <dl class="kv">
        <dt>Estado</dt>
        <dd>
          {snap ? (snap.provisional ? 'Provisória (observada durante o torneio)' : 'Final') : 'Sem dados'}
        </dd>
        <dt>Cobertura</dt>
        <dd>{snap ? coverageLabel(snap.coverage) : 'Indisponível'}</dd>
        <dt>Última coleta válida</dt>
        <dd>
          {snap ? `${formatTime(snap.startedAt, tz, true)} → ${formatTime(snap.endedAt, tz, true)}` : '—'}
        </dd>
        <dt>Última tentativa</dt>
        <dd>
          {s.lastCollection
            ? `${formatTime(s.lastCollection.at, tz, true)} · ${s.lastCollection.ok ? 'ok' : `falhou: ${s.lastCollection.problems.join('; ')}`}`
            : '—'}
        </dd>
        <dt>Lotes rejeitados</dt>
        <dd>{s.rejectedBatches}</dd>
        {s.tournament?.format === 'teamBattle' ? (
          <>
            <dt>Placar dos teams</dt>
            <dd>
              {s.teamStandingsAt
                ? `atualizado às ${formatTime(s.teamStandingsAt, tz, true)} · ${s.teamStandings?.length ?? 0} teams`
                : '—'}
            </dd>
          </>
        ) : null}
      </dl>
      <div class="row">
        <label>
          Cobertura pedida (nb)
          <input
            type="number"
            min={10}
            max={1000}
            value={rt.settings().rankingNb}
            onChange={(e) => void rt.setSettings({ rankingNb: Number((e.target as HTMLInputElement).value) })}
          />
        </label>
        <label>
          Intervalo da coleta (s)
          <input
            type="number"
            min={15}
            max={300}
            value={rt.settings().rankingIntervalSec}
            onChange={(e) =>
              void rt.setSettings({ rankingIntervalSec: Number((e.target as HTMLInputElement).value) })
            }
          />
        </label>
      </div>
    </Section>
  );
}

function DiagnosticsSection({ rt, s }: { rt: StudioRuntime; s: TournamentSession | null }) {
  const tz = rt.settings().timezone;
  const q = rt.queue.state();
  const events = rt.log.list().slice(-60).reverse();
  const metric = (name: keyof typeof rt.metrics) => {
    const m = rt.metrics[name];
    const p95 = m.percentile(95);
    return `${m.count()} amostras · p95 ${p95 === null ? '—' : `${Math.round(p95)} ms`}`;
  };
  const exportDiag = () => {
    const report = buildReport(rt.version, rt.log, rt.metrics, {
      queue: q,
      streams: rt.hub.activeCount(),
      sessions: [...rt.coordinator.sessions.values()].map((x) => ({
        tournamentId: x.tournamentId,
        sessionId: x.sessionId,
        stream: x.streamState,
        selection: { gameId: x.selection.gameId, mode: x.selection.mode, generation: x.selection.generation },
        scheduler: x.schedulerStatus(),
        coverage: x.snapshot?.coverage ?? null,
      })),
    });
    downloadBytes(
      JSON.stringify(report, null, 2),
      `lts-diagnostico-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`,
      'application/json',
    );
  };
  return (
    <Section
      title="Diagnóstico"
      id="sec-diag"
      right={<button onClick={exportDiag}>Exportar diagnóstico</button>}
    >
      <dl class="kv">
        <dt>Fila REST</dt>
        <dd>
          {q.pausedUntil ? (
            <span class="warn">
              Pausada por limitação de acesso até {formatTime(q.pausedUntil, tz, true)}
            </span>
          ) : (
            'Ativa'
          )}{' '}
          · pendentes {q.pending}
          {q.inFlightKey ? ` · em andamento: ${q.inFlightKey.split(':')[0]}` : ''}
          {q.lastError ? ` · último erro: ${q.lastError}` : ''} · fator de frequência{' '}
          {q.frequencyFactor.toFixed(2)}
        </dd>
        <dt>Streams ativos</dt>
        <dd>{rt.hub.activeCount()} (limite documentado: 8 por IP; o produto usa 1 por sessão)</dd>
        <dt>Evento → composição</dt>
        <dd>{metric('eventToRender')} (meta p95 ≤ 150 ms)</dd>
        <dt>Troca de partida</dt>
        <dd>{metric('switchToBoard')}</dd>
        <dt>Coleta de ranking</dt>
        <dd>{metric('rankingCollection')}</dd>
        {s ? (
          <>
            <dt>Tarefas</dt>
            <dd>
              {s.schedulerStatus().map((t) => (
                <div key={t.name}>
                  {t.name}: {t.running ? 'em execução' : `próxima às ${formatTime(t.nextAt, tz, true)}`}
                  {t.failures ? ` · falhas ${t.failures}` : ''}
                  {t.lastError ? ` · ${t.lastError}` : ''}
                </div>
              ))}
            </dd>
          </>
        ) : null}
      </dl>
      <div class="scroll log">
        {events.map((e, i) => (
          <div key={i} class={`log-${e.level}`}>
            {formatTime(e.at, tz, true)} [{e.channel}] {e.event}
            {e.durationMs !== undefined ? ` (${e.durationMs} ms)` : ''}
            {e.coverage ? ` · ${e.coverage}` : ''}
            {e.error ? ` · ${e.error}` : ''}
            {e.detail ? ` · ${e.detail}` : ''}
          </div>
        ))}
      </div>
    </Section>
  );
}

export function StudioApp({ rt }: { rt: StudioRuntime }) {
  useRuntimeTick(rt);
  const s = rt.coordinator.focused;
  const sessions = [...rt.coordinator.sessions.values()];
  return (
    <div class="studio">
      <header class="studio-h">
        <div class="op-stripe" aria-hidden="true" />
        <h1>Painel de operação · Lichess Team Studio {rt.version}</h1>
        <p class="muted">
          Esta janela é de operação — não a capture no OBS. Capture somente a janela do Lichess em modo
          transmissão.
        </p>
        {!rt.owner ? (
          <p class="error" role="alert">
            Outra janela de operação já está aberta. Feche esta janela e use a existente.
          </p>
        ) : null}
        {rt.persistence.open.migrationError ? (
          <p class="error" role="alert">
            Falha na migração do banco local: {rt.persistence.open.migrationError}. Os dados foram
            preservados; exporte um backup nas configurações.
          </p>
        ) : null}
        <div class="row">
          {sessions.length > 1 ? (
            <label>
              Torneio no painel
              <select
                value={s?.tournamentId ?? ''}
                onChange={(e) => rt.coordinator.focus((e.target as HTMLSelectElement).value as never)}
              >
                {sessions.map((x) => (
                  <option key={x.tournamentId} value={x.tournamentId}>
                    {x.tournament?.name ?? x.tournamentId}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {s ? (
            <button
              onClick={() =>
                downloadBytes(
                  buildSessionReportCsv(s, rt.settings().timezone),
                  `lts-relatorio-${s.tournamentId}.csv`,
                  'text/csv',
                )
              }
            >
              Relatório da sessão (CSV)
            </button>
          ) : null}
          <button onClick={() => void chrome.runtime.openOptionsPage()}>Cadastro, fotos e backup</button>
        </div>
      </header>
      {!s ? (
        <Section title="Começar" id="sec-start">
          <ol>
            <li>Abra a página de um torneio Arena no Lichess.</li>
            <li>Ative o modo transmissão pelo ícone da extensão ou Alt+Shift+T.</li>
            <li>A sessão aparece aqui automaticamente.</li>
          </ol>
          <OpenTournament rt={rt} />
        </Section>
      ) : (
        <div class="cols">
          <div class="col">
            <GameSection rt={rt} s={s} />
            <ProgramSection rt={rt} s={s} />
            <ProgressSection rt={rt} s={s} />
          </div>
          <div class="col">
            <TournamentSection rt={rt} s={s} />
            <TeamSection rt={rt} s={s} />
            <RankingSection rt={rt} s={s} />
            <DiagnosticsSection rt={rt} s={s} />
          </div>
        </div>
      )}
    </div>
  );
}
