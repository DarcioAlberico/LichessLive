import type { GameId, UserId } from '../entities/ids';
import type { Orientation, SelectionMode } from '../entities/profiles';

/**
 * Regras de seleção (SPEC 3.2 e 9.2).
 * - A seleção manual prevalece sobre sugestões automáticas.
 * - Cada seleção incrementa generation; eventos de gerações anteriores são descartados.
 * - Acompanhar jogador mantém o userId como intenção; a troca automática é desativada por padrão.
 * - Fixar partida mantém o gameId até uma ação do apresentador, inclusive após o resultado.
 * - Girar o tabuleiro muda apenas a orientação.
 */

export type SelectionNotice =
  | { kind: 'resolving'; userId: UserId }
  | { kind: 'noCurrentGame'; userId: UserId; lastGameId: GameId | null }
  | { kind: 'unlinked'; userId: UserId | null; gameId: GameId }
  | { kind: 'otherTournament'; userId: UserId | null; gameId: GameId }
  | { kind: 'notFound'; userId: UserId }
  | { kind: 'unsupportedVariant'; gameId: GameId; variant: string }
  | { kind: 'invalidGame'; gameId: GameId; reason: string }
  | { kind: 'error'; message: string };

export interface PendingLoad {
  gameId: GameId;
  generation: number;
  startedAt: number;
}

export interface Suggestion {
  gameId: GameId;
  forUserId: UserId;
  detectedAt: number;
}

export interface SelectionState {
  generation: number;
  gameId: GameId | null;
  followedUserId: UserId | null;
  mode: SelectionMode;
  orientation: Orientation;
  /** Orientação escolhida manualmente pelo operador (prevalece sobre a cor do jogador acompanhado). */
  orientationLocked: boolean;
  pending: PendingLoad | null;
  suggestion: Suggestion | null;
  notice: SelectionNotice | null;
  autoSwitch: boolean;
}

export function initialSelection(): SelectionState {
  return {
    generation: 0,
    gameId: null,
    followedUserId: null,
    mode: 'pinned',
    orientation: 'white',
    orientationLocked: false,
    pending: null,
    suggestion: null,
    notice: null,
    autoSwitch: false,
  };
}

export interface SelectRequest {
  gameId: GameId;
  /** Jogador que originou a seleção (Nosso team, Classificação) ou null para seleção direta. */
  followedUserId: UserId | null;
  mode: SelectionMode;
  now: number;
}

/** Inicia uma nova seleção: nova geração, carregamento pendente, sugestão descartada. */
export function beginSelection(state: SelectionState, req: SelectRequest): SelectionState {
  const generation = state.generation + 1;
  return {
    ...state,
    generation,
    gameId: req.gameId,
    followedUserId: req.mode === 'follow' ? req.followedUserId : (req.followedUserId ?? null),
    mode: req.mode,
    pending: { gameId: req.gameId, generation, startedAt: req.now },
    suggestion: null,
    notice: null,
  };
}

/** Intenção de resolver um jogador sem gameId conhecido: incrementa geração para invalidar cargas anteriores. */
export function beginResolve(state: SelectionState, userId: UserId, mode: SelectionMode): SelectionState {
  return {
    ...state,
    generation: state.generation + 1,
    followedUserId: userId,
    mode,
    suggestion: null,
    notice: { kind: 'resolving', userId },
  };
}

export function isCurrentGeneration(state: SelectionState, generation: number): boolean {
  return state.generation === generation;
}

/** Confirma que o pacote consistente da geração pendente chegou e o tabuleiro pode trocar. */
export function commitSelection(state: SelectionState, generation: number): SelectionState {
  if (!state.pending || state.pending.generation !== generation) return state;
  return { ...state, pending: null };
}

export function failSelection(
  state: SelectionState,
  generation: number,
  notice: SelectionNotice,
): SelectionState {
  if (state.generation !== generation) return state;
  return { ...state, pending: null, notice };
}

export function setNotice(
  state: SelectionState,
  generation: number,
  notice: SelectionNotice | null,
): SelectionState {
  if (state.generation !== generation) return state;
  return { ...state, notice };
}

export function flipOrientation(state: SelectionState): SelectionState {
  return {
    ...state,
    orientation: state.orientation === 'white' ? 'black' : 'white',
    orientationLocked: true,
  };
}

export function setOrientation(
  state: SelectionState,
  orientation: Orientation,
  manual: boolean,
): SelectionState {
  if (!manual && state.orientationLocked) return state;
  return { ...state, orientation, orientationLocked: manual ? true : state.orientationLocked };
}

export function pinCurrent(state: SelectionState): SelectionState {
  if (!state.gameId) return state;
  return { ...state, mode: 'pinned', suggestion: null };
}

export function followUser(state: SelectionState, userId: UserId): SelectionState {
  return { ...state, mode: 'follow', followedUserId: userId };
}

export function setAutoSwitch(state: SelectionState, autoSwitch: boolean): SelectionState {
  return { ...state, autoSwitch };
}

/**
 * Uma nova partida do jogador acompanhado foi identificada no mesmo torneio.
 * Retorna 'switch' quando a troca automática está ativa; caso contrário registra a sugestão.
 * Ignorada se não estamos acompanhando esse jogador, se a partida já é a atual ou se o modo é fixo.
 */
export function offerNewGame(
  state: SelectionState,
  userId: UserId,
  gameId: GameId,
  now: number,
): { state: SelectionState; action: 'none' | 'suggest' | 'switch' } {
  if (state.mode !== 'follow' || state.followedUserId !== userId) return { state, action: 'none' };
  if (state.gameId === gameId || state.pending?.gameId === gameId) return { state, action: 'none' };
  if (state.suggestion?.gameId === gameId) return { state, action: 'none' };
  if (state.autoSwitch) return { state, action: 'switch' };
  return {
    state: { ...state, suggestion: { gameId, forUserId: userId, detectedAt: now } },
    action: 'suggest',
  };
}

export function dismissSuggestion(state: SelectionState): SelectionState {
  return { ...state, suggestion: null };
}
