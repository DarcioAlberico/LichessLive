// Gera as 12 peças SVG próprias do projeto (assets/pieces/*.svg) e o módulo TypeScript
// src/presentation/board/pieces.generated.ts usado pelo BoardView. Desenho original, licença MIT
// (ver docs/LICENCAS.md). Executar: node scripts/gen-pieces.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const THEMES = {
  w: { fill: '#FBFBF8', stroke: '#15181C', detail: '#15181C' },
  b: { fill: '#2A2F36', stroke: '#0B0D10', detail: '#E8ECF1' },
};

// Cada peça: lista de formas preenchidas e, opcionalmente, traços de detalhe (cor de contraste).
const SHAPES = {
  P: {
    body: [
      '<rect x="11" y="35" width="23" height="4.5" rx="1.6"/>',
      '<path d="M15 35C15 29.5 18.6 26.6 19.4 24h6.2c.8 2.6 4.4 5.5 4.4 11z"/>',
      '<rect x="16.5" y="21.3" width="12" height="3.2" rx="1.6"/>',
      '<circle cx="22.5" cy="15.8" r="5.6"/>',
    ],
    detail: [],
  },
  R: {
    body: [
      '<rect x="9" y="35" width="27" height="4.5" rx="1.4"/>',
      '<rect x="12" y="31.4" width="21" height="3.6" rx="1"/>',
      '<path d="M14.6 31.4 15.6 17h13.8l1 14.4z"/>',
      '<path d="M12 17v-7.2h4.6v2.8h3.9V9.8h4v2.8h3.9V9.8H33V17z"/>',
    ],
    detail: ['<path d="M15.6 20.5h13.8M15.1 27.8h14.8" fill="none"/>'],
  },
  B: {
    body: [
      '<rect x="10" y="35.4" width="25" height="4.1" rx="1.6"/>',
      '<path d="M15 35.4c.6-4.4 3.1-6.4 3.6-8h7.8c.5 1.6 3 3.6 3.6 8z"/>',
      '<rect x="16" y="24.6" width="13" height="3.2" rx="1.6"/>',
      '<path d="M22.5 8.4C17 12.6 15 16.8 15.4 20.6c.4 2.8 3 4.2 7.1 4.2s6.7-1.4 7.1-4.2C30 16.8 28 12.6 22.5 8.4z"/>',
      '<circle cx="22.5" cy="6.7" r="2.3"/>',
    ],
    detail: ['<path d="M24.8 13.2 20.4 19.6" fill="none"/>'],
  },
  N: {
    body: [
      '<rect x="11" y="35.4" width="24" height="4.1" rx="1.6"/>',
      '<path d="M14.5 35.4c0-3.4 1-6 2.6-8.3 1.6-2.2 3.4-3.6 4.2-5.6-1.4.6-2.8.7-4.1 1.6-1.4.9-2.6 2.3-4.5 2.3-2 0-2.8-1.8-2-4 1.6-4.4 3.9-8.4 7.6-10.6l.9-3.8 2.1 2.7 2.4-2.5.1 3.6c4.4 2.6 7.6 8.6 8.6 15.6.5 3.5.4 6.6 0 9z"/>',
    ],
    detail: [
      '<circle cx="17.6" cy="15.3" r="1.25"/>',
      '<circle cx="12.6" cy="22.2" r=".75"/>',
      '<path d="M26 14.5c2.3 3.2 3.6 7.2 4 12.4" fill="none"/>',
    ],
  },
  Q: {
    body: [
      '<rect x="9.5" y="35.4" width="26" height="4.1" rx="1.6"/>',
      '<path d="M12.2 35.4 14.6 31h15.8l2.4 4.4z"/>',
      '<path d="M14.6 31 9.6 14.4l6.6 9.4.2-12.8 6.1 11.4 6.1-11.4.2 12.8 6.6-9.4-5 16.6z"/>',
      '<circle cx="9.6" cy="13.2" r="2.4"/>',
      '<circle cx="16.3" cy="9.9" r="2.4"/>',
      '<circle cx="22.5" cy="8.6" r="2.4"/>',
      '<circle cx="28.7" cy="9.9" r="2.4"/>',
      '<circle cx="35.4" cy="13.2" r="2.4"/>',
    ],
    detail: ['<path d="M15.6 27.6h13.8" fill="none"/>'],
  },
  K: {
    body: [
      '<rect x="9.5" y="35.4" width="26" height="4.1" rx="1.6"/>',
      '<path d="M12.6 35.4c-.4-5.3-2.5-9.6-2-13.7.5-4.1 4.5-5.6 7.6-4.1 2 1 3.4 2.6 4.3 4.6.9-2 2.3-3.6 4.3-4.6 3.1-1.5 7.1 0 7.6 4.1.5 4.1-1.6 8.4-2 13.7z"/>',
      '<path d="M21 5.6h3v3.2h3.2v3H24V17h-3v-5.2h-3.2v-3H21z"/>',
      '<ellipse cx="22.5" cy="20.2" rx="3" ry="3.6"/>',
    ],
    detail: ['<path d="M13.2 30.6h18.6" fill="none"/>'],
  },
};

function svgFor(color, piece) {
  const t = THEMES[color];
  const s = SHAPES[piece];
  const detail = s.detail.length
    ? `<g fill="${t.detail}" stroke="${t.detail}" stroke-width="1.3" stroke-linecap="round">${s.detail.join('')}</g>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">` +
    `<g fill="${t.fill}" stroke="${t.stroke}" stroke-width="1.5" stroke-linejoin="round">${s.body.join('')}</g>` +
    detail +
    `</svg>`
  );
}

const out = {};
mkdirSync(resolve(root, 'assets/pieces'), { recursive: true });
for (const color of ['w', 'b']) {
  for (const piece of Object.keys(SHAPES)) {
    const code = `${color}${piece}`;
    const svg = svgFor(color, piece);
    out[code] = svg;
    writeFileSync(resolve(root, `assets/pieces/${code}.svg`), svg + '\n');
  }
}

const ts =
  '// Gerado por scripts/gen-pieces.mjs — não editar manualmente.\n' +
  "import type { PieceCode } from '../../domain/entities/fen';\n\n" +
  'export const PIECE_SVG: Record<PieceCode, string> = ' +
  JSON.stringify(out, null, 2) +
  ';\n';
writeFileSync(resolve(root, 'src/presentation/board/pieces.generated.ts'), ts);
console.log('Peças geradas:', Object.keys(out).join(' '));
