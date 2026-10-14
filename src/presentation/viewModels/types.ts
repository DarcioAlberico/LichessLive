/**
 * ViewModels da composição capturada. A apresentação só recebe dados prontos para exibir
 * (textos já formatados no fuso configurado) e emite intenções. Nada aqui contém dados de
 * cadastro além de nome, foto e iniciais.
 */
import type { LayoutPreset } from '../../domain/entities/profiles';
import type { ProgramTab } from '../../shared/protocol/messages';

export interface PlayerCardVM {
  color: 'white' | 'black';
  userId: string | null;
  name: string;
  title: string | null;
  rating: number | null;
  photoId: string | null;
  initials: string;
  teamName: string | null;
  clockText: string;
  clockAvailable: boolean;
  toMove: boolean;
  rankText: string | null;
  /** Relógio da posição abaixo do limite de alerta (proporcional ao ritmo do torneio). */
  lowTime: boolean;
  /** Último lance deste jogador, em notação ("12. Cf3"), quando foi ele quem jogou por último. */
  lastMoveText: string | null;
  /** Peças a mais (desenhadas na cor do adversário) e vantagem em pontos. */
  materialPieces: string[];
  materialPlus: number;
}

export interface BoardVM {
  /** Identifica o pacote consistente (gameId + generation): nomes, fotos e posição pertencem a ele. */
  packageId: string;
  gameId: string;
  fen: string;
  lastMove: string | null;
  orientation: 'white' | 'black';
}

export interface MainGameVM {
  state: 'empty' | 'loading' | 'ready' | 'unsupported';
  board: BoardVM | null;
  white: PlayerCardVM | null;
  black: PlayerCardVM | null;
  /** Banner de resultado — somente a partir da fonte do tabuleiro. */
  resultBanner: string | null;
  /** Indicação discreta de carregamento enquanto o tabuleiro anterior permanece visível. */
  loadingLabel: string | null;
  /** Aviso ao público (ex.: "Partida sem vínculo confirmado"). */
  notice: string | null;
  modeLabel: string | null;
  isReplay: boolean;
}

export interface GamePlayerVM {
  name: string;
  rank: number | null;
  rating: number | null;
  photoId: string | null;
  initials: string;
  /** Jogador acompanhado (nosso team ou favorito). */
  ours: boolean;
}

export interface GameRowVM {
  gameId: string;
  white: string;
  black: string;
  whiteRank: number | null;
  blackRank: number | null;
  statusText: string;
  favorite: boolean;
  whitePlayer: GamePlayerVM;
  blackPlayer: GamePlayerVM;
  /** É a partida principal exibida agora. */
  onAir: boolean;
  /** Em andamento segundo a fonte. */
  live: boolean;
}

export interface TeamRowVM {
  userId: string;
  name: string;
  title: string | null;
  photoId: string | null;
  initials: string;
  rankText: string;
  scoreText: string;
  statusText: string;
  /** Posição relativa entre acompanhados (rótulo obrigatório "Entre acompanhados"). */
  relativeText: string | null;
  gameId: string | null;
  linkNote: string | null;
  playing: boolean;
  /** Adversário da partida em andamento, com posição quando conhecida. */
  opponentText: string | null;
  deltaText: string | null;
  direction: 'up' | 'down' | 'none';
  onAir: boolean;
}

export interface RankingRowVM {
  userId: string;
  rank: number;
  name: string;
  title: string | null;
  scoreText: string;
  teamName: string | null;
  watched: boolean;
  photoId: string | null;
  initials: string;
  deltaText: string | null;
  direction: 'up' | 'down' | 'none';
  /** 1, 2 ou 3 para o pódio; 0 nos demais. */
  podium: 0 | 1 | 2 | 3;
}

export interface ProgressRowVM {
  userId: string;
  name: string;
  photoId: string | null;
  initials: string;
  rankText: string;
  deltaText: string;
  direction: 'up' | 'down' | 'none';
  confirmed: boolean;
  scoreDeltaText: string | null;
  /** "6º → 3º" quando há referência; null em Novo / Fora do recorte. */
  transitionText: string | null;
  stale: boolean;
}

export interface TeamStandingRowVM {
  teamId: string;
  rank: number;
  name: string;
  scoreText: string;
  isOurs: boolean;
  /** Nosso team: distância para o team acima e principais pontuadores; outros: diferença para o nosso. */
  detailText: string | null;
}

export interface TabsVM {
  available: ProgramTab[];
  games: {
    title: string;
    coverageText: string;
    summaryText: string;
    /** "No ar: A × B" quando a partida principal está na lista. */
    onAirText: string | null;
    emptyText: string;
    rows: GameRowVM[];
  };
  team: { title: string; subtitle: string; summaryText: string; rows: TeamRowVM[] };
  ranking: {
    title: string;
    coverageText: string;
    provisional: boolean;
    updatedText: string;
    summaryText: string | null;
    rows: RankingRowVM[];
  };
  progress: {
    title: string;
    referenceText: string;
    scopeText: string;
    staleText: string | null;
    rows: ProgressRowVM[];
  };
  teams: { title: string; note: string; rows: TeamStandingRowVM[] };
}

export interface TopBarVM {
  tournamentName: string;
  formatText: string;
  teamName: string | null;
  statusText: string;
  /** Instante (ms UTC) em que o torneio termina, quando a fonte informa. */
  finishesAt: number | null;
  /** Instante (ms UTC) de início, enquanto o torneio ainda não começou. */
  startsAt: number | null;
  /** Team Battle: posição e pontos do nosso team ("3º de 12 · 125 pts"). */
  teamStatusText: string | null;
}

export interface FooterVM {
  sourceText: string;
  delayText: string | null;
  boardUpdatedText: string | null;
  rankingText: string | null;
}

export type BannerKind =
  | 'loading'
  | 'apiDelayed'
  | 'noConnection'
  | 'partialData'
  | 'rateLimited'
  | 'tournamentFinished'
  | 'panelDisconnected'
  | 'unsupported';

export interface BannerVM {
  kind: BannerKind;
  text: string;
}

export interface ProgramViewModel {
  top: TopBarVM;
  main: MainGameVM;
  tabs: TabsVM;
  footer: FooterVM;
  banners: BannerVM[];
  layout: {
    preset: LayoutPreset;
    activeTab: ProgramTab;
    hideResults: boolean;
    reducedMotion: boolean;
    inPageShortcuts: boolean;
  };
  selection: { gameId: string | null; userId: string | null };
}

export const PROGRAM_VM_SECTIONS = [
  'top',
  'main',
  'tabs',
  'footer',
  'banners',
  'layout',
  'selection',
] as const;
