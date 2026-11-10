import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Il PDF si ottiene dalla stampa del browser: nelle viste a più pagine il testo era impaginato a colonne più larghe
// del foglio A4 e le colonne oltre la prima venivano tagliate (metà del documento mancava nel PDF).
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const printBlocks = [...css.matchAll(/@media print\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map(m => m[1]);
const rule = (selector) => printBlocks.flatMap(b => [...b.matchAll(/([^{}]+)\{([^{}]*)\}/g)]).filter(m => m[1].split(',').map(s => s.trim()).includes(selector)).map(m => m[2]).join(';');

test('in stampa la vista a più pagine non usa colonne né la larghezza della griglia', () => {
  const grid = rule('.page-grid .manuscript');
  for (const declaration of ['width:auto', 'height:auto', 'min-height:0', 'column-count:auto', 'column-wrap:nowrap', 'column-height:auto']) assert.ok(grid.includes(declaration), declaration);
});

test('in stampa le pagine sono bianche anche in tema scuro', () => {
  assert.match(rule(':root[data-theme=dark] .paged .canvas'), /background:#fff!important/);
  assert.match(rule(':root[data-theme=dark]'), /color-scheme:light/);
});
