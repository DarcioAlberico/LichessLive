import type { BoardArray, PieceCode } from './fen';
import { parseFen, uciToSquares } from './fen';

/**
 * Regras mínimas de xadrez para a apresentação: casas atacadas, xeque, balanço material e o último
 * lance em notação algébrica (letras em português). Não gera lances legais completos: a desambiguação
 * considera lances pseudolegais (cravadas raras podem acrescentar um identificador desnecessário) e
 * o resultado é sempre conferido contra a posição seguinte recebida da fonte.
 */

export type Side = 'w' | 'b';

const KNIGHT: readonly [number, number][] = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
const KING: readonly [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
const ROOK_DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const BISHOP_DIRS: readonly [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const fileOf = (sq: number) => sq % 8;
/** Índice da fileira na matriz: 0 = 8ª fileira, 7 = 1ª fileira. */
const rowOf = (sq: number) => Math.floor(sq / 8);
const at = (f: number, r: number) => r * 8 + f;
const inside = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8;
const other = (s: Side): Side => (s === 'w' ? 'b' : 'w');

/** A casa `target` é atacada por alguma peça do lado `by`? */
export function isAttacked(board: BoardArray, target: number, by: Side): boolean {
  const tf = fileOf(target);
  const tr = rowOf(target);
  const is = (f: number, r: number, roles: string) => {
    if (!inside(f, r)) return false;
    const p = board[at(f, r)];
    return !!p && p[0] === by && roles.includes(p[1]!);
  };
  // Peão branco ataca "para cima" (fileira de índice menor); logo está uma fileira abaixo do alvo.
  const pawnRow = by === 'w' ? tr + 1 : tr - 1;
  if (is(tf - 1, pawnRow, 'P') || is(tf + 1, pawnRow, 'P')) return true;
  for (const [df, dr] of KNIGHT) if (is(tf + df, tr + dr, 'N')) return true;
  for (const [df, dr] of KING) if (is(tf + df, tr + dr, 'K')) return true;
  const slide = (dirs: readonly [number, number][], roles: string) => {
    for (const [df, dr] of dirs) {
      let f = tf + df;
      let r = tr + dr;
      while (inside(f, r)) {
        const p = board[at(f, r)];
        if (p) {
          if (p[0] === by && roles.includes(p[1]!)) return true;
          break;
        }
        f += df;
        r += dr;
      }
    }
    return false;
  };
  return slide(ROOK_DIRS, 'RQ') || slide(BISHOP_DIRS, 'BQ');
}

export function kingSquare(board: BoardArray, side: Side): number | null {
  const king = `${side}K`;
  for (let i = 0; i < 64; i++) if (board[i] === king) return i;
  return null;
}

/** O rei do lado `side` está em xeque? */
export function inCheck(board: BoardArray, side: Side): boolean {
  const k = kingSquare(board, side);
  return k !== null && isAttacked(board, k, other(side));
}

/** Casa do rei em xeque do lado a jogar, ou null. */
export function checkSquare(board: BoardArray, turn: Side): number | null {
  const k = kingSquare(board, turn);
  return k !== null && isAttacked(board, k, other(turn)) ? k : null;
}

// ------------------------------------------------------------------ material

const VALUE: Record<string, number> = { Q: 9, R: 5, B: 3, N: 3, P: 1 };
const ROLE_ORDER = ['Q', 'R', 'B', 'N', 'P'] as const;

export interface MaterialSideView {
  /** Peças a mais deste lado, desenhadas na cor do adversário (como peças capturadas). */
  pieces: PieceCode[];
  /** Vantagem em pontos (0 quando não está à frente). */
  plus: number;
}

/** Balanço material no estilo do Lichess: diferenças por tipo de peça, que se cancelam entre os lados. */
export function materialBalance(board: BoardArray): { white: MaterialSideView; black: MaterialSideView } {
  const count: Record<string, number> = {};
  for (const p of board) if (p && p[1] !== 'K') count[p] = (count[p] ?? 0) + 1;
  const white: MaterialSideView = { pieces: [], plus: 0 };
  const black: MaterialSideView = { pieces: [], plus: 0 };
  let score = 0;
  for (const role of ROLE_ORDER) {
    const diff = (count[`w${role}`] ?? 0) - (count[`b${role}`] ?? 0);
    score += diff * VALUE[role]!;
    for (let i = 0; i < diff; i++) white.pieces.push(`b${role}` as PieceCode);
    for (let i = 0; i < -diff; i++) black.pieces.push(`w${role}` as PieceCode);
  }
  if (score > 0) white.plus = score;
  if (score < 0) black.plus = -score;
  return { white, black };
}

// ------------------------------------------------------------------ notação do último lance

/** Letras das peças em português: Rei, Dama, Torre, Bispo, Cavalo. */
const PT: Record<string, string> = { K: 'R', Q: 'D', R: 'T', B: 'B', N: 'C' };

function canReach(board: BoardArray, from: number, to: number, role: string): boolean {
  const ff = fileOf(from);
  const fr = rowOf(from);
  const df = fileOf(to) - ff;
  const dr = rowOf(to) - fr;
  if (role === 'N')
    return (Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1);
  if (role === 'K') return Math.max(Math.abs(df), Math.abs(dr)) === 1;
  const straight = df === 0 || dr === 0;
  const diagonal = Math.abs(df) === Math.abs(dr);
  if (
    (role === 'R' && !straight) ||
    (role === 'B' && !diagonal) ||
    (role === 'Q' && !straight && !diagonal)
  ) {
    return false;
  }
  if (df === 0 && dr === 0) return false;
  const sf = Math.sign(df);
  const sr = Math.sign(dr);
  let f = ff + sf;
  let r = fr + sr;
  while (f !== fileOf(to) || r !== rowOf(to)) {
    if (board[at(f, r)]) return false;
    f += sf;
    r += sr;
  }
  return true;
}

function squareName(sq: number): string {
  return `${'abcdefgh'[fileOf(sq)]}${8 - rowOf(sq)}`;
}

interface DecodedMove {
  from: number;
  to: number;
  role: string;
  side: Side;
  castle: 'king' | 'queen' | null;
  enPassant: boolean;
  capture: boolean;
  promotion: string | null;
}

function decode(board: BoardArray, turn: Side, uci: string): DecodedMove | null {
  const sq = uciToSquares(uci);
  if (!sq) return null;
  const [from, to] = sq;
  const piece = board[from];
  if (!piece || piece[0] !== turn) return null;
  const role = piece[1]!;
  const target = board[to];
  const ff = fileOf(from);
  const tf = fileOf(to);
  // Roque: rei anda duas colunas (e1g1) ou "captura" a própria torre (formato e1h1).
  if (role === 'K' && (Math.abs(tf - ff) === 2 || (target && target === `${turn}R`))) {
    return {
      from,
      to,
      role,
      side: turn,
      castle: tf > ff ? 'king' : 'queen',
      enPassant: false,
      capture: false,
      promotion: null,
    };
  }
  if (target && target[0] === turn) return null;
  const enPassant = role === 'P' && ff !== tf && !target;
  const promotion = uci.length === 5 ? uci[4]!.toUpperCase() : null;
  if (promotion && (role !== 'P' || !'QRBN'.includes(promotion))) return null;
  return { from, to, role, side: turn, castle: null, enPassant, capture: !!target || enPassant, promotion };
}

/** Aplica o lance ao tabuleiro (roque, en passant e promoção incluídos). */
function applyMove(board: BoardArray, m: DecodedMove): (PieceCode | null)[] {
  const next = [...board];
  const row = rowOf(m.from);
  if (m.castle) {
    const kingTo = at(m.castle === 'king' ? 6 : 2, row);
    const rookFrom = at(m.castle === 'king' ? 7 : 0, row);
    const rookTo = at(m.castle === 'king' ? 5 : 3, row);
    const rook = next[rookFrom];
    next[m.from] = null;
    next[rookFrom] = null;
    next[kingTo] = `${m.side}K` as PieceCode;
    next[rookTo] = rook ?? (`${m.side}R` as PieceCode);
    return next;
  }
  const piece = next[m.from]!;
  next[m.from] = null;
  if (m.enPassant) next[at(fileOf(m.to), row)] = null;
  next[m.to] = m.promotion ? (`${m.side}${m.promotion}` as PieceCode) : piece;
  return next;
}

export interface MoveDescription {
  /** Notação do lance, ex.: "Cf3", "exd5", "O-O", "e8=D+". */
  san: string;
  /** Número do lance e lado: "12. Cf3" ou "12… Cf6". */
  label: string;
  side: Side;
}

/**
 * Descreve o lance `uci` jogado na posição `prevFen`. Se `nextFen` for informado, o resultado só é
 * aceito quando aplicar o lance reproduz exatamente a posição recebida (evita notação inventada).
 */
export function describeMove(prevFen: string, uci: string | null, nextFen?: string): MoveDescription | null {
  if (!uci) return null;
  const prev = parseFen(prevFen);
  if (!prev.ok) return null;
  const m = decode(prev.board, prev.turn, uci);
  if (!m) return null;
  const after = applyMove(prev.board, m);
  if (nextFen !== undefined) {
    const next = parseFen(nextFen);
    if (!next.ok || next.board.some((p, i) => p !== after[i])) return null;
  }
  let san: string;
  if (m.castle) san = m.castle === 'king' ? 'O-O' : 'O-O-O';
  else if (m.role === 'P') {
    san = m.capture ? `${'abcdefgh'[fileOf(m.from)]}x${squareName(m.to)}` : squareName(m.to);
    if (m.promotion) san += `=${PT[m.promotion]}`;
  } else {
    const rivals: number[] = [];
    for (let i = 0; i < 64; i++) {
      if (i !== m.from && prev.board[i] === `${m.side}${m.role}` && canReach(prev.board, i, m.to, m.role))
        rivals.push(i);
    }
    let dis = '';
    if (rivals.length > 0) {
      const sameFile = rivals.some((s) => fileOf(s) === fileOf(m.from));
      const sameRow = rivals.some((s) => rowOf(s) === rowOf(m.from));
      if (!sameFile) dis = 'abcdefgh'[fileOf(m.from)]!;
      else if (!sameRow) dis = String(8 - rowOf(m.from));
      else dis = squareName(m.from);
    }
    san = `${PT[m.role]}${dis}${m.capture ? 'x' : ''}${squareName(m.to)}`;
  }
  if (inCheck(after, other(m.side))) san += '+';
  const fullmove = Number(prevFen.trim().split(/\s+/)[5]) || 1;
  return { san, label: `${fullmove}${m.side === 'w' ? '.' : '…'} ${san}`, side: m.side };
}

/** Marca mate no lance final ("+" vira "#"). */
export function withMate(label: string): string {
  return label.endsWith('+') ? `${label.slice(0, -1)}#` : `${label}#`;
}
