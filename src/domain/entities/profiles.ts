import type { Coverage } from './coverage';
import type { TeamId, TournamentId, UserId } from './ids';

/** Recorte quadrado aplicado à foto, em coordenadas normalizadas (0..1) da imagem de origem. */
export interface PhotoCrop {
  x: number;
  y: number;
  size: number;
}

/** Cadastro local de um jogador. Não contém posição global: ranking pertence ao torneio. */
export interface PlayerProfile {
  userId: UserId;
  usernameDisplay: string;
  displayName: string | null;
  photoId: string | null;
  crop: PhotoCrop | null;
  updatedAt: number;
}

export interface PhotoAsset {
  photoId: string;
  blob: Blob;
  width: number;
  height: number;
  mime: string;
  hash: string;
  createdAt: number;
}

export type RosterSource = 'public-import' | 'manual';

export interface TeamProfile {
  teamId: TeamId;
  name: string;
  logoId: string | null;
  rosterCoverage: Coverage;
  rosterFetchedAt: number | null;
  /** Membros importados da lista pública (não sobrescreve vínculo do torneio). */
  members: { userId: UserId; username: string; source: RosterSource }[];
}

export interface Watchlist {
  teamId: TeamId;
  profileId: string;
  userIds: UserId[];
  favorites: UserId[];
  /** Ordem manual definida pelo operador. */
  manualOrder: UserId[];
  updatedAt: number;
}

export type ReferenceMode = 'sessionStart' | 'lastUpdate' | 'manualMark';

export interface TournamentSessionRecord {
  sessionId: string;
  tournamentId: TournamentId;
  type: 'arena' | 'teamBattle' | 'unknown';
  teamId: TeamId | null;
  startedAt: number;
  referenceMode: ReferenceMode;
  referenceId: string;
  /** Instante da marcação manual atual (quando referenceMode = manualMark). */
  referenceMarkedAt: number | null;
  rulesVersion: string;
  finishedAt: number | null;
}

export type SelectionMode = 'pinned' | 'follow' | 'replay';
export type Orientation = 'white' | 'black';

export interface GameSelectionRecord {
  sessionId: string;
  gameId: string | null;
  followedUserId: UserId | null;
  mode: SelectionMode;
  orientation: Orientation;
  generation: number;
  updatedAt: number;
}

export interface RankObservation {
  id?: number;
  sessionId: string;
  scope: string;
  referenceId: string;
  rulesVersion: string;
  collectionId: string;
  tournamentId: TournamentId;
  userId: UserId;
  rank: number | null;
  score: number | null;
  source: 'results-live' | 'results-final';
  startedAt: number;
  endedAt: number;
  provisional: boolean;
  /** Presente na coleta? (false = fora do recorte). */
  inCut: boolean;
}

export interface LayoutPreset {
  presetId: string;
  name: string;
  builtIn: boolean;
  slots: { webcam: boolean; side: boolean; topBar: boolean; footer: boolean };
  dimensions: {
    margin: number;
    topBar: number;
    leftWidth: number;
    sideWidth: number;
    gap: number;
  };
  typography: { scale: number; minEssentialPx: number };
  colors: { background: string; surface: string; text: string; textSecondary: string; accent: string };
  safeMargins: { top: number; right: number; bottom: number; left: number };
}
