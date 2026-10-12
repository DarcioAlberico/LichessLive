import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DiagnosticsLog, MetricSeries } from '../../src/diagnostics';
import {
  cropToPixels,
  defaultCrop,
  detectImageType,
  validateDimensions,
  validateUpload,
} from '../../src/persistence/photos/photoProcessing';
import {
  parseProgramMessage,
  parseRuntimeMessage,
  PROTOCOL_VERSION,
} from '../../src/shared/protocol/messages';
import { sanitizeSettings } from '../../src/shared/settings';
import { formatHourLabel, formatTime } from '../../src/shared/time';
import { crc32, createZip, isSafeZipPath, readZip } from '../../src/shared/zip';

const env = {
  protocolVersion: PROTOCOL_VERSION,
  sessionId: 's',
  tournamentId: 'Tour1234',
  requestId: 'r',
  generation: 1,
};

describe('protocolo de mensagens', () => {
  it('rejeita tipos desconhecidos e pedidos de URL arbitrária', () => {
    expect(parseRuntimeMessage({ type: 'fetch', url: 'https://evil.example' })).toBeNull();
    expect(parseRuntimeMessage({ type: 'lts:toggleBroadcast', tabId: 'x' })).toBeNull();
    expect(parseRuntimeMessage({ type: 'lts:toggleBroadcast', tabId: 7 })).toEqual({
      type: 'lts:toggleBroadcast',
      tabId: 7,
    });
    expect(
      parseRuntimeMessage({ type: 'lts:resizeProgramWindow', tabId: 1, width: 10, height: 10 }),
    ).toBeNull();
    expect(parseRuntimeMessage({ type: 'lts:command', command: 'rm -rf' })).toBeNull();
    expect(parseRuntimeMessage(null)).toBeNull();
  });
  it('exige envelope versionado e IDs válidos nas intenções', () => {
    expect(
      parseProgramMessage({ ...env, type: 'intent', intent: { type: 'selectGame', gameId: '6fwDn5JD' } }),
    ).toMatchObject({ intent: { gameId: '6fwDn5JD' } });
    expect(
      parseProgramMessage({ ...env, type: 'intent', intent: { type: 'selectGame', gameId: '../../x' } }),
    ).toBeNull();
    expect(
      parseProgramMessage({
        ...env,
        type: 'intent',
        intent: { type: 'selectPlayer', userId: 'DarcioAlberico' },
      }),
    ).toMatchObject({ intent: { userId: 'darcioalberico' } });
    expect(parseProgramMessage({ ...env, protocolVersion: 99, type: 'bye' })).toBeNull();
    expect(parseProgramMessage({ ...env, tournamentId: 'bad', type: 'bye' })).toBeNull();
    expect(parseProgramMessage({ ...env, type: 'intent', intent: { type: 'fetch', url: 'x' } })).toBeNull();
  });
});

describe('ZIP', () => {
  it('ida e volta com CRC-32', async () => {
    const enc = new TextEncoder();
    const zip = createZip([
      { path: 'a.txt', data: enc.encode('olá') },
      { path: 'dir/b.bin', data: new Uint8Array([0, 1, 2, 255]) },
    ]);
    const files = await readZip(zip);
    expect(new TextDecoder().decode(files.get('a.txt'))).toBe('olá');
    expect([...files.get('dir/b.bin')!]).toEqual([0, 1, 2, 255]);
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
  });
  it('lê entradas comprimidas com deflate', async () => {
    const data = new TextEncoder().encode('x'.repeat(1000));
    const zip = createZip([{ path: 'x.txt', data }]);
    // Reescreve a entrada como deflate (método 8).
    const comp = deflateRawSync(data);
    const name = new TextEncoder().encode('x.txt');
    const local = new Uint8Array(30 + name.length + comp.length);
    local.set(zip.subarray(0, 30 + name.length));
    const lv = new DataView(local.buffer);
    lv.setUint16(8, 8, true);
    lv.setUint32(18, comp.length, true);
    local.set(comp, 30 + name.length);
    const central = zip.slice(30 + name.length + data.length, zip.length - 22);
    const cv = new DataView(central.buffer);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, comp.length, true);
    const eocd = zip.slice(zip.length - 22);
    new DataView(eocd.buffer).setUint32(16, local.length, true);
    const out = new Uint8Array(local.length + central.length + eocd.length);
    out.set(local);
    out.set(central, local.length);
    out.set(eocd, local.length + central.length);
    const files = await readZip(out);
    expect(files.get('x.txt')).toEqual(data);
  });
  it('valida caminhos e limites', async () => {
    expect(isSafeZipPath('photos/a.webp')).toBe(true);
    for (const p of ['../a', '/a', 'a/../b', 'a\\b', 'C:/x', '', 'a//b'])
      expect(isSafeZipPath(p)).toBe(false);
    const big = createZip([{ path: 'a', data: new Uint8Array(100) }]);
    await expect(
      readZip(big, { maxEntries: 10, maxTotalUncompressed: 50, maxEntryUncompressed: 1000 }),
    ).rejects.toThrow(/limite/);
    const many = createZip(Array.from({ length: 5 }, (_, i) => ({ path: `f${i}`, data: new Uint8Array(1) })));
    await expect(
      readZip(many, { maxEntries: 3, maxTotalUncompressed: 1e9, maxEntryUncompressed: 1e9 }),
    ).rejects.toThrow(/limite/);
  });
});

describe('fotos (validação)', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  it('valida assinatura, MIME e tamanho; recusa SVG', () => {
    expect(detectImageType(png)).toBe('image/png');
    expect(detectImageType(jpg)).toBe('image/jpeg');
    expect(validateUpload('image/png', 1000, png)).toEqual({ ok: true, mime: 'image/png' });
    expect(validateUpload('image/jpeg', 1000, png).ok).toBe(false);
    expect(validateUpload('image/svg+xml', 100, new TextEncoder().encode('<svg')).ok).toBe(false);
    expect(validateUpload('image/png', 6 * 1024 * 1024, png).ok).toBe(false);
    expect(validateUpload('', 10, new Uint8Array([1, 2, 3])).ok).toBe(false);
    expect(validateDimensions(5000, 100)).toMatch(/4096/);
    expect(validateDimensions(800, 600)).toBeNull();
  });
  it('recorte quadrado nunca estica nem sai da imagem', () => {
    const c = defaultCrop(800, 600);
    expect(cropToPixels(c, 800, 600)).toEqual({ sx: 100, sy: 0, side: 600 });
    expect(cropToPixels({ x: 0.9, y: 0.9, size: 0.5 }, 800, 600)).toEqual({ sx: 400, sy: 200, side: 400 });
    expect(cropToPixels({ x: 0, y: 0, size: 2 }, 800, 600).side).toBe(600);
  });
});

describe('preferências, horas e diagnóstico', () => {
  it('sanitiza preferências lidas de armazenamento ou backup', () => {
    const s = sanitizeSettings({
      timezone: 'Mars/Olympus',
      rankingNb: 99999,
      rankingIntervalSec: 1,
      lastTab: 'hack',
    });
    expect(s.timezone).toBe('America/Sao_Paulo');
    expect(s.rankingNb).toBe(1000);
    expect(s.rankingIntervalSec).toBe(15);
    expect(s.lastTab).toBe('team');
    expect(s.autoSwitch).toBe(false);
  });
  it('mostra horas no fuso configurado', () => {
    const t = Date.UTC(2026, 9, 12, 23, 10, 5);
    expect(formatTime(t, 'America/Sao_Paulo')).toBe('20:10');
    expect(formatHourLabel(t, 'America/Sao_Paulo')).toBe('20h10');
    expect(formatTime(t, 'America/Sao_Paulo', true)).toBe('20:10:05');
  });
  it('logs não guardam tokens, cookies ou imagens', () => {
    const log = new DiagnosticsLog(3);
    log.info('rest', 'ok', { detail: 'Authorization: Bearer lip_abc' });
    log.warn('x', 'y', { error: 'data:image/png;base64,AAAA' });
    expect(log.list()[0]!.detail).toBe('[removido]');
    expect(log.list()[1]!.error).toBe('[removido]');
    for (let i = 0; i < 5; i++) log.info('a', 'b');
    expect(log.list()).toHaveLength(3);
  });
  it('percentis de métricas', () => {
    const m = new MetricSeries();
    for (let i = 1; i <= 100; i++) m.add(i);
    expect(m.percentile(95)).toBe(95);
    expect(m.percentile(50)).toBe(50);
  });
});
