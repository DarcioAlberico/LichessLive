/**
 * Validação de FEN antes de renderizar (SPEC 9.2): seis campos, oito fileiras, oito casas por fileira.
 * O stream aceita FEN completa; o campo "featured" do torneio às vezes traz apenas posição e lado.
 */

export type PieceCode = 'wK' | 'wQ' | 'wR' | 'wB' | 'wN' | 'wP' | 'bK' | 'bQ' | 'bR' | 'bB' | 'bN' | 'bP';

export const ALL_PIECES: readonly PieceCode[] = [
  'wK',
  'wQ',
  'wR',
  'wB',
  'wN',
  'wP',
  'bK',
  'bQ',
  'bR',
  'bB',
  'bN',
  'bP',
];

/** 64 entradas, índice 0 = a8, 7 = h8, 56 = a1, 63 = h1 (ordem da FEN). */
export type BoardArray = readonly (PieceCode | null)[];

export type FenResult =
  { ok: true; board: BoardArray; turn: 'w' | 'b'; fen: string } | { ok: false; error: string };

const PIECE_MAP: Record<string, PieceCode> = {
  K: 'wK',
  Q: 'wQ',
  R: 'wR',
  B: 'wB',
  N: 'wN',
  P: 'wP',
  k: 'bK',
  q: 'bQ',
  r: 'bR',
  b: 'bB',
  n: 'bN',
  p: 'bP',
};

function parsePlacement(placement: string): BoardArray | string {
  const ranks = placement.split('/');
  if (ranks.length !== 8) return `esperadas 8 fileiras, recebidas ${ranks.length}`;
  const board: (PieceCode | null)[] = [];
  for (let r = 0; r < 8; r++) {
    const rank = ranks[r] ?? '';
    let files = 0;
    for (const ch of rank) {
      if (ch >= '1' && ch <= '8') {
        const n = ch.charCodeAt(0) - 48;
        for (let i = 0; i < n; i++) board.push(null);
        files += n;
      } else {
        const piece = PIECE_MAP[ch];
        if (!piece) return `caractere inválido "${ch}" na fileira ${8 - r}`;
        board.push(piece);
        files += 1;
      }
      if (files > 8) return `fileira ${8 - r} com mais de 8 casas`;
    }
    if (files !== 8) return `fileira ${8 - r} com ${files} casas`;
  }
  return board;
}

/** Validação estrita: exige os seis campos da FEN. */
export function parseFen(fen: unknown): FenResult {
  if (typeof fen !== 'string') return { ok: false, error: 'FEN ausente' };
  const fields = fen.trim().split(/\s+/);
  if (fields.length !== 6) return { ok: false, error: `FEN com ${fields.length} campos (esperados 6)` };
  const [placement, turn, castling, ep, half, full] = fields as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (turn !== 'w' && turn !== 'b') return { ok: false, error: 'lado a jogar inválido' };
  if (!/^(-|[KQkqA-Ha-h]{1,4})$/.test(castling)) return { ok: false, error: 'roque inválido' };
  if (!/^(-|[a-h][36])$/.test(ep)) return { ok: false, error: 'en passant inválido' };
  if (!/^\d+$/.test(half) || !/^\d+$/.test(full)) return { ok: false, error: 'contadores inválidos' };
  const board = parsePlacement(placement);
  if (typeof board === 'string') return { ok: false, error: board };
  const kings = board.filter((p) => p === 'wK').length + board.filter((p) => p === 'bK').length;
  if (kings !== 2) return { ok: false, error: 'posição sem exatamente um rei de cada cor' };
  return { ok: true, board, turn, fen: fields.join(' ') };
}

/**
 * Completa a FEN curta do campo "featured" ("<posição> w") para os seis campos.
 * Os campos de roque e contadores ficam neutros; servem apenas para exibição.
 */
export function completeShortFen(fen: string): string {
  const fields = fen.trim().split(/\s+/);
  if (fields.length >= 6) return fields.slice(0, 6).join(' ');
  const placement = fields[0] ?? '';
  const turn = fields[1] === 'b' ? 'b' : 'w';
  return `${placement} ${turn} - - 0 1`;
}

/** Converte "e2e4" (UCI) em índices de casa do BoardArray. Roques do Lichess vêm como e1h1 ou e1g1. */
export function uciToSquares(uci: unknown): [number, number] | null {
  if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  const sq = (file: string, rank: string) => (8 - Number(rank)) * 8 + (file.charCodeAt(0) - 97);
  return [sq(uci[0]!, uci[1]!), sq(uci[2]!, uci[3]!)];
}

export function squareName(index: number): string {
  const file = String.fromCharCode(97 + (index % 8));
  const rank = 8 - Math.floor(index / 8);
  return `${file}${rank}`;
}

export const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
