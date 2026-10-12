import { useEffect, useRef, useState } from 'preact/hooks';
import type { PhotoCrop } from '../domain/entities/profiles';
import { cropToPixels, defaultCrop } from '../persistence/photos/photoProcessing';

/**
 * Corte quadrado com posicionamento do rosto: arraste o quadro para mover, use o controle de
 * tamanho para aproximar. A imagem nunca é esticada; a prévia mostra o recorte final em círculo.
 */
export function PhotoEditor({
  bitmap,
  initial,
  onChange,
}: {
  bitmap: ImageBitmap;
  initial: PhotoCrop | null;
  onChange: (c: PhotoCrop) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [crop, setCrop] = useState<PhotoCrop>(initial ?? defaultCrop(bitmap.width, bitmap.height));
  const drag = useRef<{ x: number; y: number; crop: PhotoCrop } | null>(null);
  const W = 360;
  const scale = W / Math.max(bitmap.width, bitmap.height);
  const cw = Math.round(bitmap.width * scale);
  const ch = Math.round(bitmap.height * scale);

  useEffect(() => onChange(crop), [crop]);

  useEffect(() => {
    const c = canvasRef.current;
    const p = previewRef.current;
    if (!c || !p) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(bitmap, 0, 0, cw, ch);
    const { sx, sy, side } = cropToPixels(crop, bitmap.width, bitmap.height);
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.rect(sx * scale, sy * scale, side * scale, side * scale);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#6CB4FF';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx * scale, sy * scale, side * scale, side * scale);
    const pctx = p.getContext('2d')!;
    pctx.clearRect(0, 0, 128, 128);
    pctx.save();
    pctx.beginPath();
    pctx.arc(64, 64, 64, 0, Math.PI * 2);
    pctx.clip();
    pctx.drawImage(bitmap, sx, sy, side, side, 0, 0, 128, 128);
    pctx.restore();
  }, [crop, bitmap]);

  const maxSize = Math.min(bitmap.width, bitmap.height) / Math.max(bitmap.width, bitmap.height);
  const move = (dx: number, dy: number, base: PhotoCrop) => {
    const nx = base.x + dx / cw;
    const ny = base.y + dy / ch;
    const sizeW = (base.size * Math.max(bitmap.width, bitmap.height)) / bitmap.width;
    const sizeH = (base.size * Math.max(bitmap.width, bitmap.height)) / bitmap.height;
    setCrop({ ...base, x: Math.min(Math.max(0, nx), 1 - sizeW), y: Math.min(Math.max(0, ny), 1 - sizeH) });
  };

  return (
    <div class="photo-editor">
      <canvas
        ref={canvasRef}
        width={cw}
        height={ch}
        class="crop-canvas"
        aria-label="Área de recorte: arraste para posicionar o rosto; use as setas do teclado"
        tabIndex={0}
        onPointerDown={(e) => {
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, crop };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          move(e.clientX - drag.current.x, e.clientY - drag.current.y, drag.current.crop);
        }}
        onPointerUp={() => (drag.current = null)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 2;
          const d: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          };
          const v = d[e.key];
          if (v) {
            e.preventDefault();
            move(v[0], v[1], crop);
          }
        }}
      />
      <div class="photo-side">
        <canvas ref={previewRef} width={128} height={128} class="crop-preview" aria-label="Prévia" />
        <label>
          Aproximação
          <input
            type="range"
            min={0.1}
            max={maxSize}
            step={0.005}
            value={crop.size}
            onInput={(e) => {
              const size = Number((e.target as HTMLInputElement).value);
              const centerX = crop.x + (crop.size * Math.max(bitmap.width, bitmap.height)) / bitmap.width / 2;
              const centerY =
                crop.y + (crop.size * Math.max(bitmap.width, bitmap.height)) / bitmap.height / 2;
              const sizeW = (size * Math.max(bitmap.width, bitmap.height)) / bitmap.width;
              const sizeH = (size * Math.max(bitmap.width, bitmap.height)) / bitmap.height;
              setCrop({
                size,
                x: Math.min(Math.max(0, centerX - sizeW / 2), 1 - sizeW),
                y: Math.min(Math.max(0, centerY - sizeH / 2), 1 - sizeH),
              });
            }}
          />
        </label>
      </div>
    </div>
  );
}
