import { describe, expect, it } from 'vitest';
import {
  checkSquare,
  describeMove,
  inCheck,
  isAttacked,
  materialBalance,
  withMate,
} from '../../src/domain/entities/chess';
import { INITIAL_FEN, parseFen } from '../../src/domain/entities/fen';
import { ndjsonLines } from '../helpers';

const board = (fen: string) => {
  const r = parseFen(fen);
  if (!r.ok) throw new Error(r.error);
  return r;
};
const sq = (name: string) => (8 - Number(name[1])) * 8 + (name.charCodeAt(0) - 97);

describe('casas atacadas e xeque', () => {
  it('posição inicial: ninguém em xeque; e3 atacada pelas brancas, e6 pelas pretas', () => {
    const b = board(INITIAL_FEN).board;
    expect(inCheck(b, 'w')).toBe(false);
    expect(inCheck(b, 'b')).toBe(false);
    expect(isAttacked(b, sq('e3'), 'w')).toBe(true);
    expect(isAttacked(b, sq('e6'), 'b')).toBe(true);
    expect(isAttacked(b, sq('e5'), 'w')).toBe(false);
  });
  it('xeque de dama na diagonal (1.e4 f6 2.Dh5+)', () => {
    const r = board('rnbqkbnr/ppppp1pp/5p2/7Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2');
    expect(checkSquare(r.board, r.turn)).toBe(sq('e8'));
  });
  it('xeque de cavalo, de peão e bloqueio de peça', () => {
    expect(checkSquare(board('4k3/8/3N4/8/8/8/8/4K3 b - - 0 1').board, 'b')).toBe(sq('e8'));
    expect(checkSquare(board('4k3/3P4/8/8/8/8/8/4K3 b - - 0 1').board, 'b')).toBe(sq('e8'));
    // Torre em e1 bloqueada pelo peão em e2: não é xeque.
    expect(checkSquare(board('4k3/8/8/8/8/8/4P3/4R1K1 b - - 0 1').board, 'b')).toBeNull();
    expect(checkSquare(board('4k3/8/8/8/8/8/8/4R1K1 b - - 0 1').board, 'b')).toBe(sq('e8'));
  });
});

describe('balanço material', () => {
  it('posição inicial equilibrada', () => {
    expect(materialBalance(board(INITIAL_FEN).board)).toEqual({
      white: { pieces: [], plus: 0 },
      black: { pieces: [], plus: 0 },
    });
  });
  it('brancas com cavalo a mais e pretas com peão a mais', () => {
    const m = materialBalance(board('4k3/pppp4/8/8/8/8/ppp5/1N2K3 w - - 0 1').board);
    // Brancas: 1 cavalo vs 0; pretas: 7 peões vs 0 → pretas +4.
    expect(m.white.pieces).toEqual(['bN']);
    expect(m.black.pieces).toHaveLength(7);
    expect(m.black.plus).toBe(4);
    expect(m.white.plus).toBe(0);
  });
  it('promoção não confunde a contagem (diferença por tipo)', () => {
    const m = materialBalance(board('4k3/8/8/8/8/8/8/Q3K2q w - - 0 1').board);
    expect(m.white).toEqual({ pieces: [], plus: 0 });
    expect(m.black).toEqual({ pieces: [], plus: 0 });
  });
});

describe('último lance em notação', () => {
  it('reproduz a abertura real do fixture do stream', () => {
    const lines = ndjsonLines('lichess/stream-game-live.ndjson') as { fen?: string; lm?: string }[];
    const moves = lines.filter((l) => l.fen);
    const labels: string[] = [];
    for (let i = 1; i < moves.length; i++) {
      const d = describeMove(moves[i - 1]!.fen!, moves[i]!.lm ?? null, moves[i]!.fen!);
      labels.push(d?.label ?? 'null');
    }
    expect(labels).toEqual(['1. d4', '1… e6', '2. Cf3', '2… f5']);
  });
  it('roque nos dois formatos de UCI e roque grande', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 10';
    expect(describeMove(fen, 'e1g1')?.san).toBe('O-O');
    expect(describeMove(fen, 'e1h1')?.san).toBe('O-O');
    expect(describeMove(fen, 'e1c1')?.san).toBe('O-O-O');
    expect(describeMove(fen, 'e1g1', 'r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 10')?.label).toBe('10. O-O');
  });
  it('captura, en passant, promoção com xeque e mate', () => {
    expect(describeMove('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 5', 'e4d5')?.san).toBe('exd5');
    expect(
      describeMove('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 5', 'e5d6', '4k3/8/3P4/8/8/8/8/4K3 b - - 0 5')?.san,
    ).toBe('exd6');
    expect(describeMove('8/4P3/8/8/8/8/8/k3K3 w - - 0 50', 'e7e8q')?.san).toBe('e8=D');
    expect(describeMove('3k4/4P3/8/8/8/8/8/4K3 w - - 0 50', 'e7e8q')?.san).toBe('e8=D+');
    expect(withMate('31. Dh7+')).toBe('31. Dh7#');
  });
  it('desambiguação por coluna, por fileira e lance de dama com xeque', () => {
    // Cavalos em b1 e f1 podem ir a d2.
    expect(describeMove('4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1', 'b1d2')?.san).toBe('Cbd2');
    // Torres em a1 e a5 podem ir a a3.
    expect(describeMove('4k3/8/8/R7/8/8/8/R3K3 w - - 0 1', 'a1a3')?.san).toBe('T1a3');
    expect(describeMove('rnbqkbnr/ppppp1pp/5p2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'd1h5')?.label).toBe(
      '2. Dh5+',
    );
    expect(describeMove('4k3/8/8/8/8/8/3n4/4K3 b - - 0 30', 'd2f3')?.label).toBe('30… Cf3+');
  });
  it('recusa lance que não reproduz a posição seguinte ou de quem não está na vez', () => {
    expect(describeMove(INITIAL_FEN, 'e2e4', INITIAL_FEN)).toBeNull();
    expect(describeMove(INITIAL_FEN, 'e7e5')).toBeNull();
    expect(describeMove(INITIAL_FEN, 'zz')).toBeNull();
    expect(describeMove(INITIAL_FEN, null)).toBeNull();
  });
});
