import type { BrowserContext, Page } from '@playwright/test';
import { chromium, expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakeLichess, TOUR } from './fakeLichess';

/**
 * Ensaio automatizado curto (parte de T13/T18): 200 trocas de partida pelo programa, medição de
 * memória após coleta de lixo, streams órfãos, clique → retorno visual e evento → composição.
 * Não substitui a sessão de quatro horas com gravação (docs/HOMOLOGACAO.md); os números vão para
 * test-results/metricas-e2e.json e para o relatório de testes.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '../../dist');
const CHROMIUM = process.env.LTS_CHROMIUM || undefined;

async function launch(dir: string) {
  const context = await chromium.launchPersistentContext(dir, {
    headless: true,
    ...(CHROMIUM ? { executablePath: CHROMIUM } : { channel: 'chromium' }),
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--js-flags=--expose-gc'],
    viewport: { width: 1920, height: 1080 },
  });
  await installFakeLichess(context);
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  return { context, extensionId: sw.url().split('/')[2]! };
}

async function heap(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const g = (globalThis as unknown as { gc?: () => void }).gc;
    for (let i = 0; i < 3; i++) {
      g?.();
      await new Promise((r) => setTimeout(r, 50));
    }
    return (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
  });
}

function p95(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] ?? NaN;
}

test('T18 (curto): 200 trocas sem streams órfãos e com memória estável', async () => {
  test.setTimeout(420_000);
  const dir = mkdtempSync(join(tmpdir(), 'lts-stab-'));
  const { context, extensionId } = await launch(dir);
  try {
    const studio = await context.newPage();
    await studio.goto(`chrome-extension://${extensionId}/studio.html`);
    const page = await context.newPage();
    await page.goto(`https://lichess.org/tournament/${TOUR}`);
    await studio.evaluate(async (url) => {
      const [t] = await chrome.tabs.query({ url });
      return chrome.runtime.sendMessage({ type: 'lts:setBroadcast', tabId: t!.id, active: true });
    }, `https://lichess.org/tournament/${TOUR}`);
    const root = page.locator('#lts-root');
    await expect(root.locator('.lts-top')).toContainText('Arena Fictícia');
    await root.getByRole('tab', { name: 'Partidas' }).click();
    await expect(root.locator('.lts-row')).toHaveCount(2);

    const rows = root.locator('.lts-row');
    const switchOnce = async (i: number) => {
      const row = rows.nth(i % 2);
      const id = await row.getAttribute('data-id');
      await row.click();
      await expect(root.locator('.lts-cards')).toContainText(
        id === 'GameAAA1' ? 'Magnus_Ficticio' : 'Alireza_Ficticio',
      );
    };
    // Aquecimento: preenche caches e buffers limitados (log de diagnóstico, séries de métricas).
    for (let i = 0; i < 100; i++) await switchOnce(i);
    const heapStudio0 = await heap(studio);
    const heapPage0 = await heap(page);

    for (let i = 0; i < 200; i++) await switchOnce(i);
    await page.waitForTimeout(500);
    const heapStudio1 = await heap(studio);
    const heapPage1 = await heap(page);
    for (let i = 0; i < 200; i++) await switchOnce(i);
    await page.waitForTimeout(500);
    const heapStudio2 = await heap(studio);
    const heapPage2 = await heap(page);

    // Clique → retorno visual local (destaque da linha), medido dentro da página.
    const clickSamples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const ms = await page.evaluate(async (idx) => {
        const shadow = document.getElementById('lts-root')!.shadowRoot!;
        const list = [...shadow.querySelectorAll<HTMLElement>('.lts-row')].sort(
          (a, b) => parseInt(a.style.top) - parseInt(b.style.top),
        );
        const target = list.find((r) => !r.classList.contains('selected')) ?? list[idx % list.length]!;
        const id = target.dataset.id;
        const t0 = performance.now();
        target.click();
        return new Promise<number>((resolveMs) => {
          const check = () => {
            const el = shadow.querySelector<HTMLElement>(`.lts-row[data-id="${id}"]`);
            if (el?.classList.contains('selected')) resolveMs(performance.now() - t0);
            else requestAnimationFrame(check);
          };
          check();
        });
      }, i);
      clickSamples.push(ms);
      await page.waitForTimeout(150);
    }

    // Métricas do painel (evento → composição é enviado pelo programa a cada 10 s).
    await page.waitForTimeout(10_500);
    const diag = await studio.locator('#sec-diag').innerText();
    const streams = /Streams ativos\s*(\d+)/.exec(diag)?.[1];
    const eventP95 = /Evento → composição\s*(\d+) amostras · p95 (\d+|—)/.exec(diag);
    const switchP95 = /Troca de partida\s*(\d+) amostras · p95 (\d+|—)/.exec(diag);

    const metrics = {
      measuredAt: new Date().toISOString(),
      environment: 'Chromium headless (Playwright), Windows 11, Lichess simulado (fixtures locais)',
      switches: 500,
      streamsActiveAfter: Number(streams),
      heapStudioMB: {
        afterWarmup100: +(heapStudio0 / 1048576).toFixed(2),
        after300: +(heapStudio1 / 1048576).toFixed(2),
        after500: +(heapStudio2 / 1048576).toFixed(2),
        growthPctFirst200: +(((heapStudio1 - heapStudio0) / heapStudio0) * 100).toFixed(1),
        growthPctSecond200: +(((heapStudio2 - heapStudio1) / heapStudio1) * 100).toFixed(1),
      },
      heapProgramMB: {
        afterWarmup100: +(heapPage0 / 1048576).toFixed(2),
        after300: +(heapPage1 / 1048576).toFixed(2),
        after500: +(heapPage2 / 1048576).toFixed(2),
        growthPctFirst200: +(((heapPage1 - heapPage0) / heapPage0) * 100).toFixed(1),
        growthPctSecond200: +(((heapPage2 - heapPage1) / heapPage1) * 100).toFixed(1),
      },
      clickToFeedbackMs: { samples: clickSamples.length, p95: +p95(clickSamples).toFixed(1) },
      eventToRenderMs: {
        samples: Number(eventP95?.[1] ?? 0),
        p95: eventP95?.[2] === '—' ? null : Number(eventP95?.[2]),
      },
      switchToBoardMs: {
        samples: Number(switchP95?.[1] ?? 0),
        p95: switchP95?.[2] === '—' ? null : Number(switchP95?.[2]),
      },
    };
    mkdirSync('test-results', { recursive: true });
    writeFileSync('test-results/metricas-e2e.json', JSON.stringify(metrics, null, 2));
    console.log(JSON.stringify(metrics, null, 2));

    expect(metrics.streamsActiveAfter).toBeLessThanOrEqual(1);
    expect(metrics.heapStudioMB.growthPctFirst200).toBeLessThanOrEqual(10);
    expect(metrics.heapProgramMB.growthPctFirst200).toBeLessThanOrEqual(10);
    expect(metrics.heapStudioMB.growthPctSecond200).toBeLessThanOrEqual(10);
    expect(metrics.heapProgramMB.growthPctSecond200).toBeLessThanOrEqual(10);
    expect(metrics.clickToFeedbackMs.p95).toBeLessThanOrEqual(100);
    if (metrics.eventToRenderMs.p95 !== null) expect(metrics.eventToRenderMs.p95).toBeLessThanOrEqual(150);
  } finally {
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T12: exportar backup e restaurar em perfil limpo; pacote corrompido não altera dados', async () => {
  const dirA = mkdtempSync(join(tmpdir(), 'lts-bkA-'));
  const dirB = mkdtempSync(join(tmpdir(), 'lts-bkB-'));
  let ctxA: BrowserContext | null = null;
  let ctxB: BrowserContext | null = null;
  try {
    const a = await launch(dirA);
    ctxA = a.context;
    const opt = await ctxA.newPage();
    await opt.goto(`chrome-extension://${a.extensionId}/options.html`);
    for (const name of ['DarcioAlberico', 'EnxadristaHeterodoxo']) {
      await opt.getByLabel('Username no Lichess').fill(name);
      await opt.getByRole('button', { name: 'Pesquisar e confirmar' }).click();
      await expect(opt.getByText(`Confirmado: ${name}`)).toBeVisible();
      if (name === 'DarcioAlberico')
        await opt
          .locator('input[type=file]')
          .first()
          .setInputFiles(resolve(HERE, '../../assets/icons/icon128.png'));
      await opt.getByRole('button', { name: 'Salvar', exact: true }).click();
      await expect(opt.locator('.player', { hasText: name })).toBeVisible();
    }
    const [download] = await Promise.all([
      opt.waitForEvent('download'),
      opt.getByRole('button', { name: 'Exportar backup' }).click(),
    ]);
    const zipPath = join(dirA, 'backup.zip');
    await download.saveAs(zipPath);

    const b = await launch(dirB);
    ctxB = b.context;
    const optB = await ctxB.newPage();
    await optB.goto(`chrome-extension://${b.extensionId}/options.html`);
    await optB.getByLabel('Username no Lichess').fill('Magnus_Ficticio');
    await optB.getByRole('button', { name: 'Pesquisar e confirmar' }).click();
    await optB.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(optB.locator('.player')).toHaveCount(1);

    // Pacote corrompido: nada muda.
    const corruptPath = join(dirB, 'corrompido.zip');
    const { readFileSync } = await import('node:fs');
    const bytes = readFileSync(zipPath);
    const mid = Math.floor(bytes.length / 2);
    bytes[mid] = (bytes[mid] ?? 0) ^ 0xff;
    writeFileSync(corruptPath, bytes);
    await optB.getByLabel('Importar backup (.zip)').setInputFiles(corruptPath);
    await expect(optB.getByText(/Pacote inválido — nada foi alterado/)).toBeVisible();
    await expect(optB.locator('.player')).toHaveCount(1);

    // Pacote válido: prévia e mesclagem.
    await optB.getByLabel('Importar backup (.zip)').setInputFiles(zipPath);
    await expect(optB.getByText('Prévia da importação')).toBeVisible();
    await expect(optB.locator('.editor', { hasText: 'Prévia' })).toContainText('2 jogadores, 1 fotos');
    await optB.getByRole('button', { name: /Mesclar/ }).click();
    await expect(optB.getByText(/Importação concluída/)).toBeVisible();
    await expect(optB.locator('.player')).toHaveCount(3);
    await expect(optB.locator('.player', { hasText: 'DarcioAlberico' }).locator('img')).toBeVisible();
    await expect(optB.getByText('Backups automáticos anteriores à importação')).toBeVisible();
  } finally {
    await ctxA?.close();
    await ctxB?.close();
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});
