import type { ClockReading } from './clock';
import type { GameId, TournamentId, UserId } from './ids';

/** Estados de partida do Lichess (nomes do campo status). */
export type GameStatusName =
  | 'created'
  | 'started'
  | 'aborted'
  | 'mate'
  | 'resign'
  | 'stalemate'
  | 'timeout'
  | 'draw'
  | 'outoftime'
  | 'cheat'
  | 'noStart'
  | 'unknownFinish'
  | 'insufficientMaterialClaim'
  | 'variantEnd'
  | 'unknown';

const KNOWN_STATUSES = new Set<GameStatusName>([
  'created',
  'started',
  'aborted',
  'mate',
  'resign',
  'stalemate',
  'timeout',
  'draw',
  'outoftime',
  'cheat',
  'noStart',
  'unknownFinish',
  'insufficientMaterialClaim',
  'variantEnd',
]);

export function asGameStatus(value: unknown): GameStatusName {
  return typeof value === 'string' && KNOWN_STATUSES.has(value as GameStatusName)
    ? (value as GameStatusName)
    : 'unknown';
}

export function isFinishedStatus(status: GameStatusName): boolean {
  return status !== 'created' && status !== 'started' && status !== 'unknown';
}

export type Color = 'white' | 'black';
export type Winner = Color | 'draw' | null;

export interface GamePlayer {
  userId: UserId | null;
  name: string;
  title: string | null;
  rating: number | null;
  /** Oponente máquina (aiLevel) ou anônimo. */
  isAnonymous: boolean;
}

export type VariantKey = string;
export const SUPPORTED_VARIANTS: ReadonlySet<VariantKey> = new Set(['standard', 'fromPosition']);

export type GameSource = 'api-stream';

/** Pacote de identidade: jogadores e torneio de uma partida, validados antes da troca do tabuleiro. */
export interface GameIdentity {
  gameId: GameId;
  tournamentId: TournamentId | null;
  variant: VariantKey;
  white: GamePlayer;
  black: GamePlayer;
  speed: string | null;
}

export interface GamePosition {
  fen: string;
  lastMove: string | null;
  clocks: ClockReading;
  /** Instante de recebimento (ms UTC). */
  receivedAt: number;
}

export interface GameOutcome {
  status: GameStatusName;
  winner: Winner;
}

export interface GameState {
  identity: GameIdentity;
  position: GamePosition | null;
  status: GameStatusName;
  outcome: GameOutcome | null;
  source: GameSource;
  generation: number;
}

export function resultText(outcome: GameOutcome | null): string | null {
  if (!outcome || !isFinishedStatus(outcome.status)) return null;
  if (outcome.status === 'aborted') return 'Partida abortada';
  if (outcome.winner === 'white') return '1-0';
  if (outcome.winner === 'black') return '0-1';
  return '½-½';
}

export function statusDescription(status: GameStatusName, winner: Winner): string {
  const who = winner === 'white' ? 'Brancas' : winner === 'black' ? 'Pretas' : '';
  switch (status) {
    case 'mate':
      return `Xeque-mate · ${who} vencem`;
    case 'resign':
      return `Abandono · ${who} vencem`;
    case 'outoftime':
    case 'timeout':
      return winner ? `Tempo esgotado · ${who} vencem` : 'Tempo esgotado';
    case 'stalemate':
      return 'Afogamento · empate';
    case 'draw':
      return 'Empate';
    case 'insufficientMaterialClaim':
      return 'Empate por material insuficiente';
    case 'aborted':
      return 'Partida abortada';
    case 'noStart':
      return 'Partida não iniciada';
    case 'cheat':
      return 'Partida encerrada pela moderação';
    case 'variantEnd':
      return winner ? `Fim pela variante · ${who} vencem` : 'Fim pela variante';
    case 'unknownFinish':
      return 'Partida encerrada';
    default:
      return 'Em andamento';
  }
}

/** Mensagem normalizada do stream da partida (contrato da porta de streams). */
export type GameStreamMessage =
  | {
      kind: 'descriptor';
      identity: GameIdentity;
      fen: string | null;
      lastMove: string | null;
      status: GameStatusName | null;
      winner: Winner;
      clocks: ClockReading | null;
    }
  | { kind: 'move'; fen: string; lastMove: string | null; clocks: ClockReading };
