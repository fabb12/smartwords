'use client';
// One floating tooltip for every element with a data-tip attribute: shown on hover after a short
// pause and right away on keyboard focus, kept inside the window, never clipped by scrolling panels.
import { useEffect, useRef, useState } from 'react';

type Tip = { text: string; x: number; y: number; below: boolean };

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), target = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const place = (el: HTMLElement) => {
      const text = el.dataset.tip; if (!text) return;
      const r = el.getBoundingClientRect(), below = r.top < 90;
      setTip({ text, x: Math.min(Math.max(r.left + r.width / 2, 130), window.innerWidth - 130), y: below ? r.bottom + 8 : r.top - 8, below });
    };
    const hide = () => { if (timer.current) clearTimeout(timer.current); target.current = null; setTip(null); };
    const show = (event: Event, delay: number) => {
      const el = (event.target as Element | null)?.closest?.<HTMLElement>('[data-tip]');
      if (!el) { if (event.type === 'pointerover') hide(); return; }
      if (el === target.current) return;
      hide(); target.current = el; timer.current = setTimeout(() => place(el), delay);
    };
    const over = (e: PointerEvent) => { if (e.pointerType !== 'touch') show(e, 450); };
    const focus = (e: FocusEvent) => { if ((e.target as Element).matches?.(':focus-visible')) show(e, 0); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    document.addEventListener('pointerover', over); document.addEventListener('focusin', focus); document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide, true); document.addEventListener('keydown', key); window.addEventListener('scroll', hide, true);
    return () => {
      hide(); document.removeEventListener('pointerover', over); document.removeEventListener('focusin', focus); document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide, true); document.removeEventListener('keydown', key); window.removeEventListener('scroll', hide, true);
    };
  }, []);
  if (!tip) return null;
  return <div className={'tooltip ' + (tip.below ? 'below' : 'above')} role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>;
}
