/**
 * ZIP mínimo para o backup (SPEC 10): escrita sem compressão (fotos já são comprimidas) e leitura
 * de entradas "stored" e "deflate". A leitura valida caminhos (sem absolutos nem travessia),
 * quantidade de arquivos, tamanho descompactado total e CRC-32. ZIP64 não é aceito.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntryInput {
  path: string;
  data: Uint8Array;
}

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | (Math.floor(d.getSeconds() / 2) & 31),
    date: (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31),
  };
}

export function createZip(entries: ZipEntryInput[], now = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.path);
    const crc = crc32(e.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, e.data);
    centrals.push(central);
    offset += local.length + e.data.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

export interface ZipLimits {
  maxEntries: number;
  maxTotalUncompressed: number;
  maxEntryUncompressed: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 5000,
  maxTotalUncompressed: 250 * 1024 * 1024,
  maxEntryUncompressed: 50 * 1024 * 1024,
};

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

/** Caminho seguro: relativo, sem "..", sem barra invertida, sem drive, sem controle. */
export function isSafeZipPath(path: string): boolean {
  if (path.length === 0 || path.length > 255) return false;
  if (path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)) return false;
  for (let i = 0; i < path.length; i++) if (path.charCodeAt(i) < 0x20) return false;
  return path.split('/').every((seg) => seg !== '..' && seg !== '.' && seg !== '');
}

async function inflateRaw(data: Uint8Array, expected: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined')
    throw new ZipError('descompressão indisponível neste ambiente');
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > expected) {
      await reader.cancel();
      throw new ZipError('entrada maior que o declarado');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export async function readZip(
  bytes: Uint8Array,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw new ZipError('arquivo pequeno demais para ser um ZIP');
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('fim do diretório central não encontrado');
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError('ZIP64 não suportado');
  if (count > limits.maxEntries) throw new ZipError(`pacote com ${count} arquivos excede o limite`);
  if (cdOffset + cdSize > eocd) throw new ZipError('diretório central inválido');

  const dec = new TextDecoder('utf-8', { fatal: true });
  const out = new Map<string, Uint8Array>();
  let total = 0;
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50)
      throw new ZipError('entrada do diretório central inválida');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    let name: string;
    try {
      name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    } catch {
      throw new ZipError('nome de arquivo com codificação inválida');
    }
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 0x1) throw new ZipError('arquivos criptografados não são aceitos');
    if (name.endsWith('/')) continue; // diretório
    if (!isSafeZipPath(name)) throw new ZipError(`caminho inválido no pacote: ${name.slice(0, 80)}`);
    if (out.has(name)) throw new ZipError(`arquivo duplicado: ${name}`);
    if (size > limits.maxEntryUncompressed) throw new ZipError(`arquivo grande demais: ${name}`);
    total += size;
    if (total > limits.maxTotalUncompressed) throw new ZipError('tamanho descompactado excede o limite');
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50)
      throw new ZipError('cabeçalho local inválido');
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    if (dataStart + compSize > bytes.length) throw new ZipError('dados truncados');
    const raw = bytes.subarray(dataStart, dataStart + compSize);
    let data: Uint8Array;
    if (method === 0) {
      if (compSize !== size) throw new ZipError('tamanho inconsistente');
      data = raw.slice();
    } else if (method === 8) {
      data = await inflateRaw(raw, size);
      if (data.length !== size) throw new ZipError('tamanho descompactado inconsistente');
    } else {
      throw new ZipError(`método de compressão ${method} não suportado`);
    }
    if (crc32(data) !== crc) throw new ZipError(`CRC inválido: ${name}`);
    out.set(name, data);
  }
  return out;
}
