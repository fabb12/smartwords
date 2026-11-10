import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Nelle barre laterali i gruppi di strumenti devono svilupparsi in verticale (prima restavano in riga).
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const SIDE = '.editor-dock:is([data-dock=left],[data-dock=right]) ';
const rules = (tail) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => m[1].trim() === (SIDE + tail)).map(m => m[2]).join(';');

test('i gruppi nelle barre laterali sono in colonna, con la maniglia in cima', () => {
  assert.match(rules('.tool-group'), /flex-direction:column/);
  assert.match(rules(':is(.tool-group-content,.tool-group-content>.toolbar-section)'), /flex-direction:column/);
  assert.match(rules(':is(.tool-group-content,.tool-group-content>.toolbar-section)'), /flex-wrap:nowrap/);
  assert.match(rules('.toolbar-grip svg'), /rotate\(90deg\)/);
});

test('in alto e in basso i gruppi restano in riga', () => {
  const base = [...css.matchAll(/\.tool-group-content\{([^}]*)\}/g)].map(m => m[1]).join(';');
  assert.match(base, /display:flex/); assert.doesNotMatch(base, /flex-direction:column/);
});
