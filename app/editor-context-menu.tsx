'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

// Menu del tasto destro nell'editor. Si chiude con Esc, un clic fuori, lo scorrimento o il ridimensionamento;
// frecce su/giù per spostarsi, Invio per scegliere.
export type ContextItem = { label: string; hint?: string; icon: LucideIcon; action: () => void; disabled?: boolean } | 'separator';

export function EditorContextMenu({ x, y, items, onClose }: { x: number; y: number; items: ContextItem[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const node = box.current; if (!node) return;
    setAt({ left: Math.max(8, Math.min(x, innerWidth - node.offsetWidth - 8)), top: Math.max(8, Math.min(y, innerHeight - node.offsetHeight - 8)) });
    node.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [x, y]);
  useEffect(() => {
    const away = (event: Event) => { if (!box.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const buttons = Array.from(box.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []); if (!buttons.length) return;
      const now = buttons.indexOf(document.activeElement as HTMLButtonElement), step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(now + step + buttons.length) % buttons.length].focus();
    };
    document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', onClose, true); window.addEventListener('resize', onClose); window.addEventListener('blur', onClose);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key, true); window.removeEventListener('scroll', onClose, true); window.removeEventListener('resize', onClose); window.removeEventListener('blur', onClose); };
  }, [onClose]);
  return <div ref={box} className="context-menu" role="menu" aria-label="Azioni nel punto scelto" style={{ left: at.left, top: at.top }} onContextMenu={e => e.preventDefault()}>
    {items.map((item, i) => item === 'separator' ? <hr key={i} role="separator"/> :
      <button key={i} type="button" role="menuitem" disabled={item.disabled} title={item.hint} onClick={() => { onClose(); item.action(); }}>
        <item.icon size={16}/><span>{item.label}{item.hint&&<small>{item.hint}</small>}</span>
      </button>)}
    <p className="context-note">Maiusc + clic destro: menu del browser</p>
  </div>;
}
