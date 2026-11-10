'use client';
import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { imageSizeAt, imageSizeForWidth, pageShare } from '../lib/editor-images';

// Size controls for the selected image: ready-made shares of the page width or an exact width.
// The corners of the image can also be dragged; the proportions are always kept.
const SHARES = [25, 50, 75, 100];

export function ImageSizeBar({ editor }: { editor: Editor }) {
  const attrs = editor.getAttributes('image') as { width?: number | string; height?: number | string };
  const width = Number(attrs.width) || 0, height = Number(attrs.height) || 0;
  if (!width || !height) return null;
  const apply = (size: { width: number; height: number }) => { editor.chain().focus().updateAttributes('image', size).run(); };
  const share = pageShare(width);
  return <div className="table-actions image-actions" role="group" aria-label="Dimensione immagine">
    <strong>Immagine</strong>
    {SHARES.map(s => <button key={s} type="button" className={Math.abs(share - s) <= 2 ? 'active' : ''} aria-pressed={Math.abs(share - s) <= 2}
      data-tip={s === 100 ? 'Larghezza piena della pagina, senza superare l’altezza' : `${s}% della larghezza della pagina`} onMouseDown={e => e.preventDefault()}
      onClick={() => apply(imageSizeAt(width, height, s / 100))}>{s}%</button>)}
    <WidthField key={width} width={width} onApply={n => apply(imageSizeForWidth(width, height, n))} />
    <span className="form-note">Trascina gli angoli per ridimensionare. «Sistema formattazione» adatta la dimensione e scrive la didascalia.</span>
  </div>;
}

// Exact width in pixels; the field restarts from the real width each time the image changes size.
function WidthField({ width, onApply }: { width: number; onApply: (width: number) => void }) {
  const [typed, setTyped] = useState(String(width));
  return <label>Larghezza <input type="number" min={40} max={2000} aria-label="Larghezza dell’immagine in pixel" value={typed} onChange={e => setTyped(e.target.value)}
    onBlur={() => { const n = Number(typed); if (Number.isFinite(n) && n > 0 && Math.round(n) !== width) onApply(n); else setTyped(String(width)); }}
    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /> px</label>;
}
