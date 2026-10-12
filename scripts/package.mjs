// Empacota dist/ em release/lichess-team-studio-<versão>.zip (instalação ou envio à Chrome Web Store)
// e grava o SHA-256 do pacote. Recusa empacotar se encontrar mapas de fonte, segredos ou código remoto.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(dist).sort();
const problems = [];
for (const f of files) {
  const rel = relative(dist, f).replace(/\\/g, '/');
  if (rel.endsWith('.map')) problems.push(`mapa de fonte no pacote: ${rel}`);
  if (/\.(js|html|json)$/.test(rel)) {
    const text = readFileSync(f, 'utf8');
    if (/<script[^>]+src=["']https?:/i.test(text)) problems.push(`script remoto em ${rel}`);
    if (/\b(?:lip|lio)_[A-Za-z0-9]{16,}/.test(text)) problems.push(`possível token do Lichess em ${rel}`);
    if (/\beval\s*\(|new Function\s*\(/.test(text) && rel !== 'content.js' && rel.endsWith('.js')) {
      // Preact não usa eval; qualquer ocorrência deve ser revisada.
      problems.push(`uso de eval/new Function em ${rel}`);
    }
  }
}
if (problems.length) {
  console.error('Empacotamento recusado:\n- ' + problems.join('\n- '));
  process.exit(1);
}

const locals = [];
const centrals = [];
let offset = 0;
for (const f of files) {
  const name = Buffer.from(relative(dist, f).replace(/\\/g, '/'), 'utf8');
  const data = readFileSync(f);
  const comp = deflateRawSync(data, { level: 9 });
  const crc = crc32(data) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0x21, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0x21, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  locals.push(local, name, comp);
  centrals.push(central, name);
  offset += 30 + name.length + comp.length;
}
const cd = Buffer.concat(centrals);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(cd.length, 12);
eocd.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...locals, cd, eocd]);

mkdirSync(resolve(root, 'release'), { recursive: true });
const out = resolve(root, 'release', `lichess-team-studio-${pkg.version}.zip`);
writeFileSync(out, zip);
const sha = createHash('sha256').update(zip).digest('hex');
writeFileSync(`${out}.sha256`, `${sha}  ${relative(resolve(root, 'release'), out)}\n`);
console.log(
  `Pacote: ${relative(root, out)} (${(zip.length / 1024).toFixed(1)} KB, ${files.length} arquivos)\nSHA-256: ${sha}`,
);
