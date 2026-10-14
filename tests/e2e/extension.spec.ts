import type { BrowserContext, Page, Worker } from '@playwright/test';
import { chromium, expect, test as base } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakeLichess, SWISS, TOUR } from './fakeLichess';

/**
 * E2E com a extensão real carregada no Chromium (contexto persistente). O Lichess é simulado por
 * rotas locais com dados fictícios (fakeLichess.ts) para repetibilidade; a conferência em torneios
 * públicos reais faz parte do roteiro de homologação manual (docs/HOMOLOGACAO.md).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '../../dist');
const CHROMIUM = process.env.LTS_CHROMIUM || undefined;

interface Fixtures {
  context: BrowserContext;
  extensionId: string;
  sw: Worker;
  userDataDir: string;
}

async function launch(userDataDir: string) {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    ...(CHROMIUM ? { executablePath: CHROMIUM } : { channel: 'chromium' }),
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    viewport: { width: 1920, height: 1080 },
  });
  await installFakeLichess(context);
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extensionId = sw.url().split('/')[2]!;
  return { context, sw, extensionId };
}

const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- fixture do Playwright sem dependências
  userDataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'lts-e2e-'));
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },
  context: async ({ userDataDir }, use) => {
    if (!existsSync(join(DIST, 'manifest.json'))) throw new Error('Execute "npm run build" antes do E2E.');
    const { context } = await launch(userDataDir);
    await use(context);
    await context.close();
  },
  sw: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },
  extensionId: async ({ sw }, use) => {
    await use(sw.url().split('/')[2]!);
  },
});

async function openStudio(context: BrowserContext, extensionId: string): Promise<Page> {
  const studio = await context.newPage();
  await studio.setViewportSize({ width: 1300, height: 1000 });
  await studio.goto(`chrome-extension://${extensionId}/studio.html`);
  await expect(studio.locator('h1')).toContainText('Painel de operação');
  return studio;
}

async function setBroadcast(studio: Page, url: string, active: boolean) {
  await studio.evaluate(
    async ({ url, active }) => {
      const tabs = await chrome.tabs.query({ url });
      const tabId = tabs[0]?.id;
      if (tabId === undefined) throw new Error('aba não encontrada');
      return chrome.runtime.sendMessage({ type: 'lts:setBroadcast', tabId, active });
    },
    { url, active },
  );
}

const program = (page: Page) => page.locator('#lts-root');

test('T01/T02/T03/T05/T10: ativa, seleciona, troca e restaura a página', async ({ context, extensionId }) => {
  const studio = await openStudio(context, extensionId);
  const page = await context.newPage();
  await page.goto(`https://lichess.org/tournament/${TOUR}`);
  await expect(page.locator('#native-board')).toBeVisible();

  await setBroadcast(studio, `https://lichess.org/tournament/${TOUR}`, true);
  await expect(program(page)).toHaveCount(1);
  await expect(program(page).locator('.lts-top')).toContainText('Arena Fictícia de Homologação');
  await expect(program(page).locator('.lts-boardempty')).toContainText('Aguardando seleção');

  // Lista local de acompanhados pelo painel de operação.
  await studio.getByLabel('Team (ID do Lichess) ou lista local').fill('_local');
  await studio.getByRole('button', { name: 'Usar' }).click();
  await studio
    .getByLabel('Adicionar usernames (separados por vírgula ou espaço)')
    .fill('DarcioAlberico, EnxadristaHeterodoxo');
  await studio.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect(studio.locator('#sec-team table')).toContainText('DarcioAlberico');

  // Partida pela lista de partidas identificadas no painel.
  await studio
    .locator('#sec-game table tr', { hasText: 'Magnus_Ficticio' })
    .getByRole('button', { name: 'Abrir' })
    .click();
  await expect(program(page).locator('.lts-piece')).toHaveCount(32);
  await expect(program(page).locator('.lts-card').first()).toContainText('Magnus_Ficticio');
  await expect(program(page).locator('.lts-foot')).toContainText('Lances com atraso da API (3 lances)');

  // T03: jogador fora do top inicial e fora dos duelos informados, pelo programa (Nosso team).
  await program(page).getByRole('tab', { name: 'Nosso team' }).click();
  await expect(program(page).locator('.lts-row', { hasText: 'DarcioAlberico' })).toBeVisible();
  await program(page).locator('.lts-row', { hasText: 'DarcioAlberico' }).click();
  await expect(program(page).locator('.lts-cards')).toContainText('DarcioAlberico');
  await expect(program(page).locator('.lts-cards')).toContainText('Um_Nome_De_Jogador_Muito_Longo_X');
  // Acompanhando as pretas: tabuleiro orientado pelas pretas e ficha correspondente.
  await expect(program(page).locator('.lts-foot')).toContainText('Acompanhando DarcioAlberico');

  // T10: a composição capturada não tem formulários do operador.
  expect(await program(page).locator('input, select, textarea, form').count()).toBe(0);

  // Girar pelo painel não troca fichas.
  const before = await program(page).locator('.lts-cards').innerText();
  await studio.getByRole('button', { name: 'Girar tabuleiro' }).click();
  await expect
    .poll(async () => program(page).locator('.lts-sq').first().getAttribute('style'))
    .toContain('top: 87.5%');
  expect(await program(page).locator('.lts-cards').innerText()).toBe(before);

  await page.screenshot({ path: 'test-results/programa-1080p.png' });
  await studio.screenshot({ path: 'test-results/painel-operacao.png', fullPage: true });

  // T01: desativar restaura a página original sem recarregar.
  await setBroadcast(studio, `https://lichess.org/tournament/${TOUR}`, false);
  await expect(program(page)).toHaveCount(0);
  await expect(page.locator('#native-board')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.classList.contains('lts-active'))).toBe(false);
  expect(await page.evaluate(() => document.body.inert)).toBe(false);
});

test('T01: ativar e desativar dez vezes mantém um único root', async ({ context, extensionId }) => {
  const studio = await openStudio(context, extensionId);
  const page = await context.newPage();
  await page.goto(`https://lichess.org/tournament/${TOUR}`);
  for (let i = 0; i < 10; i++) {
    await setBroadcast(studio, `https://lichess.org/tournament/${TOUR}`, true);
    await expect(program(page)).toHaveCount(1);
    await setBroadcast(studio, `https://lichess.org/tournament/${TOUR}`, false);
    await expect(program(page)).toHaveCount(0);
  }
  await expect(page.locator('#native-board')).toBeVisible();
});

test('T02: Swiss é reconhecido e informado como não suportado', async ({ context, extensionId }) => {
  const studio = await openStudio(context, extensionId);
  const page = await context.newPage();
  await page.goto(`https://lichess.org/swiss/${SWISS}`);
  await setBroadcast(studio, `https://lichess.org/swiss/${SWISS}`, true);
  await expect(program(page)).toContainText('Swiss não são suportados');
});

test('T11: 1280×720 sem rolagem, tabuleiro quadrado', async ({ context, extensionId }) => {
  const studio = await openStudio(context, extensionId);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`https://lichess.org/tournament/${TOUR}`);
  await setBroadcast(studio, `https://lichess.org/tournament/${TOUR}`, true);
  await studio
    .locator('#sec-game table tr', { hasText: 'Alireza_Ficticio' })
    .getByRole('button', { name: 'Abrir' })
    .click();
  await expect(program(page).locator('.lts-piece')).toHaveCount(32);
  // Preset compacto de 720p.
  await studio.getByLabel('Preset').selectOption('compact-720');
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const root = document.getElementById('lts-root')!.shadowRoot!;
    const app = root.querySelector('.lts-app') as HTMLElement;
    const board = root.querySelector('.lts-board') as HTMLElement;
    const r = board.getBoundingClientRect();
    const all = [...root.querySelectorAll('.lts-card, .lts-side, .lts-foot, .lts-top')].map((e) =>
      e.getBoundingClientRect(),
    );
    return {
      w: r.width,
      h: r.height,
      overflowY: app.scrollHeight - app.clientHeight,
      overflowX: app.scrollWidth - app.clientWidth,
      maxBottom: Math.max(...all.map((b) => b.bottom)),
      maxRight: Math.max(...all.map((b) => b.right)),
    };
  });
  expect(Math.abs(m.w - m.h)).toBeLessThan(1);
  expect(m.w).toBeGreaterThan(400);
  expect(m.overflowY).toBeLessThanOrEqual(0);
  expect(m.overflowX).toBeLessThanOrEqual(0);
  expect(m.maxBottom).toBeLessThanOrEqual(720);
  expect(m.maxRight).toBeLessThanOrEqual(1280);
  await page.screenshot({ path: 'test-results/programa-720p.png' });
});

test('T17: painel fechado é informado e a reconexão é previsível', async ({ context, extensionId }) => {
  const studio = await openStudio(context, extensionId);
  const page = await context.newPage();
  await page.goto(`https://lichess.org/tournament/${TOUR}`);
  await setBroadcast(studio, `https://lichess.org/tournament/${TOUR}`, true);
  await studio
    .locator('#sec-game table tr', { hasText: 'Magnus_Ficticio' })
    .getByRole('button', { name: 'Abrir' })
    .click();
  await expect(program(page).locator('.lts-piece')).toHaveCount(32);
  await studio.close();
  await expect(program(page)).toContainText('Painel desconectado');
  // A última posição continua visível (não some nem pisca).
  await expect(program(page).locator('.lts-piece')).toHaveCount(32);
  const studio2 = await openStudio(context, extensionId);
  await expect(program(page)).not.toContainText('Painel desconectado', { timeout: 15_000 });
  // A seleção persistida é restaurada pela nova janela de operação.
  await expect(program(page).locator('.lts-cards')).toContainText('Magnus_Ficticio');
  await studio2.close();
});

test('T14: atualizar a página restaura o modo transmissão e a seleção', async ({ context, extensionId }) => {
  const studio = await openStudio(context, extensionId);
  const page = await context.newPage();
  await page.goto(`https://lichess.org/tournament/${TOUR}`);
  await setBroadcast(studio, `https://lichess.org/tournament/${TOUR}`, true);
  await studio
    .locator('#sec-game table tr', { hasText: 'Alireza_Ficticio' })
    .getByRole('button', { name: 'Abrir' })
    .click();
  await expect(program(page).locator('.lts-cards')).toContainText('Alireza_Ficticio');
  await page.reload();
  await expect(program(page)).toHaveCount(1);
  await expect(program(page).locator('.lts-cards')).toContainText('Alireza_Ficticio');
});

test('T06: foto cadastrada sobrevive ao reinício e aparece no programa', async ({ userDataDir }) => {
  let { context, extensionId } = await launch(userDataDir);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel('Username no Lichess').fill('darcioalberico');
  await options.getByRole('button', { name: 'Pesquisar e confirmar' }).click();
  await expect(options.getByText('Confirmado: DarcioAlberico')).toBeVisible();
  await options
    .getByLabel('Nome de exibição (opcional — não altera username nem ID)')
    .fill('Dárcio Alberico');
  await options
    .locator('input[type=file]')
    .first()
    .setInputFiles(resolve(HERE, '../../assets/icons/icon128.png'));
  await expect(options.locator('canvas.crop-canvas')).toBeVisible();
  await options.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(options.locator('.player', { hasText: 'Dárcio Alberico' }).locator('img')).toBeVisible();
  await context.close();

  // Reinício do navegador com o mesmo perfil.
  ({ context, extensionId } = await launch(userDataDir));
  const options2 = await context.newPage();
  await options2.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options2.locator('.player', { hasText: 'Dárcio Alberico' }).locator('img')).toBeVisible();
  // Caixa diferente no username não cria outro cadastro.
  await options2.getByLabel('Username no Lichess').fill('DARCIOALBERICO');
  await options2.getByRole('button', { name: 'Pesquisar e confirmar' }).click();
  await options2.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(options2.locator('.player')).toHaveCount(1);

  const studio = await openStudio(context, extensionId);
  const page = await context.newPage();
  await page.goto(`https://lichess.org/tournament/${TOUR}`);
  await setBroadcast(studio, `https://lichess.org/tournament/${TOUR}`, true);
  await studio.getByLabel('Jogador (username)').fill('DarcioAlberico');
  await studio.getByRole('button', { name: 'Acompanhar jogador' }).click();
  const photo = program(page).locator('.lts-card', { hasText: 'Dárcio Alberico' }).locator('.lts-photo img');
  await expect(photo).toHaveAttribute('src', /^blob:/);
  const dims = await photo.evaluate((img: HTMLImageElement) => ({
    w: img.getBoundingClientRect().width,
    h: img.getBoundingClientRect().height,
    fit: getComputedStyle(img).objectFit,
  }));
  expect(Math.abs(dims.w - dims.h)).toBeLessThan(1);
  expect(dims.fit).toBe('cover');
  await page.screenshot({ path: 'test-results/programa-com-foto.png' });
  await context.close();
});

test('popup inicia, foca ou encerra sem depender de estar aberto', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByRole('button', { name: 'Abrir painel de operação' })).toBeVisible();
  await expect(popup.getByText(/Abra a página de um torneio Arena|Aba sem endereço/)).toBeVisible();
  await popup.getByRole('button', { name: 'Abrir painel de operação' }).click();
  await expect.poll(() => context.pages().some((p) => p.url().endsWith('/studio.html'))).toBe(true);
});

test('importação de membros: lista pública com cobertura e lista privada com cadastro manual', async ({
  context,
  extensionId,
}) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const teamInput = options.getByLabel(/ID do team/);
  await teamInput.fill('time-ficticio');
  await options.getByRole('button', { name: 'Importar membros públicos' }).click();
  await expect(options.getByText(/3 membros importados de 3 declarados/)).toBeVisible();
  await options.locator('#teams tr', { hasText: 'DarcioAlberico' }).getByLabel('Acompanhar').check();
  await expect(options.locator('#teams h3')).toContainText('acompanhados: 1');

  await teamInput.fill('time-privado');
  await options.getByRole('button', { name: 'Importar membros públicos' }).click();
  await expect(
    options.getByText('A lista de membros deste team não é pública. Use o cadastro manual.'),
  ).toBeVisible();
});

test('composição continua visível mesmo com CSS da página que esconde elementos anexados', async ({
  context,
  extensionId,
}) => {
  const studio = await openStudio(context, extensionId);
  const page = await context.newPage();
  await page.goto(`https://lichess.org/tournament/${TOUR}`);
  await setBroadcast(studio, `https://lichess.org/tournament/${TOUR}`, true);
  await expect(program(page).locator('.lts-top')).toBeVisible();
  const m = await page.evaluate(() => {
    const host = document.getElementById('lts-root')!;
    const cs = getComputedStyle(host);
    const r = host.getBoundingClientRect();
    return {
      tag: host.tagName.toLowerCase(),
      w: r.width,
      h: r.height,
      visibility: cs.visibility,
      opacity: cs.opacity,
      vw: innerWidth,
      vh: innerHeight,
    };
  });
  expect(m.tag).toBe('lts-program-root');
  expect(m.visibility).toBe('visible');
  expect(m.opacity).toBe('1');
  expect(m.w).toBe(m.vw);
  expect(m.h).toBe(m.vh);
  await page.screenshot({ path: 'test-results/programa-css-hostil.png' });
});
