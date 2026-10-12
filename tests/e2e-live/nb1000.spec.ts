import { chromium, expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');
const TOUR = process.env.LTS_LIVE_TOURNAMENT;

test('Arena real com cobertura nb=1000', async () => {
  test.skip(!TOUR, 'Defina LTS_LIVE_TOURNAMENT.');
  test.setTimeout(180_000);
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'lts-nb-')), {
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
  const nb = studio.getByLabel('Cobertura pedida (nb)');
  await expect(nb).toBeVisible({ timeout: 20_000 });
  await nb.fill('1000');
  await nb.press('Tab');
  await studio.getByRole('button', { name: 'Atualizar agora' }).click();
  await expect(studio.locator('#sec-ranking')).toContainText(/(Parcial|Completa).*1000|Completa/, {
    timeout: 90_000,
  });
  const root = page.locator('#lts-root');
  await root.getByRole('tab', { name: 'Classificação' }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-results/live-nb1000.png' });
  console.log(await studio.locator('#sec-ranking').innerText());
  console.log((await studio.locator('#sec-diag .log').innerText()).split('\n').slice(0, 6).join('\n'));
  await ctx.close();
});
