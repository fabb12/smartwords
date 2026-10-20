'use client';
import { useCallback, useLayoutEffect, useId, useRef, useState, type ReactNode, type ComponentPropsWithoutRef } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

// Native auto popovers provide outside-click/Escape dismissal and top-layer
// positioning, so expanded tools are not clipped by the scrolling toolbars.
export function CommandMenu({ label, icon: Icon, children, compact = false, triggerProps, onTriggerRef }: { label: string; icon?: LucideIcon; children: ReactNode; compact?: boolean; triggerProps?: ComponentPropsWithoutRef<'button'>; onTriggerRef?: (node: HTMLButtonElement | null) => void }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const place = useCallback(() => {
      const button = trigger.current, popup = panel.current; if (!button || !popup) return;
      const rect = button.getBoundingClientRect();
      const width = popup.offsetWidth || Math.min(245, innerWidth - 16);
      const height = popup.offsetHeight || Math.min(360, innerHeight - 16);
      const below = innerHeight - rect.bottom - 14, above = rect.top - 14;
      const flip = below < Math.min(height, 280) && above > below;
      popup.style.left = Math.max(8, Math.min(rect.left, innerWidth - width - 8)) + 'px';
      popup.style.maxHeight = Math.max(40, flip ? above : below) + 'px';
      popup.style.top = Math.max(8, Math.min(flip ? rect.top - height - 6 : rect.bottom + 6, innerHeight - height - 8)) + 'px';
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
    <button {...triggerProps} ref={node => { trigger.current = node; onTriggerRef?.(node); }} type="button" className={compact ? 'command-trigger toolbar-grip' : 'command-trigger'} popoverTarget={id} aria-label={label} data-tip={compact ? `${label}: trascina, premi Spazio per spostare con le frecce oppure Freccia giù per il menu` : label} aria-expanded={open} aria-controls={id} onMouseDown={e => e.preventDefault()} onKeyDown={e => { if (compact && e.key === 'ArrowDown' && !open && !triggerProps?.['aria-pressed']) { e.preventDefault(); panel.current?.showPopover(); panel.current?.querySelector<HTMLButtonElement>('button')?.focus(); } else triggerProps?.onKeyDown?.(e); }}>{Icon ? <Icon size={17}/> : label}{!compact&&<ChevronDown size={13}/>}</button>
    <div ref={panel} id={id} popover="auto" className="command-panel" aria-label={label} onBeforeToggle={e => { if ((e.nativeEvent as ToggleEvent).newState === 'open') place(); }} onToggle={e => setOpen((e.nativeEvent as ToggleEvent).newState === 'open')}
      onClick={e => { if ((e.target as HTMLElement).closest('button')) panel.current?.hidePopover(); }}
      onChange={e => { if (e.target instanceof HTMLInputElement && e.target.type === 'file') panel.current?.hidePopover(); }}>
      {children}
    </div>
  </div>;
}
