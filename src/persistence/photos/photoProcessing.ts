import type { PhotoCrop } from '../../domain/entities/profiles';
import { sha256Hex } from '../../shared/encoding';

/**
 * Cadastro de fotos (SPEC 10): PNG, JPEG ou WebP locais; assinatura, MIME, até 5 MB de entrada e
 * até 4096×4096. A imagem é decodificada e reexportada (remove metadados e conteúdo estranho) em
 * até 512×512, com meta de até 250 KB. SVG enviado pelo usuário não é aceito.
 */

export const PHOTO_LIMITS = {
  maxInputBytes: 5 * 1024 * 1024,
  maxDimension: 4096,
  outputSize: 512,
  targetBytes: 250 * 1024,
} as const;

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export function detectImageType(bytes: Uint8Array): ImageMime | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export type UploadValidation = { ok: true; mime: ImageMime } | { ok: false; error: string };

export function validateUpload(declaredMime: string, size: number, head: Uint8Array): UploadValidation {
  if (size > PHOTO_LIMITS.maxInputBytes) return { ok: false, error: 'Arquivo maior que 5 MB.' };
  if (size === 0) return { ok: false, error: 'Arquivo vazio.' };
  if (/svg/i.test(declaredMime)) return { ok: false, error: 'SVG não é aceito no cadastro de fotos.' };
  const detected = detectImageType(head);
  if (!detected) return { ok: false, error: 'Formato não reconhecido. Use PNG, JPEG ou WebP.' };
  const declared = declaredMime === 'image/jpg' ? 'image/jpeg' : declaredMime;
  if (declared && declared !== detected)
    return {
      ok: false,
      error: `Tipo declarado (${declaredMime}) não corresponde ao conteúdo (${detected}).`,
    };
  return { ok: true, mime: detected };
}

export function validateDimensions(width: number, height: number): string | null {
  if (width < 16 || height < 16) return 'Imagem pequena demais (mínimo 16×16).';
  if (width > PHOTO_LIMITS.maxDimension || height > PHOTO_LIMITS.maxDimension)
    return 'Imagem maior que 4096×4096.';
  return null;
}

/** Corte quadrado padrão: centralizado, lado = menor dimensão. */
export function defaultCrop(width: number, height: number): PhotoCrop {
  const side = Math.min(width, height);
  return {
    x: (width - side) / 2 / width,
    y: (height - side) / 2 / height,
    size: side / Math.max(width, height),
  };
}

/** Converte o corte normalizado em pixels, limitado à imagem (nunca estica). */
export function cropToPixels(
  crop: PhotoCrop,
  width: number,
  height: number,
): { sx: number; sy: number; side: number } {
  const maxSide = Math.min(width, height);
  const side = Math.max(16, Math.min(maxSide, Math.round(crop.size * Math.max(width, height))));
  const sx = Math.min(Math.max(0, Math.round(crop.x * width)), width - side);
  const sy = Math.min(Math.max(0, Math.round(crop.y * height)), height - side);
  return { sx, sy, side };
}

export interface ProcessedPhoto {
  blob: Blob;
  width: number;
  height: number;
  mime: string;
  hash: string;
}

/** Recorta e reexporta a imagem decodificada em até 512×512, buscando até 250 KB. */
export async function renderPhoto(bitmap: ImageBitmap, crop: PhotoCrop): Promise<ProcessedPhoto> {
  const { sx, sy, side } = cropToPixels(crop, bitmap.width, bitmap.height);
  const out = Math.min(PHOTO_LIMITS.outputSize, side);
  const canvas = new OffscreenCanvas(out, out);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
  let blob: Blob | null = null;
  for (const quality of [0.9, 0.82, 0.74, 0.65, 0.55, 0.45]) {
    blob = await canvas.convertToBlob({ type: 'image/webp', quality });
    if (blob.type !== 'image/webp') blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    if (blob.size <= PHOTO_LIMITS.targetBytes) break;
  }
  if (!blob) throw new Error('Falha ao codificar a imagem');
  const hash = await sha256Hex(await blob.arrayBuffer());
  return { blob, width: out, height: out, mime: blob.type, hash };
}
