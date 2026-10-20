'use client';
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { FormatReplacement } from '../lib/format-only';
import { AiFormatPreview } from './ai-format-preview';

export function AiBatchFormatPreview({ parts }: { parts: FormatReplacement[] }) {
  const [index, setIndex] = useState(0), current = Math.min(index, parts.length - 1);
  return <section className="format-batch-preview">
    <div className="format-batch-navigation" role="group" aria-label="Passaggi formattati">
      <button aria-label="Passaggio precedente" disabled={current === 0} onClick={() => setIndex(current - 1)}><ChevronLeft size={16}/></button>
      <span>Passaggio {current + 1} di {parts.length}</span>
      <button aria-label="Passaggio successivo" disabled={current === parts.length - 1} onClick={() => setIndex(current + 1)}><ChevronRight size={16}/></button>
    </div>
    <p className="format-batch-note">Solo formattazione: parole e punteggiatura originali. Accetta applica tutti i passaggi.</p>
    <AiFormatPreview content={parts[current].content}/>
  </section>;
}
