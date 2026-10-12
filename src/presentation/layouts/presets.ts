import type { LayoutPreset } from '../../domain/entities/profiles';

/**
 * Presets de transmissão (SPEC 4.1). Em 1920×1080 úteis: margens 32, barra superior 64,
 * área esquerda 280, lateral 400, intervalos 24. Em 1280×720 a área de webcam sai por padrão.
 * Os valores são metas de composição; computeLayout preserva o tabuleiro quadrado e evita rolagem.
 */

const COLORS = {
  background: '#101722',
  surface: '#192331',
  text: '#F4F7FB',
  textSecondary: '#B9C4D2',
  accent: '#6CB4FF',
};

export const BUILT_IN_PRESETS: readonly LayoutPreset[] = [
  {
    presetId: 'single-1080',
    name: 'Uma partida · 1080p',
    builtIn: true,
    slots: { webcam: true, side: true, topBar: true, footer: true },
    dimensions: { margin: 32, topBar: 64, leftWidth: 280, sideWidth: 400, gap: 24 },
    typography: { scale: 1, minEssentialPx: 16 },
    colors: COLORS,
    safeMargins: { top: 0, right: 0, bottom: 0, left: 0 },
  },
  {
    presetId: 'compact-720',
    name: 'Compacto · 720p',
    builtIn: true,
    slots: { webcam: false, side: true, topBar: true, footer: true },
    dimensions: { margin: 20, topBar: 48, leftWidth: 0, sideWidth: 330, gap: 16 },
    typography: { scale: 1, minEssentialPx: 16 },
    colors: COLORS,
    safeMargins: { top: 0, right: 0, bottom: 0, left: 0 },
  },
  {
    presetId: 'wide-board',
    name: 'Tabuleiro amplo',
    builtIn: true,
    slots: { webcam: false, side: true, topBar: true, footer: true },
    dimensions: { margin: 24, topBar: 56, leftWidth: 0, sideWidth: 340, gap: 20 },
    typography: { scale: 0.95, minEssentialPx: 16 },
    colors: COLORS,
    safeMargins: { top: 0, right: 0, bottom: 0, left: 0 },
  },
];

export function builtInPreset(id: string): LayoutPreset | undefined {
  return BUILT_IN_PRESETS.find((p) => p.presetId === id);
}

export const DEFAULT_PRESET = BUILT_IN_PRESETS[0]!;

export interface ComputedLayout {
  width: number;
  height: number;
  margin: number;
  gap: number;
  topBar: number;
  footer: number;
  leftWidth: number;
  sideWidth: number;
  centerWidth: number;
  boardSize: number;
  cardHeight: number;
  /** Tamanhos de fonte em px. */
  font: { name: number; clock: number; row: number; meta: number; title: number };
  photoCard: number;
  photoList: number;
  rowHeight: number;
  showWebcam: boolean;
  showSide: boolean;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Calcula a composição para a área útil. A largura útil não inclui barras do navegador.
 * Prioriza: tabuleiro quadrado, fichas legíveis, lateral; remove a webcam e condensa a lateral antes
 * de encolher textos essenciais abaixo de minEssentialPx.
 */
export function computeLayout(preset: LayoutPreset, width: number, height: number): ComputedLayout {
  const w = Math.max(320, Math.floor(width));
  const h = Math.max(240, Math.floor(height));
  const s = preset.safeMargins;
  const k = clamp(h / 1080, 0.5, 2) * preset.typography.scale;
  const minPx = preset.typography.minEssentialPx;

  const margin = Math.round(preset.dimensions.margin * clamp(h / 1080, 0.6, 1.5));
  const gap = Math.round(preset.dimensions.gap * clamp(h / 1080, 0.6, 1.5));
  const topBar = preset.slots.topBar
    ? Math.max(40, Math.round(preset.dimensions.topBar * clamp(h / 1080, 0.7, 1.5)))
    : 0;
  const font = {
    name: Math.max(minPx + 2, Math.round(30 * k)),
    clock: Math.max(minPx + 6, Math.round(44 * k)),
    row: Math.max(minPx, Math.round(24 * k)),
    meta: Math.max(minPx, Math.round(18 * k)),
    title: Math.max(minPx + 2, Math.round(26 * k)),
  };
  const footer = preset.slots.footer ? Math.round(font.meta * 1.9) : 0;
  const photoCard = Math.round(clamp(88 * k, 48, 120));
  const photoList = Math.round(clamp(44 * k, 28, 64));
  const cardHeight = Math.round(
    Math.max(photoCard, font.name * 1.25 + font.meta * 1.4) + 16 * clamp(k, 0.6, 1.5),
  );
  const rowHeight = Math.max(Math.round(font.row * 1.9), photoList + 8);

  const innerW = w - s.left - s.right - margin * 2;
  const innerH =
    h - s.top - s.bottom - margin * 2 - topBar - (topBar ? gap : 0) - footer - (footer ? gap / 2 : 0);

  let showWebcam = preset.slots.webcam;
  let showSide = preset.slots.side;
  let leftWidth = showWebcam ? Math.round(preset.dimensions.leftWidth * clamp(w / 1920, 0.6, 1.5)) : 0;
  let sideWidth = showSide ? Math.round(preset.dimensions.sideWidth * clamp(w / 1920, 0.75, 1.5)) : 0;

  const boardFor = (lw: number, sw: number) => {
    const cw = innerW - lw - sw - (lw ? gap : 0) - (sw ? gap : 0);
    const bh = innerH - cardHeight - gap / 2;
    return { cw, board: Math.floor(Math.min(cw, bh) / 8) * 8 };
  };

  let { cw, board } = boardFor(leftWidth, sideWidth);
  const minBoard = Math.min(innerH * 0.6, 360);
  // Sem espaço: primeiro remove a webcam, depois condensa a lateral (não encolhe textos).
  if (board < minBoard && showWebcam) {
    showWebcam = false;
    leftWidth = 0;
    ({ cw, board } = boardFor(leftWidth, sideWidth));
  }
  if (board < minBoard && showSide) {
    const minSide = Math.max(240, font.row * 11);
    sideWidth = Math.max(minSide, Math.min(sideWidth, innerW - minBoard - gap));
    ({ cw, board } = boardFor(leftWidth, sideWidth));
  }
  if (board < 160 && showSide) {
    showSide = false;
    sideWidth = 0;
    ({ cw, board } = boardFor(leftWidth, sideWidth));
  }

  return {
    width: w,
    height: h,
    margin,
    gap,
    topBar,
    footer,
    leftWidth,
    sideWidth,
    centerWidth: Math.max(board, cw),
    boardSize: Math.max(64, board),
    cardHeight,
    font,
    photoCard,
    photoList,
    rowHeight,
    showWebcam,
    showSide,
  };
}

/** Normaliza um preset vindo de backup ou do editor do painel. */
export function sanitizePreset(value: unknown): LayoutPreset | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Partial<LayoutPreset>;
  if (typeof v.presetId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v.presetId)) return null;
  const base = builtInPreset(v.presetId) ?? DEFAULT_PRESET;
  const n = (x: unknown, min: number, max: number, d: number) =>
    typeof x === 'number' && Number.isFinite(x) ? clamp(Math.round(x), min, max) : d;
  const color = (x: unknown, d: string) => (typeof x === 'string' && /^#[0-9A-Fa-f]{6}$/.test(x) ? x : d);
  const dim = v.dimensions ?? base.dimensions;
  const slots = v.slots ?? base.slots;
  const typo = v.typography ?? base.typography;
  const colors = v.colors ?? base.colors;
  const safe = v.safeMargins ?? base.safeMargins;
  return {
    presetId: v.presetId,
    name: typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 60) : base.name,
    builtIn: false,
    slots: {
      webcam: !!slots.webcam,
      side: slots.side !== false,
      topBar: slots.topBar !== false,
      footer: slots.footer !== false,
    },
    dimensions: {
      margin: n(dim.margin, 0, 160, base.dimensions.margin),
      topBar: n(dim.topBar, 32, 160, base.dimensions.topBar),
      leftWidth: n(dim.leftWidth, 0, 800, base.dimensions.leftWidth),
      sideWidth: n(dim.sideWidth, 200, 900, base.dimensions.sideWidth),
      gap: n(dim.gap, 0, 80, base.dimensions.gap),
    },
    typography: {
      scale: typeof typo.scale === 'number' ? clamp(typo.scale, 0.7, 1.6) : 1,
      minEssentialPx: n(typo.minEssentialPx, 12, 32, 16),
    },
    colors: {
      background: color(colors.background, base.colors.background),
      surface: color(colors.surface, base.colors.surface),
      text: color(colors.text, base.colors.text),
      textSecondary: color(colors.textSecondary, base.colors.textSecondary),
      accent: color(colors.accent, base.colors.accent),
    },
    safeMargins: {
      top: n(safe.top, 0, 200, 0),
      right: n(safe.right, 0, 200, 0),
      bottom: n(safe.bottom, 0, 200, 0),
      left: n(safe.left, 0, 200, 0),
    },
  };
}
