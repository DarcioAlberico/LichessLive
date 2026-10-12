import type { PieceCode } from '../../domain/entities/fen';
import { parseFen, uciToSquares } from '../../domain/entities/fen';
import { PIECE_SVG } from './pieces.generated';

/**
 * BoardView próprio (SPEC 7.3 e 8.1): renderiza a FEN recebida e o último lance, sem aceitar
 * movimentos. As 64 casas são criadas uma única vez; cada atualização só altera as casas cujo
 * conteúdo mudou. Girar o tabuleiro reposiciona as casas sem recriá-las.
 */

export interface BoardInput {
  fen: string;
  lastMove: string | null;
  orientation: 'white' | 'black';
}

const FILES = 'abcdefgh';

export class BoardView {
  readonly element: HTMLDivElement;
  private readonly squares: HTMLDivElement[] = [];
  private readonly pieceAt: (PieceCode | null)[] = new Array<PieceCode | null>(64).fill(null);
  private readonly templates = new Map<PieceCode, Element>();
  private readonly fileLabels: HTMLSpanElement[] = [];
  private readonly rankLabels: HTMLSpanElement[] = [];
  private orientation: 'white' | 'black' = 'white';
  private lastMoveSquares: number[] = [];
  private lastFen: string | null = null;
  /** Contador de atualizações efetivas (diagnóstico de piscadas). */
  renders = 0;

  constructor(private readonly doc: Document) {
    const el = doc.createElement('div');
    el.className = 'lts-board';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'Tabuleiro');
    for (let i = 0; i < 64; i++) {
      const sq = doc.createElement('div');
      const file = i % 8;
      const rank = Math.floor(i / 8);
      sq.className = `lts-sq ${(file + rank) % 2 === 0 ? 'light' : 'dark'}`;
      el.appendChild(sq);
      this.squares.push(sq);
    }
    for (let i = 0; i < 8; i++) {
      const f = doc.createElement('span');
      f.className = 'lts-coord file';
      el.appendChild(f);
      this.fileLabels.push(f);
      const r = doc.createElement('span');
      r.className = 'lts-coord rank';
      el.appendChild(r);
      this.rankLabels.push(r);
    }
    this.element = el;
    this.applyOrientation();
  }

  private template(code: PieceCode): Element {
    let t = this.templates.get(code);
    if (!t) {
      const holder = this.doc.createElement('template');
      holder.innerHTML = PIECE_SVG[code];
      t = holder.content.firstElementChild!;
      t.setAttribute('class', `lts-piece ${code}`);
      t.setAttribute('aria-hidden', 'true');
      this.templates.set(code, t);
    }
    return t;
  }

  private applyOrientation(): void {
    const flipped = this.orientation === 'black';
    for (let i = 0; i < 64; i++) {
      const file = i % 8;
      const rank = Math.floor(i / 8);
      const col = flipped ? 7 - file : file;
      const row = flipped ? 7 - rank : rank;
      const style = this.squares[i]!.style;
      style.left = `${col * 12.5}%`;
      style.top = `${row * 12.5}%`;
    }
    for (let i = 0; i < 8; i++) {
      const fileChar = FILES[flipped ? 7 - i : i]!;
      const f = this.fileLabels[i]!;
      f.textContent = fileChar;
      f.style.left = `${i * 12.5}%`;
      // Cor da coordenada contrasta com a casa em que está (linha inferior).
      f.dataset.on = (i + 7) % 2 === 0 ? 'light' : 'dark';
      const rankNum = flipped ? i + 1 : 8 - i;
      const r = this.rankLabels[i]!;
      r.textContent = String(rankNum);
      r.style.top = `${i * 12.5}%`;
      r.dataset.on = i % 2 === 0 ? 'light' : 'dark';
    }
  }

  /** Atualiza o tabuleiro; FEN inválida é ignorada e o estado anterior permanece. */
  update(input: BoardInput): boolean {
    let changed = false;
    if (input.orientation !== this.orientation) {
      this.orientation = input.orientation;
      this.applyOrientation();
      changed = true;
    }
    if (input.fen !== this.lastFen) {
      const parsed = parseFen(input.fen);
      if (!parsed.ok) return changed;
      this.lastFen = input.fen;
      for (let i = 0; i < 64; i++) {
        const next = parsed.board[i] ?? null;
        if (next === this.pieceAt[i]) continue;
        const sq = this.squares[i]!;
        const old = sq.querySelector('.lts-piece');
        if (old) old.remove();
        if (next) sq.appendChild(this.template(next).cloneNode(true));
        this.pieceAt[i] = next;
        changed = true;
      }
    }
    const lm = uciToSquares(input.lastMove);
    const nextLm = lm ? [...lm] : [];
    if (nextLm.join(',') !== this.lastMoveSquares.join(',')) {
      for (const i of this.lastMoveSquares) this.squares[i]?.classList.remove('lm');
      for (const i of nextLm) this.squares[i]?.classList.add('lm');
      this.lastMoveSquares = nextLm;
      changed = true;
    }
    if (changed) this.renders += 1;
    return changed;
  }

  /** Peças atualmente desenhadas (testes). */
  snapshot(): readonly (PieceCode | null)[] {
    return [...this.pieceAt];
  }
}
