import test from 'node:test';
import assert from 'node:assert/strict';
import { addGroup, assignDoc, forgetDoc, groupDocs, removeGroup, renameGroup, sanitizeGroups, toggleGroup, EMPTY_GROUPS } from '../lib/document-groups.ts';

test('groups hold documents and fall back to "no group" when removed', () => {
  let s = addGroup(EMPTY_GROUPS, '  Parte   prima ', 'g1');
  s = addGroup(s, '', 'g2');
  assert.deepEqual(s.groups, [{ id: 'g1', name: 'Parte prima' }]);
  s = assignDoc(s, 'a', 'g1');
  s = assignDoc(s, 'b', 'missing');
  assert.deepEqual(s.assign, { a: 'g1' });
  const docs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(groupDocs(docs, s).map(x => [x.group?.id ?? null, x.docs.map(d => d.id)]), [['g1', ['a']], [null, ['b', 'c']]]);
  s = renameGroup(toggleGroup(s, 'g1'), 'g1', 'Premesse');
  assert.deepEqual(s.groups, [{ id: 'g1', name: 'Premesse', collapsed: true }]);
  assert.deepEqual(toggleGroup(s, 'g1').groups, [{ id: 'g1', name: 'Premesse' }]);
  assert.deepEqual(forgetDoc(s, 'a').assign, {});
  assert.deepEqual(removeGroup(s, 'g1'), EMPTY_GROUPS);
  assert.deepEqual(assignDoc(assignDoc(s, 'a', 'g1'), 'a', '').assign, {});
});

test('stored groups are sanitised', () => {
  assert.deepEqual(sanitizeGroups(null), EMPTY_GROUPS);
  assert.deepEqual(sanitizeGroups({ groups: [{ id: 'g', name: 'A', collapsed: 'yes' }, { id: 'g', name: 'dup' }, { id: 1, name: 'x' }], assign: { a: 'g', b: 'zz', c: 3 } }),
    { groups: [{ id: 'g', name: 'A' }], assign: { a: 'g' } });
});
