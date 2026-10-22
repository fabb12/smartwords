import test from 'node:test';
import assert from 'node:assert/strict';
import { editorShortcut } from '../lib/editor-shortcuts.ts';
const key=(key,extra={})=>editorShortcut({key,shiftKey:false,ctrlKey:false,metaKey:false,altKey:false,isComposing:false,repeat:false,...extra});
test('AI shortcuts distinguish formatting, correction and completion on Windows and Mac',()=>{
 assert.equal(key('Tab',{shiftKey:true}),'format');assert.equal(key('Tab'),null);
 for(const mod of [{ctrlKey:true},{metaKey:true}]){
  assert.equal(key('Enter',mod),'complete');assert.equal(key('Enter',{...mod,shiftKey:true}),'rewrite');
  assert.equal(key('F',{...mod,shiftKey:true}),'format-document');assert.equal(key('p',{...mod,altKey:true}),'format-page');
  assert.equal(key('s',mod),'save');assert.equal(key('f',mod),'find');
  assert.equal(key('p',mod),null);assert.equal(key('b',mod),null);
 }
 assert.equal(key('F1'),'shortcuts');
});
test('composition, held keys and unrelated combinations do not launch AI',()=>{
 assert.equal(key('Tab',{shiftKey:true,isComposing:true}),null);assert.equal(key('Tab',{shiftKey:true,repeat:true}),null);
 assert.equal(key('Tab',{shiftKey:true,altKey:true}),null);assert.equal(key('Tab',{shiftKey:true,ctrlKey:true}),null);
 assert.equal(key('Enter',{ctrlKey:true,altKey:true}),null);
});
