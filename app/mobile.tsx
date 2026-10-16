'use client';
// Simplified mode for phones: big touch targets, a bottom toolbar above the keyboard,
// panels as bottom sheets, and help to install the app (PWA) where the browser has no prompt.
import { useEffect, useState, type ReactNode } from 'react';
import { Share, SquarePlus, EllipsisVertical, X } from 'lucide-react';

const NARROW = '(max-width: 720px)';

// Phone-sized screen; the simplified mode is on by default there and can be switched off.
export function useSimpleMode(): [narrow: boolean, simple: boolean, setSimple: (on: boolean) => void] {
  const [narrow, setNarrow] = useState(false), [pref, setPref] = useState(() => {
    try { return typeof localStorage === 'undefined' || localStorage.getItem('scrivia:simple') !== '0'; } catch { return true; }
  });
  useEffect(() => {
    const media = window.matchMedia(NARROW), apply = () => setNarrow(media.matches);
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  const setSimple = (on: boolean) => { setPref(on); try { localStorage.setItem('scrivia:simple', on ? '1' : '0'); } catch { /* not remembered */ } };
  return [narrow, narrow && pref, setSimple];
}

// The page height follows the visible area, so the bottom toolbar stays above the
// on-screen keyboard (iOS does not shrink the page when the keyboard opens).
export function useVisibleHeight(on: boolean) {
  useEffect(() => {
    const vv = window.visualViewport, root = document.documentElement;
    if (!on || !vv) return;
    const apply = () => { root.style.setProperty('--app-height', vv.height + 'px'); if (vv.offsetTop) window.scrollTo(0, 0); };
    apply(); vv.addEventListener('resize', apply); vv.addEventListener('scroll', apply);
    return () => { vv.removeEventListener('resize', apply); vv.removeEventListener('scroll', apply); root.style.removeProperty('--app-height'); };
  }, [on]);
}

// Already opened as an installed app (home screen icon).
export function useStandalone(): boolean {
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)');
    const apply = () => setStandalone(media.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  return standalone;
}

const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

export function Sheet({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [onClose]);
  return <div className="sheet-backdrop" onClick={onClose}>
    <section className={'sheet ' + className} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
      <span className="sheet-grip" aria-hidden="true" />
      <header><h2>{title}</h2><button className="sheet-close" aria-label="Chiudi" onClick={onClose}><X size={22} /></button></header>
      <div className="sheet-body">{children}</div>
    </section>
  </div>;
}

// Steps for browsers that cannot show the install prompt themselves (Safari on iPhone/iPad, Firefox…).
export function InstallSteps() {
  const ios = isIOS();
  return <div className="install-steps">
    <p>Scrivia si aggiunge alla schermata Home come un’app: si apre a tutto schermo, con la sua icona, e funziona anche senza rete.</p>
    <ol>
      {ios ? <>
        <li><span className="step-icon"><Share size={20} /></span><span>Tocca <strong>Condividi</strong> nella barra di Safari (in basso o in alto).</span></li>
        <li><span className="step-icon"><SquarePlus size={20} /></span><span>Scorri e scegli <strong>Aggiungi alla schermata Home</strong>.</span></li>
        <li><span className="step-icon">✓</span><span>Tocca <strong>Aggiungi</strong>: l’icona di Scrivia compare tra le tue app.</span></li>
      </> : <>
        <li><span className="step-icon"><EllipsisVertical size={20} /></span><span>Apri il <strong>menu del browser</strong> (⋮ in alto a destra).</span></li>
        <li><span className="step-icon"><SquarePlus size={20} /></span><span>Scegli <strong>Installa app</strong> oppure <strong>Aggiungi a schermata Home</strong>.</span></li>
        <li><span className="step-icon">✓</span><span>Conferma: l’icona di Scrivia compare tra le tue app.</span></li>
      </>}
    </ol>
    {ios && <p className="install-note">Su iPhone e iPad l’installazione funziona solo da Safari.</p>}
  </div>;
}
