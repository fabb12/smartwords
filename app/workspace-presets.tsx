'use client';
import { useState } from 'react';
import { Check, Save, Trash2, X } from 'lucide-react';
import { BUILTIN_WORKSPACES, type WorkspacePreset } from '../lib/workspace-presets';

export function WorkspacePresets({ presets, onApply, onSave, onDelete, onClose }: { presets: WorkspacePreset[]; onApply: (preset: WorkspacePreset) => void; onSave: (name: string) => string; onDelete: (id: string) => void; onClose: () => void }) {
  const [name, setName] = useState(''), [error, setError] = useState('');
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className="modal workspace-presets-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-presets-title" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
    <button className="modal-close" aria-label="Chiudi preset" onClick={onClose}><X size={20}/></button>
    <h2 id="workspace-presets-title">Area di lavoro</h2>
    <p className="form-note">Scegli gli strumenti per quello che stai facendo. Il testo del documento resta invariato.</p>
    <div className="workspace-preset-grid">{BUILTIN_WORKSPACES.map(preset => <button key={preset.id} onClick={() => { onApply(preset); onClose(); }}><strong>{preset.name}</strong><span>{preset.description}</span></button>)}</div>
    <h3>Le tue disposizioni</h3>
    {presets.map(preset => <div className="workspace-preset-row" key={preset.id}><button onClick={() => { onApply(preset); onClose(); }}><Check size={15}/>{preset.name}</button><button aria-label={`Elimina preset ${preset.name}`} onClick={() => onDelete(preset.id)}><Trash2 size={16}/></button></div>)}
    {!presets.length&&<p className="form-note">Salva pannelli, gruppi trascinati, vista e zoom per ritrovarli con un clic.</p>}
    <form onSubmit={e => { e.preventDefault(); const message = onSave(name); setError(message); if (!message) setName(''); }}>
      <label>Nome della disposizione<input value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="Es. Revisione del romanzo"/></label>
      <button className="primary" disabled={!name.trim() || presets.length >= 20}><Save size={16}/>Salva disposizione corrente</button>
      {presets.length >= 20&&<p className="form-note">Hai raggiunto 20 disposizioni: eliminane una per salvarne un’altra.</p>}
      {error&&<p className="warning" role="alert">{error}</p>}
    </form>
  </section></div>;
}
