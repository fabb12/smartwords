import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOLBAR_IDS, defaultToolbarLayout, sanitizeToolbarLayout, moveToolbarGroup, toolbarLayoutKey, readToolbarLayout, storeToolbarLayout } from '../lib/toolbar-layout.ts';

test('every group survives malformed, duplicate and obsolete saved toolbar data', () => {
  for (const raw of [null, 4, 'bad', {}, { order: ['text','text','deleted'], positions: { text: { dock: 'floating', x: Infinity, y: -12 }, view: { dock: 'deleted' } } }]) {
    const layout = sanitizeToolbarLayout(raw);
    assert.equal(layout.order.length, TOOLBAR_IDS.length); assert.deepEqual([...layout.order].sort(), [...TOOLBAR_IDS].sort());
    assert.equal(layout.positions.view.dock, 'top');
    for (const position of Object.values(layout.positions)) { assert.ok(position.x >= 0 && position.x <= 1); assert.ok(position.y >= 0 && position.y <= 1); }
  }
});

test('group moves preserve hidden groups, support all docks, and do not mutate the previous layout', () => {
  const before = defaultToolbarLayout(), json = JSON.stringify(before);
  let layout = moveToolbarGroup(before, 'text', 'top', 'primary');
  assert.deepEqual(layout.order.slice(0,2), ['text','primary']);
  layout = moveToolbarGroup(layout, 'text', 'top', 'primary', true);
  assert.deepEqual(layout.order.slice(0,2), ['primary','text']);
  for (const dock of ['left','right','bottom','top','floating']) {
    layout = moveToolbarGroup(layout, 'text', dock, undefined, false, { x: .7, y: .6 });
    assert.equal(layout.positions.text.dock, dock); assert.equal(layout.positions.text.x, .7);
    assert.deepEqual(layout.order.filter(id => id !== 'text'), before.order.filter(id => id !== 'text'));
  }
  assert.equal(JSON.stringify(before), json); assert.equal(layout.order.length, TOOLBAR_IDS.length);
});

test('layout persistence separates users and fullscreen and recovers from unavailable storage', t => {
  const values = new Map(); globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value) };
  t.after(() => delete globalThis.localStorage);
  const normal = toolbarLayoutKey('alice', false), full = toolbarLayoutKey('alice', true), other = toolbarLayoutKey('bob', false);
  const layout = moveToolbarGroup(defaultToolbarLayout(), 'view', 'floating', undefined, false, { x: .8, y: .4 });
  storeToolbarLayout(normal, layout); assert.deepEqual(readToolbarLayout(normal), layout);
  assert.equal(readToolbarLayout(full).positions.view.dock, 'top'); assert.equal(readToolbarLayout(other).positions.view.dock, 'top');
  values.set(full, '{bad'); assert.deepEqual(readToolbarLayout(full), defaultToolbarLayout());
  globalThis.localStorage = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('full'); } };
  assert.doesNotThrow(() => storeToolbarLayout(normal, layout)); assert.deepEqual(readToolbarLayout(normal), defaultToolbarLayout());
});
