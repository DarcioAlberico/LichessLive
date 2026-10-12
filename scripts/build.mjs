// Build da extensão com esbuild: entradas explícitas de background, content, studio, options e
// popup (SPEC 8.4). Nenhum código é carregado por CDN; tudo é empacotado em dist/.
// Uso: node scripts/build.mjs [--dev] [--watch]
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const entries = {
  background: 'src/background/index.ts',
  content: 'src/content/index.tsx',
  studio: 'src/studio/main.tsx',
  options: 'src/options/main.tsx',
  popup: 'src/popup/index.tsx',
};

/** Conversor mínimo de Markdown para as páginas de documentação empacotadas. */
function markdownToHtml(md, title) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  const out = [];
  let list = false;
  let table = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^\|/.test(line)) {
      if (/^\|\s*-/.test(line)) continue;
      if (!table) out.push('<table>');
      table = true;
      out.push(
        '<tr>' +
          line
            .split('|')
            .slice(1, -1)
            .map((c) => `<td>${inline(c.trim())}</td>`)
            .join('') +
          '</tr>',
      );
      continue;
    } else if (table) {
      out.push('</table>');
      table = false;
    }
    if (/^\s*[-*] /.test(line)) {
      if (!list) out.push('<ul>');
      list = true;
      out.push(`<li>${inline(line.replace(/^\s*[-*] /, ''))}</li>`);
      continue;
    } else if (list) {
      out.push('</ul>');
      list = false;
    }
    const h = /^(#{1,4}) (.*)$/.exec(line);
    if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push('</ul>');
  if (table) out.push('</table>');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="stylesheet" href="../ui.css"></head><body><div class="doc">${out.join('\n')}</div></body></html>`;
}

function copyStatic() {
  mkdirSync(dist, { recursive: true });
  for (const f of ['studio.html', 'options.html', 'popup.html', 'ui.css'])
    cpSync(resolve(root, 'static', f), resolve(dist, f));
  cpSync(resolve(root, 'assets/icons'), resolve(dist, 'icons'), { recursive: true });
  const manifest = JSON.parse(readFileSync(resolve(root, 'static/manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  writeFileSync(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
  mkdirSync(resolve(dist, 'docs'), { recursive: true });
  for (const [src, out, title] of [
    ['docs/PRIVACIDADE.md', 'privacidade.html', 'Política de dados locais'],
    ['docs/LICENCAS.md', 'licencas.html', 'Inventário de licenças'],
  ]) {
    const p = resolve(root, src);
    if (existsSync(p))
      writeFileSync(resolve(dist, 'docs', out), markdownToHtml(readFileSync(p, 'utf8'), title));
  }
  cpSync(resolve(root, 'LICENSE'), resolve(dist, 'LICENSE.txt'));
}

const options = {
  entryPoints: entries,
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: ['chrome120'],
  platform: 'browser',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: !dev,
  sourcemap: dev ? 'linked' : false,
  legalComments: 'linked',
  charset: 'utf8',
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
  logLevel: 'info',
};

if (!watch) rmSync(dist, { recursive: true, force: true });
copyStatic();
if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('Observando alterações… (Ctrl+C para sair)');
} else {
  await esbuild.build(options);
  console.log(`Build ${dev ? 'de desenvolvimento' : 'de produção'} ${pkg.version} em dist/`);
}
