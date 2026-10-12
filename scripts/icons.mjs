// Gera os ícones PNG da extensão (16, 32, 48, 128) a partir de um SVG próprio, usando o
// Chromium do Playwright (ferramenta de desenvolvimento). Executar: node scripts/icons.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const knight = readFileSync(resolve(root, 'assets/pieces/wN.svg'), 'utf8').replace(
  '<svg ',
  '<svg x="8" y="6" width="84" height="84" ',
);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="2" y="2" width="96" height="96" rx="20" fill="#101722"/>
  <rect x="2" y="2" width="96" height="96" rx="20" fill="none" stroke="#6CB4FF" stroke-width="5"/>
  ${knight}
  <circle cx="80" cy="22" r="9" fill="#FF5A5A"/>
</svg>`;

mkdirSync(resolve(root, 'assets/icons'), { recursive: true });
const executablePath = process.env.LTS_CHROMIUM || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.screenshot({ path: resolve(root, `assets/icons/icon${size}.png`), omitBackground: true });
}
await browser.close();
console.log('Ícones gerados em assets/icons');
