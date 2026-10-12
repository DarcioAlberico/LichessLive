import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_PRESETS,
  builtInPreset,
  computeLayout,
  sanitizePreset,
} from '../../src/presentation/layouts/presets';

function totalWidth(l: ReturnType<typeof computeLayout>) {
  const cols = [l.leftWidth, l.centerWidth, l.sideWidth].filter((x) => x > 0);
  return l.margin * 2 + cols.reduce((a, b) => a + b, 0) + l.gap * (cols.length - 1);
}
function totalHeight(l: ReturnType<typeof computeLayout>) {
  return l.margin * 2 + l.topBar + l.gap / 2 + l.boardSize + l.gap / 2 + l.cardHeight + l.gap / 2 + l.footer;
}

describe('composição (T11)', () => {
  it('1920×1080 com webcam: tabuleiro próximo de 720 px e sem rolagem', () => {
    const l = computeLayout(builtInPreset('single-1080')!, 1920, 1080);
    expect(l.showWebcam).toBe(true);
    expect(l.boardSize).toBeGreaterThanOrEqual(700);
    expect(l.boardSize).toBeLessThanOrEqual(840);
    expect(l.boardSize % 8).toBe(0);
    expect(totalWidth(l)).toBeLessThanOrEqual(1920);
    expect(totalHeight(l)).toBeLessThanOrEqual(1080);
    expect(l.font.name).toBeGreaterThanOrEqual(28);
    expect(l.font.name).toBeLessThanOrEqual(32);
    expect(l.font.clock).toBeGreaterThanOrEqual(40);
    expect(l.font.clock).toBeLessThanOrEqual(48);
    expect(l.font.row).toBeGreaterThanOrEqual(22);
    expect(l.font.meta).toBe(18);
  });
  it('1280×720 compacto: sem webcam, tabuleiro próximo de 480 e texto essencial ≥ 16 px', () => {
    const l = computeLayout(builtInPreset('compact-720')!, 1280, 720);
    expect(l.showWebcam).toBe(false);
    expect(l.boardSize).toBeGreaterThanOrEqual(440);
    expect(l.boardSize).toBeLessThanOrEqual(560);
    expect(totalWidth(l)).toBeLessThanOrEqual(1280);
    expect(totalHeight(l)).toBeLessThanOrEqual(720);
    for (const v of Object.values(l.font)) expect(v).toBeGreaterThanOrEqual(16);
  });
  it('preset de 1080p em janela de 720p remove a webcam antes de encolher textos', () => {
    const l = computeLayout(builtInPreset('single-1080')!, 1280, 720);
    expect(totalWidth(l)).toBeLessThanOrEqual(1280);
    expect(l.font.meta).toBeGreaterThanOrEqual(16);
  });
  it('todos os presets mantêm tabuleiro quadrado e cabem em várias janelas', () => {
    for (const p of BUILT_IN_PRESETS) {
      for (const [w, h] of [
        [1920, 1080],
        [1600, 900],
        [1280, 720],
        [1366, 768],
        [1024, 768],
      ] as const) {
        const l = computeLayout(p, w, h);
        expect(totalWidth(l), `${p.presetId} ${w}x${h}`).toBeLessThanOrEqual(w + 1);
        expect(totalHeight(l), `${p.presetId} ${w}x${h}`).toBeLessThanOrEqual(h + 1);
        expect(l.boardSize).toBeGreaterThan(200);
      }
    }
  });
  it('sanitiza presets vindos de backup ou do editor', () => {
    expect(sanitizePreset({ presetId: '../x' })).toBeNull();
    const p = sanitizePreset({
      presetId: 'custom-1',
      name: 'X',
      dimensions: { margin: 9999 },
      colors: { background: 'red' },
    });
    expect(p?.dimensions.margin).toBe(160);
    expect(p?.colors.background).toBe('#101722');
    expect(p?.builtIn).toBe(false);
  });
});
