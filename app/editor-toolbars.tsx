'use client';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, PointerSensor, pointerWithin, rectIntersection, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { GripVertical } from 'lucide-react';
import { CommandMenu } from './command-menu';
import { DOCK_SIDES, defaultToolbarLayout, isDockSide, isToolbarId, moveToolbarGroup, readToolbarLayout, storeToolbarLayout, toolbarLayoutKey, type DockSide, type ToolbarId, type ToolbarLayout, type ToolbarPlace, type ToolbarPosition } from '../lib/toolbar-layout';

export type EditorToolbarGroup = { id: ToolbarId; label: string; content: ReactNode };
const SIDE_NAMES: Record<DockSide, string> = { top: 'In alto', bottom: 'In basso', left: 'A sinistra', right: 'A destra' };
// Outside a dock there is deliberately no nearest-target fallback: dropping in
// the document creates a floating palette rather than snapping to a distant bar.
const collisions: CollisionDetection = args => {
  const hits = args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args);
  const groups = hits.filter(hit => isToolbarId(hit.id));
  return groups.length ? groups : hits;
};

function ToolGroup({ group, position, onPlace, onOrder }: { group: EditorToolbarGroup; position: ToolbarPosition; onPlace: (place: ToolbarPlace) => void; onOrder: (after: boolean) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isOver, isDragging } = useSortable({ id: group.id, data: { dock: position.dock } });
  const frame = useRef<HTMLDivElement>(null), [size, setSize] = useState({ width: 220, height: 50 });
  useEffect(() => {
    if (position.dock !== 'floating' || !frame.current) return;
    const observer = new ResizeObserver(entries => { const box = entries[0].borderBoxSize[0]; if (box) setSize({ width: box.inlineSize, height: box.blockSize }); });
    observer.observe(frame.current); return () => observer.disconnect();
  }, [position.dock]);
  const style: CSSProperties = position.dock === 'floating'
    ? { left: `clamp(8px, ${position.x * 100}%, calc(100% - ${size.width + 8}px))`, top: `clamp(8px, ${position.y * 100}%, calc(100% - ${size.height + 8}px))` }
    : {};
  return <div ref={node => { setNodeRef(node); frame.current = node; }} data-tool-group={group.id} data-floating={position.dock === 'floating' || undefined} className={'tool-group' + (position.dock === 'floating' ? ' tool-palette formatbar' : '') + (isDragging ? ' is-dragging' : '') + (isOver && !isDragging ? ' is-drop-target' : '')} style={style} role="toolbar" aria-label={group.label}>
    <CommandMenu label={`Sposta gruppo ${group.label}`} icon={GripVertical} compact onTriggerRef={setActivatorNodeRef} triggerProps={{ ...attributes, ...listeners }}>
      {DOCK_SIDES.map(side => <button key={side} onClick={() => onPlace(side)}>{SIDE_NAMES[side]}</button>)}
      <button onClick={() => onPlace('floating')}>Flottante</button>
      <button onClick={() => onOrder(false)}>Sposta prima</button><button onClick={() => onOrder(true)}>Sposta dopo</button>
    </CommandMenu>
    <div className="tool-group-content">{group.content}</div>
  </div>;
}

function Dock({ side, groups, render }: { side: DockSide; groups: EditorToolbarGroup[]; render: (group: EditorToolbarGroup) => ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `dock:${side}` });
  return <nav ref={setNodeRef} className={`editor-dock icon-menu formatbar ${side === 'top' ? 'menu-bar' : ''} ${isOver ? 'dock-over' : ''}`} data-dock={side} data-empty={!groups.length || undefined} aria-label={side === 'top' ? 'Menu documento' : `Strumenti ${SIDE_NAMES[side].toLowerCase()}`}>
    <SortableContext items={groups.map(group => group.id)} strategy={rectSortingStrategy}>
      {groups.map(render)}
    </SortableContext>
    {!groups.length&&<span className="dock-hint">{SIDE_NAMES[side]}</span>}
  </nav>;
}

export function EditorToolbars({ groups, owner, fullscreen, disabled, resetToken, children }: { groups: EditorToolbarGroup[]; owner: string; fullscreen: boolean; disabled: boolean; resetToken: number; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null), key = toolbarLayoutKey(owner, fullscreen);
  const [saved, setSaved] = useState<{ key: string; layout: ToolbarLayout }>({ key: '', layout: defaultToolbarLayout() });
  const [active, setActive] = useState<ToolbarId | null>(null);
  const previousReset = useRef(resetToken);
  const layout = saved.key === key ? saved.layout : defaultToolbarLayout();
  useEffect(() => {
    const reset = previousReset.current !== resetToken; previousReset.current = resetToken;
    const restore = setTimeout(() => { const next = reset ? defaultToolbarLayout() : readToolbarLayout(key); if (reset) storeToolbarLayout(key, next); setSaved({ key, layout: next }); setActive(null); }, 0);
    return () => clearTimeout(restore);
  }, [key, resetToken]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  function change(next: ToolbarLayout) { setSaved({ key, layout: next }); storeToolbarLayout(key, next); }
  function place(id: ToolbarId, dock: ToolbarPlace) { change(moveToolbarGroup(layout, id, dock)); }
  function order(id: ToolbarId, after: boolean) {
    const siblings = layout.order.filter(other => layout.positions[other].dock === layout.positions[id].dock && groups.some(group => group.id === other));
    const over = siblings[siblings.indexOf(id) + (after ? 1 : -1)];
    if (over) change(moveToolbarGroup(layout, id, layout.positions[id].dock, over, after));
  }
  function drop(event: DragEndEvent) {
    setActive(null); const id = event.active.id; if (!isToolbarId(id)) return;
    const over = event.over, target = over && isToolbarId(over.id) ? over.id : undefined;
    const side = target ? layout.positions[target].dock : over?.id.toString().replace('dock:', '');
    if (isDockSide(side)) {
      const translated = event.active.rect.current.translated;
      const vertical = side === 'left' || side === 'right';
      const after = event.activatorEvent instanceof KeyboardEvent && target
        ? layout.order.indexOf(target) > layout.order.indexOf(id)
        : !!(over && translated && (vertical ? translated.top + translated.height / 2 >= over.rect.top + over.rect.height / 2 : translated.left + translated.width / 2 >= over.rect.left + over.rect.width / 2));
      change(moveToolbarGroup(layout, id, side, target, after));
    } else {
      const box = root.current?.getBoundingClientRect(), translated = event.active.rect.current.translated;
      if (box && translated) change(moveToolbarGroup(layout, id, 'floating', undefined, false, { x: (translated.left - box.left) / box.width, y: (translated.top - box.top) / box.height }));
    }
  }
  const visible = disabled ? [] : groups;
  const floating = visible.filter(group => layout.positions[group.id].dock === 'floating').sort((a,b) => layout.order.indexOf(a.id) - layout.order.indexOf(b.id));
  const render = (group: EditorToolbarGroup) => <ToolGroup key={group.id} group={group} position={layout.positions[group.id]} onPlace={dock => place(group.id, dock)} onOrder={after => order(group.id, after)}/>;
  return <DndContext sensors={sensors} collisionDetection={collisions} measuring={{ droppable: { strategy: MeasuringStrategy.Always } }} onDragStart={event => { if (isToolbarId(event.active.id)) setActive(event.active.id); }} onDragCancel={() => setActive(null)} onDragEnd={drop}
    accessibility={{ screenReaderInstructions: { draggable: 'Premi Spazio per prendere il gruppo, usa le frecce per spostarlo e premi Spazio per rilasciarlo. Esc annulla. Freccia giù, prima di prenderlo, apre il menu di posizionamento.' }, announcements: { onDragStart: () => 'Gruppo preso. Scegli una posizione.', onDragOver: event => event.over ? 'Posizione disponibile.' : 'Rilascia per una barra flottante.', onDragEnd: () => 'Gruppo posizionato.', onDragCancel: () => 'Spostamento annullato.' } }}>
    <div ref={root} className={'editor-toolbars-layout' + (active ? ' is-rearranging' : '') + (disabled ? ' toolbars-disabled' : '')} aria-label="Area di scrittura e strumenti">
      {DOCK_SIDES.map(side => <Dock key={side} side={side} groups={visible.filter(group => layout.positions[group.id].dock === side).sort((a,b) => layout.order.indexOf(a.id) - layout.order.indexOf(b.id))} render={render}/>)}
      <div className="editor-dock-content">{children}</div>
      <SortableContext items={floating.map(group => group.id)} strategy={rectSortingStrategy}>
        {floating.map(render)}
      </SortableContext>
      <DragOverlay dropAnimation={null}>{active&&<div className="tool-drag-preview"><GripVertical size={15}/>{groups.find(group => group.id === active)?.label}</div>}</DragOverlay>
    </div>
  </DndContext>;
}
