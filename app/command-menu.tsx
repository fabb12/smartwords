'use client';
import { useCallback, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

// Native auto popovers provide outside-click/Escape dismissal and top-layer
// positioning, so expanded tools are not clipped by the scrolling toolbars.
export function CommandMenu({ label, icon: Icon, children }: { label: string; icon?: LucideIcon; children: ReactNode }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const place = useCallback(() => {
      const button = trigger.current, popup = panel.current; if (!button || !popup) return;
      const rect = button.getBoundingClientRect();
      const width = popup.offsetWidth || Math.min(245, innerWidth - 16);
      popup.style.left = Math.max(8, Math.min(rect.left, innerWidth - width - 8)) + 'px';
      popup.style.top = Math.min(rect.bottom + 6, innerHeight - 48) + 'px';
      popup.style.maxHeight = Math.max(40, innerHeight - rect.bottom - 14) + 'px';
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); panel.current?.hidePopover(); trigger.current?.focus();
    };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    document.addEventListener('keydown', dismiss, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('keydown', dismiss, true); };
  }, [open, place]);
  return <div className="command-group">
    <button ref={trigger} type="button" className="command-trigger" popoverTarget={id} aria-label={label} data-tip={label} aria-expanded={open} aria-controls={id} onMouseDown={e => e.preventDefault()}>{Icon ? <Icon size={17}/> : label}<ChevronDown size={13}/></button>
    <div ref={panel} id={id} popover="auto" className="command-panel" aria-label={label} onBeforeToggle={e => { if ((e.nativeEvent as ToggleEvent).newState === 'open') place(); }} onToggle={e => setOpen((e.nativeEvent as ToggleEvent).newState === 'open')}
      onClick={e => { if ((e.target as HTMLElement).closest('button')) panel.current?.hidePopover(); }}
      onChange={e => { if (e.target instanceof HTMLInputElement && e.target.type === 'file') panel.current?.hidePopover(); }}>
      {children}
    </div>
  </div>;
}
