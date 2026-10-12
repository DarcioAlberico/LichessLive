// Verificações de arquitetura (critério de passagem do M1):
// - domain não importa DOM, Chrome APIs, Preact ou camadas externas;
// - presentation não faz fetch diretamente nem usa chrome.*;
// - manifest com permissões mínimas (sem all_urls, cookies, debugger, webRequest, tabs, scripting).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const strip = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, "''");

for (const f of walk(resolve(root, 'src/domain'))) {
  const src = readFileSync(f, 'utf8');
  const rel = relative(root, f);
  for (const m of src.matchAll(/from '([^']+)'/g)) {
    const spec = m[1];
    if (spec === 'preact' || spec.startsWith('preact/')) errors.push(`${rel}: domain importa ${spec}`);
    if (
      /\/(adapters|presentation|persistence|studio|content|background|options|popup|application)\//.test(
        spec + '/',
      )
    )
      errors.push(`${rel}: domain importa ${spec}`);
  }
  const code = strip(src);
  for (const g of ['chrome.', 'document.', 'window.', 'fetch(', 'indexedDB', 'localStorage']) {
    if (code.includes(g)) errors.push(`${rel}: domain usa ${g}`);
  }
}

for (const f of walk(resolve(root, 'src/presentation'))) {
  const rel = relative(root, f);
  if (rel.endsWith('.generated.ts')) continue;
  const code = strip(readFileSync(f, 'utf8'));
  if (/\bfetch\(/.test(code)) errors.push(`${rel}: presentation faz fetch`);
  if (/\bchrome\./.test(code)) errors.push(`${rel}: presentation usa chrome.*`);
}

const manifest = JSON.parse(readFileSync(resolve(root, 'static/manifest.json'), 'utf8'));
const forbidden = ['<all_urls>', 'cookies', 'debugger', 'webRequest', 'tabs', 'scripting', 'downloads'];
for (const p of [...(manifest.permissions ?? []), ...(manifest.host_permissions ?? [])]) {
  if (forbidden.includes(p)) errors.push(`manifest: permissão não permitida ${p}`);
}
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(['https://lichess.org/*']))
  errors.push('manifest: host_permissions deve ser apenas https://lichess.org/*');
for (const cs of manifest.content_scripts ?? [])
  if (cs.all_frames) errors.push('manifest: all_frames deve ser false');

if (errors.length) {
  console.error('Fronteiras violadas:\n- ' + errors.join('\n- '));
  process.exit(1);
}
console.log('Fronteiras de arquitetura e permissões: ok');
