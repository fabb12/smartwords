import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_WORKSPACES, DEFAULT_WORKSPACE_FRAME, sanitizeWorkspaceFrame, readWorkspacePresets, storeWorkspacePresets, readWorkspaceFrame, storeWorkspaceFrame, workspaceFrameKey, workspacePresetsKey } from '../lib/workspace-presets.ts';
import { moveToolbarGroup } from '../lib/toolbar-layout.ts';

function storage(t) { const values = new Map(); globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value) }; t.after(() => delete globalThis.localStorage); return values; }
test('workspace presets cover writing, review, layout and the complete interface without content data', () => {
  assert.equal(BUILTIN_WORKSPACES.length,4);
  const writing = BUILTIN_WORKSPACES.find(p => p.id === 'writing'), review = BUILTIN_WORKSPACES.find(p => p.id === 'review');
  assert.equal(writing.frame.navigation,true); assert.equal(writing.frame.assistant,false); assert.equal(review.frame.assistant,true);
  assert.equal(BUILTIN_WORKSPACES.find(p => p.id === 'layout').frame.zoom,'width');
  assert.ok(!JSON.stringify(BUILTIN_WORKSPACES).includes('apiKey'));
});
test('custom presets retain all panel choices, zoom and dragged/floating toolbar positions per user', t => {
  storage(t); const base = BUILTIN_WORKSPACES[0], preset = { ...base, id:'custom:test',name:'Il mio romanzo',layout:moveToolbarGroup(base.layout,'text','floating',undefined,false,{x:.65,y:.25}) };
  assert.equal(storeWorkspacePresets('alice',[preset]),true);
  const loaded = readWorkspacePresets('alice')[0]; assert.equal(loaded.name,preset.name);assert.deepEqual(loaded.frame,preset.frame);assert.deepEqual(loaded.layout,preset.layout);
  assert.deepEqual(readWorkspacePresets('bob'),[]);
  loaded.layout.positions.text.x = 0;assert.equal(readWorkspacePresets('alice')[0].layout.positions.text.x,.65);
});
test('workspace state separates fullscreen and users, normalizes invalid frames and handles blocked storage', t => {
  const values = storage(t), normal=workspaceFrameKey('alice',false), full=workspaceFrameKey('alice',true);
  storeWorkspaceFrame(normal,BUILTIN_WORKSPACES[1].frame);assert.equal(readWorkspaceFrame(normal).navigation,true);assert.equal(readWorkspaceFrame(full),null);
  assert.equal(readWorkspaceFrame(workspaceFrameKey('bob',false)),null);
  const frame=sanitizeWorkspaceFrame({pages:999,zoom:999,tools:{text:false,insert:'bad'},navigation:'bad'});assert.equal(frame.pages,1);assert.equal(frame.zoom,250);assert.equal(frame.tools.text,false);assert.equal(frame.tools.insert,true);
  values.set(workspacePresetsKey('alice'),JSON.stringify([{id:'custom:one',name:'  Uno  ',frame:null,layout:{order:['deleted']}},{id:'custom:one',name:'Duplicate'},{id:'builtin',name:'Bad'}]));
  assert.equal(readWorkspacePresets('alice').length,1);assert.equal(readWorkspacePresets('alice')[0].name,'Uno');
  globalThis.localStorage={getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('full');}};
  assert.equal(storeWorkspacePresets('alice',[]),false);assert.deepEqual(readWorkspacePresets('alice'),[]);assert.doesNotThrow(()=>storeWorkspaceFrame(normal,DEFAULT_WORKSPACE_FRAME));
});
