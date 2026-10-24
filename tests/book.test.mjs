import test from 'node:test';
import assert from 'node:assert/strict';
import { addToBook, chapterPath, includesInput } from '../lib/book.ts';

const main = String.raw`\begin{document}
\mainmatter
\input{content/intro}   % Introduzione
% \input{content/vecchio}
\backmatter
\printindex
\end{document}
`;

test('chapter paths reuse the remembered file and avoid names already taken', () => {
  assert.equal(chapterPath('L’età dell’oro', []), 'content/l-eta-dell-oro.tex');
  assert.equal(chapterPath('Intro', ['content/intro.tex', 'content/intro-2.tex']), 'content/intro-3.tex');
  assert.equal(chapterPath('Nuovo titolo', ['content/x.tex'], 'content/x.tex'), 'content/x.tex');
  assert.equal(chapterPath('???', []), 'content/capitolo.tex');
});

test('includesInput ignores commented lines and the .tex extension', () => {
  assert.ok(includesInput(main, 'content/intro.tex'));
  assert.ok(!includesInput(main, 'content/vecchio.tex'));
  assert.ok(!includesInput(main, 'content/in'));
});

test('addToBook inserts missing chapters before the back matter, under an optional part', () => {
  const next = addToBook(main, [{ path: 'content/intro.tex', title: 'Introduzione' }, { path: 'content/tesi.tex', title: 'La tesi' }, { path: 'content/tesi.tex', title: 'La tesi' }], 'Parte & prima');
  assert.equal(next.match(/content\/intro\}/g).length, 1);
  assert.equal(next.match(/content\/tesi\}/g).length, 1);
  assert.match(next, /\\part\{Parte \\& prima\}\n\\input\{content\/tesi\}   % La tesi\n\n\\backmatter/);
  assert.equal(addToBook(next, [{ path: 'content/tesi.tex', title: 'La tesi' }], 'Parte & prima'), next);
  assert.equal(addToBook(main, [{ path: 'content/intro.tex', title: 'x' }]), main);
});

test('addToBook appends at the end when main.tex has no markers', () => {
  assert.equal(addToBook('\\documentclass{book}\n', [{ path: 'content/a.tex', title: 'A' }]), '\\documentclass{book}\n\\input{content/a}   % A\n');
});

test('addToBook keeps a back-matter banner below the new chapters', () => {
  const next = addToBook('\\mainmatter\n\\input{a}\n\n% ===== BACK MATTER =====\n\\backmatter\n', [{ path: 'content/b.tex', title: 'B' }]);
  assert.equal(next, '\\mainmatter\n\\input{a}\n\n\\input{content/b}   % B\n\n% ===== BACK MATTER =====\n\\backmatter\n');
});
