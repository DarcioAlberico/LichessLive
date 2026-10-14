import { memo } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ProgramIntent, ProgramTab } from '../../shared/protocol/messages';
import { formatDuration } from '../../shared/time';
import { BoardView } from '../board/boardView';
import { PIECE_SVG } from '../board/pieces.generated';
import type { PieceCode } from '../../domain/entities/fen';
import type { ComputedLayout } from '../layouts/presets';
import { computeLayout } from '../layouts/presets';
import type {
  BoardVM,
  GamePlayerVM,
  GameRowVM,
  MainGameVM,
  PlayerCardVM,
  ProgramViewModel,
  ProgressRowVM,
  RankingRowVM,
  TeamRowVM,
  TeamStandingRowVM,
} from '../viewModels/types';
import { VirtualList } from './VirtualList';

export type PanelLink = 'connecting' | 'connected' | 'disconnected';

export interface ProgramProps {
  vm: ProgramViewModel | null;
  photoUrl: (photoId: string | null) => string | null;
  onIntent: (intent: ProgramIntent) => void;
  panel: PanelLink;
  unsupported: string | null;
  onOpenPanel: () => void;
  onExit: () => void;
  version: string;
}

const TAB_LABEL: Record<ProgramTab, string> = {
  games: 'Partidas',
  team: 'Nosso team',
  ranking: 'Classificação',
  progress: 'Progresso',
  teams: 'Teams',
};

function useViewport(): { w: number; h: number } {
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setVp({ w: window.innerWidth, h: window.innerHeight }));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return vp;
}

function cssVars(l: ComputedLayout, vm: ProgramViewModel): Record<string, string> {
  const p = vm.layout.preset;
  return {
    '--bg': p.colors.background,
    '--surface': p.colors.surface,
    '--text': p.colors.text,
    '--text2': p.colors.textSecondary,
    '--accent': p.colors.accent,
    '--m': `${l.margin}px`,
    '--gap': `${l.gap}px`,
    '--gap-half': `${Math.round(l.gap / 2)}px`,
    '--top': `${l.topBar}px`,
    '--foot': `${l.footer}px`,
    '--left': `${l.leftWidth}px`,
    '--center': `${l.centerWidth}px`,
    '--side': `${l.sideWidth}px`,
    '--board': `${l.boardSize}px`,
    '--cardh': `${l.cardHeight}px`,
    '--photo': `${l.photoCard}px`,
    '--photo-s': `${l.photoList}px`,
    '--f-name': `${l.font.name}px`,
    '--f-clock': `${l.font.clock}px`,
    '--f-row': `${l.font.row}px`,
    '--f-meta': `${l.font.meta}px`,
    '--f-title': `${l.font.title}px`,
    '--f-tab': `${Math.max(l.font.meta - 2, vm.layout.preset.typography.minEssentialPx)}px`,
    '--safe-t': `${p.safeMargins.top}px`,
    '--safe-r': `${p.safeMargins.right}px`,
    '--safe-b': `${p.safeMargins.bottom}px`,
    '--safe-l': `${p.safeMargins.left}px`,
  };
}

export function Photo({ url, initials, small }: { url: string | null; initials: string; small?: boolean }) {
  return (
    <div class={`lts-photo ${small ? 'small' : ''}`} aria-hidden="true">
      {url ? <img src={url} alt="" draggable={false} /> : initials}
    </div>
  );
}

function Countdown({ finishesAt, startsAt }: { finishesAt: number | null; startsAt: number | null }) {
  const [now, setNow] = useState(Date.now());
  const target = finishesAt ?? startsAt;
  useEffect(() => {
    if (target === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  if (finishesAt !== null) {
    return (
      <span class="t-clock" aria-label="Tempo restante do torneio">
        {formatDuration(finishesAt - now)}
      </span>
    );
  }
  if (startsAt !== null) {
    return (
      <span class="t-clock" aria-label="Tempo para o início do torneio">
        {startsAt - now > 0 ? `Começa em ${formatDuration(startsAt - now)}` : 'Começando…'}
      </span>
    );
  }
  return null;
}

/**
 * Peças pequenas da vantagem material. Sempre desenhadas no conjunto claro: sobre a ficha escura as
 * peças pretas ficariam ilegíveis, e o lado da ficha já indica quem está à frente.
 */
function MiniPieces({ pieces }: { pieces: string[] }) {
  return (
    <span class="c-mat" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          class="c-mat-piece"
          dangerouslySetInnerHTML={{ __html: PIECE_SVG[`w${p.slice(1)}` as PieceCode] ?? '' }}
        />
      ))}
    </span>
  );
}

/** Área independente do tabuleiro: só atualiza quando posição ou orientação mudam. */
const BoardHost = memo(
  function BoardHost({ board }: { board: BoardVM | null }) {
    const slot = useRef<HTMLDivElement>(null);
    const view = useRef<BoardView | null>(null);
    useLayoutEffect(() => {
      if (!slot.current) return;
      const v = new BoardView(slot.current.ownerDocument);
      view.current = v;
      slot.current.appendChild(v.element);
      return () => {
        v.element.remove();
        view.current = null;
      };
    }, []);
    useLayoutEffect(() => {
      if (board && view.current) view.current.update(board);
    }, [board?.fen, board?.lastMove, board?.orientation]);
    return (
      <div
        ref={slot}
        class="lts-boardslot"
        style={{ position: 'absolute', inset: 0, visibility: board ? 'visible' : 'hidden' }}
      />
    );
  },
  (a, b) =>
    a.board?.fen === b.board?.fen &&
    a.board?.lastMove === b.board?.lastMove &&
    a.board?.orientation === b.board?.orientation &&
    !!a.board === !!b.board,
);

/**
 * Tamanho do nome na ficha: mantém a fonte nominal quando cabe; nomes longos reduzem até 60% e
 * podem ocupar duas linhas, em vez de serem cortados.
 */
/** Insere oportunidades de quebra em "_", "-" e na transição camelCase (sem cortar letras). */
export function breakable(name: string) {
  const parts = name.split(/(?<=[_-])|(?<=[a-zà-ú])(?=[A-ZÀ-Ú])/);
  return parts.flatMap((p, i) => (i === 0 ? [p] : [<wbr key={i} />, p]));
}

export function fitName(name: string, availablePx: number, basePx: number): { size: number; lines: 1 | 2 } {
  const charW = 0.56;
  const need = (px: number) => name.length * px * charW;
  if (need(basePx) <= availablePx) return { size: basePx, lines: 1 };
  const oneLine = availablePx / (name.length * charW);
  if (oneLine >= basePx * 0.78) return { size: Math.floor(oneLine), lines: 1 };
  const twoLines = (availablePx * 1.9) / (name.length * charW);
  return {
    size: Math.max(Math.round(basePx * 0.6), Math.min(Math.floor(twoLines), Math.round(basePx * 0.85))),
    lines: 2,
  };
}

function PlayerCard({
  card,
  photoUrl,
  nameSpace,
  nameFont,
}: {
  card: PlayerCardVM;
  photoUrl: ProgramProps['photoUrl'];
  nameSpace: number;
  nameFont: number;
}) {
  const fit = fitName(card.name, nameSpace, nameFont);
  const sub = [card.rating ? String(card.rating) : null, card.rankText, card.teamName]
    .filter(Boolean)
    .join(' · ');
  return (
    <div
      class={`lts-card ${card.toMove ? 'tomove' : ''}`}
      aria-label={`${card.color === 'white' ? 'Brancas' : 'Pretas'}: ${card.name}`}
    >
      <Photo url={photoUrl(card.photoId)} initials={card.initials} />
      <div class="c-info">
        <div
          class={`c-name ${fit.lines === 2 ? 'two' : ''}`}
          style={{ fontSize: `${fit.size}px` }}
          title={card.name}
        >
          {card.title ? <span class="c-title">{card.title}</span> : null}
          {fit.lines === 2 ? breakable(card.name) : card.name}
        </div>
        <div class="c-sub">
          <span class={`c-color ${card.color}`} aria-hidden="true" />
          <span class="c-subtext">{sub || (card.color === 'white' ? 'Brancas' : 'Pretas')}</span>
          {card.materialPieces.length > 0 ? <MiniPieces pieces={card.materialPieces} /> : null}
          {card.materialPlus > 0 ? <span class="c-plus">+{card.materialPlus}</span> : null}
        </div>
      </div>
      <div class="c-right">
        {card.lastMoveText ? (
          <span class="c-move" title="Último lance">
            {card.lastMoveText}
          </span>
        ) : null}
        <div
          class={`c-clock ${card.clockAvailable ? '' : 'na'} ${card.lowTime ? 'low' : ''}`}
          title="Relógio da posição transmitida"
        >
          {card.clockAvailable ? card.clockText : 'indisponível'}
        </div>
      </div>
    </div>
  );
}

function Center({
  main,
  photoUrl,
  layout,
}: {
  main: MainGameVM;
  photoUrl: ProgramProps['photoUrl'];
  layout: ComputedLayout;
}) {
  const orientation = main.board?.orientation ?? 'white';
  const top = orientation === 'white' ? main.black : main.white;
  const bottom = orientation === 'white' ? main.white : main.black;
  const cardsWidth = Math.min(layout.centerWidth, Math.round(layout.boardSize * 1.3));
  const half = (cardsWidth - Math.round(layout.gap / 2)) / 2;
  const clockW = Math.round(layout.font.clock * 0.6 * 4.2 + 20);
  const nameSpace = Math.max(80, half - 24 - 4 - layout.photoCard - 24 - clockW);
  return (
    <div class="lts-center">
      <div class="lts-boardwrap">
        <BoardHost board={main.board} />
        {!main.board ? (
          <div class="lts-boardempty">
            {main.state === 'unsupported'
              ? main.notice
              : main.state === 'loading'
                ? 'Carregando partida…'
                : (main.notice ?? 'Aguardando seleção de partida')}
          </div>
        ) : null}
        {main.loadingLabel && main.board ? (
          <div class="lts-chip" role="status">
            {main.loadingLabel}
          </div>
        ) : null}
        {main.resultBanner ? <div class="lts-result">{main.resultBanner}</div> : null}
      </div>
      <div class="lts-cards" style={{ width: `${cardsWidth}px` }}>
        {top && bottom ? (
          <>
            <PlayerCard card={bottom} photoUrl={photoUrl} nameSpace={nameSpace} nameFont={layout.font.name} />
            <PlayerCard card={top} photoUrl={photoUrl} nameSpace={nameSpace} nameFont={layout.font.name} />
          </>
        ) : null}
      </div>
    </div>
  );
}

/** "2100 (5º)", "2100" ou "—": rating e posição de um jogador numa linha de partida. */
function playerMeta(p: GamePlayerVM): string {
  const parts = [p.rating ? String(p.rating) : null, p.rank ? `(${p.rank}º)` : null].filter(Boolean);
  return parts.length ? parts.join(' ') : '—';
}

function GamesPanel({
  vm,
  rowHeight,
  photoUrl,
  onIntent,
}: {
  vm: ProgramViewModel;
  rowHeight: number;
  photoUrl: ProgramProps['photoUrl'];
  onIntent: ProgramProps['onIntent'];
}) {
  const t = vm.tabs.games;
  return (
    <>
      <h2>{t.title}</h2>
      <div class="p-sub">
        {t.onAirText ? <span class="p-onair">{t.onAirText}</span> : null}
        {t.summaryText} · {t.coverageText}
      </div>
      <VirtualList<GameRowVM>
        items={t.rows}
        getId={(r) => r.gameId}
        rowHeight={rowHeight}
        label="Partidas identificadas"
        emptyText={t.emptyText}
        selectedId={vm.selection.gameId}
        onSelect={(id) => onIntent({ type: 'selectGame', gameId: id })}
        rowClass={(r) => `${r.favorite ? 'watched' : ''} ${r.onAir ? 'onair' : ''}`}
        render={(r) => (
          <>
            <div class="r-col lts-game">
              {(
                [
                  ['white', r.whitePlayer],
                  ['black', r.blackPlayer],
                ] as const
              ).map(([color, p]) => (
                <span class="lts-game-line" key={color}>
                  <Photo url={photoUrl(p.photoId)} initials={p.initials} small />
                  <span class={`c-color ${color}`} aria-hidden="true" />
                  <span class={`r-name ${p.ours ? 'ours' : ''}`}>{p.name}</span>
                  <span class="r-small">{playerMeta(p)}</span>
                </span>
              ))}
            </div>
            <span class="lts-game-side">
              {r.onAir ? (
                <span class="lts-air-dot" title="No ar" aria-label="No ar" />
              ) : r.favorite ? (
                <span class="r-star" aria-label="Com acompanhados">
                  ★
                </span>
              ) : null}
              {r.live ? null : <span class="r-small">{r.statusText}</span>}
            </span>
          </>
        )}
      />
    </>
  );
}

function TeamPanel({
  vm,
  rowHeight,
  photoUrl,
  onIntent,
}: {
  vm: ProgramViewModel;
  rowHeight: number;
  photoUrl: ProgramProps['photoUrl'];
  onIntent: ProgramProps['onIntent'];
}) {
  const t = vm.tabs.team;
  return (
    <>
      <h2>{t.title}</h2>
      <div class="p-sub">
        {t.summaryText} · {t.subtitle}
      </div>
      <VirtualList<TeamRowVM>
        items={t.rows}
        getId={(r) => r.userId}
        rowHeight={rowHeight}
        label="Jogadores acompanhados"
        emptyText="Nenhum jogador acompanhado. Cadastre no painel de operação."
        selectedId={vm.selection.userId}
        onSelect={(id) => onIntent({ type: 'selectPlayer', userId: id })}
        render={(r) => (
          <>
            <span class="r-rank">{r.rankText}</span>
            <Photo url={photoUrl(r.photoId)} initials={r.initials} small />
            <div class="r-col">
              <span class="r-name">
                {r.playing ? <span class="lts-live" title="Jogando agora" /> : null}
                {r.name}
                {r.deltaText ? <span class={`lts-delta inline ${r.direction}`}>{r.deltaText}</span> : null}
              </span>
              <span class="r-small">
                {[r.playing ? (r.opponentText ?? 'Jogando') : r.statusText, r.relativeText, r.linkNote]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            {r.onAir ? <span class="lts-air">No ar</span> : null}
            <span class="r-score">{r.scoreText}</span>
          </>
        )}
      />
    </>
  );
}

function RankingPanel({
  vm,
  rowHeight,
  photoUrl,
  onIntent,
}: {
  vm: ProgramViewModel;
  rowHeight: number;
  photoUrl: ProgramProps['photoUrl'];
  onIntent: ProgramProps['onIntent'];
}) {
  const t = vm.tabs.ranking;
  const focusId =
    t.rows.find((r) => r.userId === vm.selection.userId)?.userId ??
    t.rows.find((r) => r.watched)?.userId ??
    null;
  return (
    <>
      <h2>{t.title}</h2>
      <div class="p-sub">
        {t.summaryText ? `${t.summaryText} · ` : ''}
        {t.coverageText} · {t.updatedText}
      </div>
      <VirtualList<RankingRowVM>
        items={t.rows}
        getId={(r) => r.userId}
        rowHeight={rowHeight}
        label="Classificação"
        emptyText="Classificação ainda não recebida."
        focusId={focusId}
        smooth={!vm.layout.reducedMotion}
        selectedId={vm.selection.userId}
        onSelect={(id) => onIntent({ type: 'selectPlayer', userId: id })}
        rowClass={(r) => (r.watched ? 'watched' : '')}
        render={(r) => (
          <>
            <span class={`r-rank ${r.podium ? `podium podium-${r.podium}` : ''}`}>{r.rank}º</span>
            {r.watched ? <Photo url={photoUrl(r.photoId)} initials={r.initials} small /> : null}
            <span class="r-name">
              {r.title ? <span class="c-title">{r.title} </span> : null}
              {r.name}
              {r.deltaText ? <span class={`lts-delta inline ${r.direction}`}>{r.deltaText}</span> : null}
            </span>
            {r.teamName ? <span class="r-side">{r.teamName}</span> : null}
            <span class="r-score">{r.scoreText}</span>
          </>
        )}
      />
    </>
  );
}

function ProgressPanel({
  vm,
  rowHeight,
  photoUrl,
  onIntent,
}: {
  vm: ProgramViewModel;
  rowHeight: number;
  photoUrl: ProgramProps['photoUrl'];
  onIntent: ProgramProps['onIntent'];
}) {
  const t = vm.tabs.progress;
  return (
    <>
      <h2>{t.referenceText}</h2>
      <div class="p-sub">
        {t.scopeText}
        {t.staleText ? ` · ${t.staleText}` : ''}
      </div>
      <VirtualList<ProgressRowVM>
        items={t.rows}
        getId={(r) => r.userId}
        rowHeight={rowHeight}
        label="Progresso dos acompanhados"
        emptyText="Sem jogadores acompanhados com posição observada."
        selectedId={vm.selection.userId}
        onSelect={(id) => onIntent({ type: 'selectPlayer', userId: id })}
        render={(r) => (
          <>
            <span class="r-rank">{r.rankText}</span>
            <Photo url={photoUrl(r.photoId)} initials={r.initials} small />
            <div class="r-col">
              <span class="r-name">{r.name}</span>
              <span class="r-small">
                {[
                  r.transitionText,
                  r.scoreDeltaText,
                  r.confirmed ? 'tendência confirmada' : null,
                  r.stale ? 'sem atualização' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <span class={`lts-delta ${r.direction} ${r.confirmed ? 'confirmed' : ''}`}>{r.deltaText}</span>
          </>
        )}
      />
    </>
  );
}

function TeamsPanel({
  vm,
  rowHeight,
  onIntent,
}: {
  vm: ProgramViewModel;
  rowHeight: number;
  onIntent: ProgramProps['onIntent'];
}) {
  const t = vm.tabs.teams;
  return (
    <>
      <h2>{t.title}</h2>
      <div class="p-sub">{t.note}</div>
      <VirtualList<TeamStandingRowVM>
        items={t.rows}
        getId={(r) => r.teamId}
        rowHeight={rowHeight}
        label="Placar dos teams"
        emptyText="Placar dos teams ainda não recebido."
        selectedId={t.rows.find((r) => r.isOurs)?.teamId ?? null}
        onSelect={(id) => onIntent({ type: 'selectTeam', teamId: id })}
        rowClass={(r) => (r.isOurs ? 'watched' : '')}
        render={(r) => (
          <>
            <span class="r-rank">{r.rank}º</span>
            <div class="r-col">
              <span class="r-name">{r.name}</span>
              {r.detailText ? <span class="r-small">{r.detailText}</span> : null}
            </div>
            <span class="r-score">{r.scoreText}</span>
          </>
        )}
      />
    </>
  );
}

function Side({
  vm,
  layout,
  photoUrl,
  onIntent,
}: {
  vm: ProgramViewModel;
  layout: ComputedLayout;
  photoUrl: ProgramProps['photoUrl'];
  onIntent: ProgramProps['onIntent'];
}) {
  const active = vm.layout.activeTab;
  const rh = layout.rowHeight;
  return (
    <div class="lts-side">
      <div class="lts-tabs" role="tablist" aria-label="Abas">
        {vm.tabs.available.map((tab) => (
          <button
            key={tab}
            class="lts-tab"
            role="tab"
            id={`lts-tab-${tab}`}
            aria-selected={tab === active}
            aria-controls="lts-tabpanel"
            tabIndex={tab === active ? 0 : -1}
            onClick={() => onIntent({ type: 'setTab', tab })}
            onKeyDown={(e) => {
              const list = vm.tabs.available;
              const i = list.indexOf(tab);
              const next =
                e.key === 'ArrowRight'
                  ? list[(i + 1) % list.length]
                  : e.key === 'ArrowLeft'
                    ? list[(i - 1 + list.length) % list.length]
                    : e.key === 'Home'
                      ? list[0]
                      : e.key === 'End'
                        ? list[list.length - 1]
                        : null;
              if (!next) return;
              e.preventDefault();
              onIntent({ type: 'setTab', tab: next });
              const root = (e.currentTarget as HTMLElement).parentElement;
              requestAnimationFrame(() => root?.querySelector<HTMLElement>(`#lts-tab-${next}`)?.focus());
            }}
          >
            {TAB_LABEL[tab]}
          </button>
        ))}
      </div>
      <div class="lts-panel" id="lts-tabpanel" role="tabpanel" aria-labelledby={`lts-tab-${active}`}>
        {active === 'games' ? (
          <GamesPanel vm={vm} rowHeight={Math.round(rh * 1.5)} photoUrl={photoUrl} onIntent={onIntent} />
        ) : null}
        {active === 'team' ? (
          <TeamPanel vm={vm} rowHeight={rh} photoUrl={photoUrl} onIntent={onIntent} />
        ) : null}
        {active === 'ranking' ? (
          <RankingPanel vm={vm} rowHeight={Math.round(rh * 0.8)} photoUrl={photoUrl} onIntent={onIntent} />
        ) : null}
        {active === 'progress' ? (
          <ProgressPanel vm={vm} rowHeight={rh} photoUrl={photoUrl} onIntent={onIntent} />
        ) : null}
        {active === 'teams' ? <TeamsPanel vm={vm} rowHeight={rh} onIntent={onIntent} /> : null}
      </div>
    </div>
  );
}

export function ProgramApp(props: ProgramProps) {
  const { vm, panel, unsupported } = props;
  const vp = useViewport();
  if (unsupported) {
    return (
      <div
        class="lts-center-msg"
        style={{
          ['--bg' as string]: '#101722',
          ['--text' as string]: '#F4F7FB',
          ['--text2' as string]: '#B9C4D2',
        }}
      >
        <div>
          <h1>Lichess Team Studio</h1>
          <p>{unsupported}</p>
          <button class="lts-btn" onClick={props.onExit}>
            Sair do modo transmissão
          </button>
        </div>
      </div>
    );
  }
  if (!vm) {
    return (
      <div
        class="lts-center-msg"
        style={{
          ['--bg' as string]: '#101722',
          ['--text' as string]: '#F4F7FB',
          ['--text2' as string]: '#B9C4D2',
        }}
      >
        <div>
          <h1>
            {panel === 'disconnected'
              ? 'Painel de operação desconectado'
              : 'Conectando ao painel de operação…'}
          </h1>
          <p>
            A composição recebe os dados do painel de operação. Mantenha a janela do painel aberta durante a
            transmissão.
          </p>
          {panel === 'disconnected' ? (
            <button class="lts-btn" onClick={props.onOpenPanel}>
              Abrir painel de operação
            </button>
          ) : null}
          <button class="lts-btn" onClick={props.onExit}>
            Sair do modo transmissão
          </button>
        </div>
      </div>
    );
  }
  const layout = computeLayout(vm.layout.preset, vp.w, vp.h);
  const banners = [...vm.banners];
  if (vm.main.notice && vm.main.board) banners.unshift({ kind: 'unsupported', text: vm.main.notice });
  if (panel === 'disconnected')
    banners.unshift({ kind: 'panelDisconnected', text: 'Painel desconectado · dados congelados' });
  const columns = [
    layout.showWebcam ? `${layout.leftWidth}px` : null,
    `${layout.centerWidth}px`,
    layout.showSide ? `${layout.sideWidth}px` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div class={`lts-app ${vm.layout.reducedMotion ? 'reduced' : ''}`} style={cssVars(layout, vm)}>
      <header class="lts-top">
        <span class="t-name">{vm.top.tournamentName}</span>
        {vm.top.teamName ? (
          <span class="t-team">
            {vm.top.teamName}
            {vm.top.teamStatusText ? <span class="t-team-status"> · {vm.top.teamStatusText}</span> : null}
          </span>
        ) : null}
        {banners.length > 0 ? (
          <span class="lts-banners" role="status" aria-live="polite">
            {banners.slice(0, 2).map((b) => (
              <span key={b.kind + b.text} class={`lts-banner ${b.kind}`}>
                {b.text}
                {b.kind === 'panelDisconnected' ? (
                  <button class="lts-btn small" onClick={props.onOpenPanel}>
                    Reabrir painel
                  </button>
                ) : null}
              </span>
            ))}
          </span>
        ) : null}
        <span class="t-meta">
          <span>{vm.top.formatText}</span>
          <span>{vm.top.statusText}</span>
          <Countdown finishesAt={vm.top.finishesAt} startsAt={vm.top.startsAt} />
        </span>
      </header>
      <main class="lts-body" style={{ gridTemplateColumns: columns }}>
        {layout.showWebcam ? <div class="lts-left" aria-hidden="true" /> : null}
        <Center main={vm.main} photoUrl={props.photoUrl} layout={layout} />
        {layout.showSide ? (
          <Side vm={vm} layout={layout} photoUrl={props.photoUrl} onIntent={props.onIntent} />
        ) : null}
      </main>
      <footer class="lts-foot">
        <span>{vm.footer.sourceText}</span>
        {vm.main.modeLabel && vm.main.board ? <span class="f-mode">{vm.main.modeLabel}</span> : null}
        {vm.footer.delayText ? <span class="f-delay">{vm.footer.delayText}</span> : null}
        {vm.footer.boardUpdatedText ? <span>{vm.footer.boardUpdatedText}</span> : null}
        {vm.footer.rankingText ? <span class="f-right">{vm.footer.rankingText}</span> : null}
      </footer>
      <div class="lts-badge">Lichess Team Studio {props.version} · programa</div>
    </div>
  );
}
