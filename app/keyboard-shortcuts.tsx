'use client';
import { X } from 'lucide-react';
export function KeyboardShortcuts({onClose}:{onClose:()=>void}) {
  return <div className="modal-backdrop" onClick={onClose}><section className="modal" role="dialog" aria-modal="true" aria-label="Scorciatoie da tastiera" onClick={e=>e.stopPropagation()}><button className="modal-close" aria-label="Chiudi scorciatoie" onClick={onClose}><X size={20}/></button><h2>Scorciatoie da tastiera</h2><p>Con il cursore nel documento. Su Mac usa ⌘ al posto di Ctrl.</p><dl className="keyboard-shortcuts">{[
    ['Maiusc + Tab','Formatta la selezione, oppure tutto il documento'],
    ['Ctrl + Maiusc + F','Formatta tutto il documento'],
    ['Ctrl + Alt + P','Formatta la pagina A4 corrente'],
    ['Ctrl + Invio','Chiedi una continuazione AI'],
    ['Ctrl + Maiusc + Invio','Migliora la selezione o la frase con AI'],
    ['Tab','Accetta la proposta; con attivazione su Tab, chiedi anche all’AI'],
    ['Esc','Annulla la richiesta o scarta la proposta'],
    ['Ctrl + S','Salva il documento'],
    ['Ctrl + F','Trova e sostituisci'],
    ['Ctrl + B / I / U','Grassetto / corsivo / sottolineato'],
    ['Ctrl + Alt + 1 / 2 / 3','Titolo / sottotitolo / titolo di terzo livello'],
    ['Ctrl + Alt + 0','Paragrafo normale'],
    ['Ctrl + Z','Annulla l’ultima modifica'],
    ['Ctrl + Maiusc + Z','Ripeti l’ultima modifica'],
    ['F1','Mostra queste scorciatoie'],
  ].map(([keys,label])=><div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{label}</dd></div>)}</dl><p>La formattazione propone un’anteprima da accettare. Nelle tabelle Maiusc+Tab passa alla cella precedente.</p></section></div>;
}
