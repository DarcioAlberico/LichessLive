import { describe, expect, it } from 'vitest';
import type { GameId, TournamentId } from '../../src/domain/entities/ids';
import { associateGame, streamBelongsToTournament } from '../../src/domain/selection/gameAssociation';
import {
  beginResolve,
  beginSelection,
  commitSelection,
  flipOrientation,
  initialSelection,
  isCurrentGeneration,
  offerNewGame,
  pinCurrent,
  setAutoSwitch,
  setOrientation,
} from '../../src/domain/selection/selection';
import { resultVisibility } from '../../src/domain/selection/spoiler';
import { TID, uid } from '../helpers';

const g = (s: string) => s as GameId;

describe('seleção e geração (T04)', () => {
  it('cada seleção incrementa a geração e invalida as anteriores', () => {
    let s = initialSelection();
    s = beginSelection(s, { gameId: g('AAAAAAAA'), followedUserId: null, mode: 'pinned', now: 1 });
    const genA = s.generation;
    s = beginSelection(s, { gameId: g('BBBBBBBB'), followedUserId: null, mode: 'pinned', now: 2 });
    s = beginSelection(s, { gameId: g('CCCCCCCC'), followedUserId: null, mode: 'pinned', now: 3 });
    expect(isCurrentGeneration(s, genA)).toBe(false);
    expect(commitSelection(s, genA)).toBe(s);
    const committed = commitSelection(s, s.generation);
    expect(committed.pending).toBeNull();
    expect(committed.gameId).toBe('CCCCCCCC');
  });
  it('resolução de jogador também invalida cargas anteriores', () => {
    let s = beginSelection(initialSelection(), {
      gameId: g('AAAAAAAA'),
      followedUserId: null,
      mode: 'pinned',
      now: 1,
    });
    const before = s.generation;
    s = beginResolve(s, uid('x'), 'follow');
    expect(s.generation).toBe(before + 1);
    expect(s.notice).toEqual({ kind: 'resolving', userId: 'x' });
  });
  it('girar muda apenas a orientação', () => {
    const s = beginSelection(initialSelection(), {
      gameId: g('AAAAAAAA'),
      followedUserId: null,
      mode: 'pinned',
      now: 1,
    });
    const f = flipOrientation(s);
    expect(f.orientation).toBe('black');
    expect(f.generation).toBe(s.generation);
    expect(f.gameId).toBe(s.gameId);
    expect(setOrientation(f, 'white', false).orientation).toBe('black');
  });
  it('acompanhar jogador sugere por padrão e troca somente com troca automática', () => {
    let s = beginSelection(initialSelection(), {
      gameId: g('AAAAAAAA'),
      followedUserId: uid('x'),
      mode: 'follow',
      now: 1,
    });
    const r1 = offerNewGame(s, uid('x'), g('BBBBBBBB'), 5);
    expect(r1.action).toBe('suggest');
    expect(r1.state.suggestion?.gameId).toBe('BBBBBBBB');
    s = setAutoSwitch(s, true);
    expect(offerNewGame(s, uid('x'), g('BBBBBBBB'), 5).action).toBe('switch');
    expect(offerNewGame(s, uid('y'), g('BBBBBBBB'), 5).action).toBe('none');
  });
  it('partida fixada ignora sugestões automáticas', () => {
    let s = beginSelection(initialSelection(), {
      gameId: g('AAAAAAAA'),
      followedUserId: uid('x'),
      mode: 'follow',
      now: 1,
    });
    s = pinCurrent(s);
    expect(s.mode).toBe('pinned');
    expect(offerNewGame(setAutoSwitch(s, true), uid('x'), g('BBBBBBBB'), 2).action).toBe('none');
  });
});

describe('associação de partida ao torneio (T03)', () => {
  const base = { gameId: g('GGGGGGGG'), whiteUserId: uid('w'), blackUserId: uid('b') };
  it('partida em andamento no mesmo torneio é atual', () => {
    expect(associateGame({ ...base, status: 'started', tournamentId: TID }, uid('w'), TID).kind).toBe(
      'current',
    );
  });
  it('última partida encerrada nunca é apresentada como ativa', () => {
    expect(associateGame({ ...base, status: 'mate', tournamentId: TID }, uid('w'), TID).kind).toBe(
      'lastFinished',
    );
  });
  it('nunca escolhe partida de outro torneio; sem vínculo pede confirmação', () => {
    expect(
      associateGame({ ...base, status: 'started', tournamentId: 'Other123' as TournamentId }, uid('b'), TID)
        .kind,
    ).toBe('otherTournament');
    expect(associateGame({ ...base, status: 'started', tournamentId: null }, uid('b'), TID).kind).toBe(
      'unlinked',
    );
    expect(associateGame({ ...base, status: 'started', tournamentId: TID }, uid('z'), TID).kind).toBe(
      'playerMismatch',
    );
  });
  it('stream: compara torneio do pacote', () => {
    expect(streamBelongsToTournament(TID, TID)).toBe('same');
    expect(streamBelongsToTournament('Other123' as TournamentId, TID)).toBe('other');
    expect(streamBelongsToTournament(null, TID)).toBe('unknown');
  });
});

describe('spoilers (T16)', () => {
  it('resultado antecipado fica só no painel até a fonte do tabuleiro', () => {
    const early = {
      outcome: { status: 'resign' as const, winner: 'white' as const },
      source: 'current-game',
    };
    expect(resultVisibility(null, early)).toEqual({ programOutcome: null, earlyOutcomeForOperator: early });
    const board = { status: 'resign' as const, winner: 'white' as const };
    expect(resultVisibility(board, early)).toEqual({ programOutcome: board, earlyOutcomeForOperator: null });
  });
});
