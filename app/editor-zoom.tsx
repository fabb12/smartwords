'use client';
import { Minus, Plus } from 'lucide-react';
import { ZOOM_MIN, ZOOM_MAX, type EditorZoom } from '../lib/editor-zoom';

export function ZoomControls({ value, percent, onChange }: { value: EditorZoom; percent: number; onChange: (value: EditorZoom) => void }) {
  const presets = [25, 50, 75, 100, 125, 150, 200, 250];
  const options = typeof value === 'number' && !presets.includes(value) ? [...presets, value].sort((a,b) => a-b) : presets;
  return <div className="editor-zoom" role="group" aria-label="Zoom della pagina">
    <button type="button" aria-label="Riduci zoom" disabled={percent <= ZOOM_MIN} onMouseDown={e => e.preventDefault()} onClick={() => onChange(Math.max(ZOOM_MIN, percent - 10))}><Minus size={14}/></button>
    <select aria-label="Zoom pagina" value={String(value)} onChange={e => onChange(e.target.value === 'page' || e.target.value === 'width' ? e.target.value : Number(e.target.value))}>
      <option value="page">Pagina intera{value === 'page' ? ` · ${percent}%` : ''}</option><option value="width">Larghezza pagina{value === 'width' ? ` · ${percent}%` : ''}</option>
      {options.map(n => <option key={n} value={n}>{n}%</option>)}
    </select>
    <button type="button" aria-label="Aumenta zoom" disabled={percent >= ZOOM_MAX} onMouseDown={e => e.preventDefault()} onClick={() => onChange(Math.min(ZOOM_MAX, percent + 10))}><Plus size={14}/></button>
  </div>;
}
