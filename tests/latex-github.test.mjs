import test from 'node:test';
import assert from 'node:assert/strict';
import { commitFiles, connectLatex, dispatchPdf, disconnectLatex, latestPdf, latexConnected, LatexConflict, listFiles, readText, writeText } from '../lib/latex-github.ts';

function storage() { const v = new Map(); return { getItem: k => v.get(k) ?? null, setItem: (k, x) => v.set(k, String(x)), removeItem: k => v.delete(k) }; }
const settings = { repository: 'writer/book', branch: 'main', main: 'main.tex', remember: true };

function mock(t) {
  const original = globalThis.fetch;
  const files = new Map([['main.tex', { text: '\\input{content/a}', sha: 's1' }]]);
  const log = [];
  let n = 1;
  const json = (d, status = 200) => Response.json(d, { status });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET', path = u.pathname.replace('/repos/writer/book', '');
    log.push(method + ' ' + path);
    assert.equal(init.headers.Authorization, 'Bearer tok');
    if (path === '') return json({ private: true, default_branch: 'main' });
    if (path === '/git/trees/main') return json({ truncated: false, tree: [...files].map(([p, f]) => ({ path: p, type: 'blob', sha: f.sha, size: f.text.length })).concat([{ path: 'content', type: 'tree', sha: 'd' }]) });
    if (path.startsWith('/contents/')) {
      const p = decodeURIComponent(path.slice(10));
      if (method === 'GET') { const f = files.get(p); return f ? json({ sha: f.sha, encoding: 'base64', content: Buffer.from(f.text).toString('base64') }) : json({}, 404); }
      const body = JSON.parse(init.body);
      const cur = files.get(p);
      if (cur && body.sha !== cur.sha) return json({ message: 'conflict' }, 409);
      const sha = 's' + (++n);
      files.set(p, { text: Buffer.from(body.content, 'base64').toString('utf8'), sha });
      return json({ content: { sha } });
    }
    if (path === '/git/ref/heads/main') return json({ object: { sha: 'c1' } });
    if (path === '/git/commits/c1') return json({ tree: { sha: 't1' } });
    if (path === '/git/trees' && method === 'POST') { const b = JSON.parse(init.body); assert.equal(b.base_tree, 't1'); for (const e of b.tree) files.set(e.path, { text: e.content, sha: 's' + (++n) }); return json({ sha: 't2' }); }
    if (path === '/git/commits' && method === 'POST') { assert.deepEqual(JSON.parse(init.body).parents, ['c1']); return json({ sha: 'c2' }); }
    if (path === '/git/refs/heads/main' && method === 'PATCH') return json({ ref: 'main' });
    if (path === '/actions/workflows/build-pdf.yml/dispatches') { assert.deepEqual(JSON.parse(init.body), { ref: 'main', inputs: { mode: 'bozza' } }); return new Response(null, { status: 204 }); }
    if (path === '/releases/tags/pdf-finale') return json({ assets: [{ name: 'libro-finale.pdf', url: 'https://api.github.com/x', browser_download_url: 'https://github.com/x.pdf', updated_at: '2026-10-01T10:00:00Z' }] });
    if (path === '/releases/tags/pdf-bozza') return json({}, 404);
    return json({ message: 'unexpected ' + path }, 500);
  };
  t.after(() => { globalThis.fetch = original; });
  return { files, log };
}

test('connects, lists, reads, writes and detects conflicts', async t => {
  globalThis.localStorage = storage();
  const gh = mock(t);
  await connectLatex(settings, 'tok');
  assert.ok(latexConnected());
  assert.deepEqual((await listFiles()).map(f => f.path), ['main.tex']);
  const main = await readText('main.tex');
  assert.equal(main.text, '\\input{content/a}');
  const sha = await writeText('main.tex', 'nuovo è', main.sha, 'msg');
  assert.equal(gh.files.get('main.tex').text, 'nuovo è');
  await assert.rejects(writeText('main.tex', 'vecchio', main.sha, 'msg'), LatexConflict);
  await writeText('main.tex', 'ok', sha, 'msg');
  await commitFiles([{ path: 'content/a.tex', content: '\\chapter{A}' }, { path: 'main.tex', content: 'x' }], 'modello');
  assert.equal(gh.files.get('content/a.tex').text, '\\chapter{A}');
  assert.ok(gh.log.includes('PATCH /git/refs/heads/main'));
  await dispatchPdf('bozza');
  assert.equal((await latestPdf('finale')).name, 'libro-finale.pdf');
  assert.equal(await latestPdf('bozza'), null);
  disconnectLatex();
  assert.equal(localStorage.getItem('scrivia:latex-token'), null);
});

test('rejects invalid settings before contacting GitHub', async () => {
  globalThis.localStorage = storage();
  await assert.rejects(connectLatex({ ...settings, repository: 'nope' }, 'tok'), /proprietario\/nome/);
  await assert.rejects(connectLatex({ ...settings, main: '../x.tex' }, 'tok'), /file principale/);
  await assert.rejects(connectLatex(settings, ''), /token/);
});
