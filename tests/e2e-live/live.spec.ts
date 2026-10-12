import { chromium, expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Conferência manual opcional contra o Lichess real (não roda no CI). Uso:
// LTS_LIVE_TOURNAMENT=<id> npx playwright test -c tests/e2e-live
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');
const TOUR = process.env.LTS_LIVE_TOURNAMENT;

test('Arena real: ativa, carrega a partida em destaque e a classificação', async () => {
  test.skip(!TOUR, 'Defina LTS_LIVE_TOURNAMENT com o ID de uma Arena em andamento.');
  test.setTimeout(120_000);
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'lts-live-')), {
    headless: true,
    ...(process.env.LTS_CHROMIUM ? { executablePath: process.env.LTS_CHROMIUM } : { channel: 'chromium' }),
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    viewport: { width: 1920, height: 1080 },
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2];
  const studio = await ctx.newPage();
  await studio.goto(`chrome-extension://${id}/studio.html`);
  const page = await ctx.newPage();
  await page.goto(`https://lichess.org/tournament/${TOUR}`);
  await studio.evaluate(async (url) => {
    const [t] = await chrome.tabs.query({ url });
    return chrome.runtime.sendMessage({ type: 'lts:setBroadcast', tabId: t!.id, active: true });
  }, `https://lichess.org/tournament/${TOUR}`);
  const root = page.locator('#lts-root');
  await expect(root.locator('.lts-top .t-name')).not.toHaveText('Carregando torneio…', { timeout: 20_000 });
  await expect(studio.locator('#sec-game table tr').first()).toBeVisible({ timeout: 20_000 });
  await studio.locator('#sec-game table tr').first().getByRole('button', { name: 'Abrir' }).click();
  await expect(root.locator('.lts-piece').first()).toBeVisible({ timeout: 30_000 });
  await expect(root.locator('.lts-foot')).toContainText('Lances com atraso da API');
  await root.getByRole('tab', { name: 'Classificação' }).click();
  await expect(root.locator('.lts-row').first()).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'test-results/live-arena.png' });
  console.log(await studio.locator('#sec-ranking').innerText());
  console.log((await studio.locator('#sec-diag .log').innerText()).split('\n').slice(0, 12).join('\n'));
  await ctx.close();
});
