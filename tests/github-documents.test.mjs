import test from 'node:test';
import assert from 'node:assert/strict';
import { bindGitHubDocument, connectGitHub, disconnectGitHub, encodeDocument, githubConnected, githubLocalId, githubLocalUnchanged, listGitHubDocuments, loadGitHubDocument, parseGitHubDocument, saveGitHubDocument, GitHubConflict } from '../lib/github-documents.ts';
import { EMPTY_PROJECT } from '../lib/project.ts';

const settings={repository:'writer/manuscripts',branch:'documenti',remember:false};
const content=text=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
function storage(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
function mockGitHub(t){
  const original=globalThis.fetch;
  const state={files:new Map(),branches:new Set(['main']),requests:[],writes:0,race:false,deny:false,offline:false};
  let serial=0;
  const json=(data,status=200)=>Response.json(data,{status});
  globalThis.fetch=async(url,init)=>{
    if(state.offline)throw new TypeError('offline');
    const u=new URL(url),method=init.method||'GET',path=decodeURIComponent(u.pathname.replace('/repos/writer/manuscripts',''));
    assert.equal(u.origin,'https://api.github.com');assert.equal(init.headers.Authorization,'Bearer github-test-token');assert.equal(init.redirect,'error');
    state.requests.push({path,method});
    if(path==='')return json({private:true,default_branch:'main',permissions:{push:true}});
    if(path.startsWith('/git/ref/heads/'))return state.branches.has(path.slice('/git/ref/heads/'.length))?json({object:{sha:'main-head'}}):json({},404);
    if(path==='/git/refs'){const b=JSON.parse(init.body);assert.equal(b.sha,'main-head');state.branches.add(b.ref.slice('refs/heads/'.length));return json({},201);}
    if(path.startsWith('/git/blobs/')){const file=[...state.files.values()].find(f=>f.sha===path.slice('/git/blobs/'.length));return file?json({encoding:'base64',content:encodeDocument(file.text)}):json({},404);}
    const filePath=path.replace('/contents/',''),branch=u.searchParams.get('ref')||JSON.parse(init.body||'{}').branch;
    if(filePath==='scrivia-documents')return state.files.size?json([...state.files.entries()].filter(([key])=>key.startsWith(branch+'/')).map(([key,f])=>({type:'file',path:key.slice(branch.length+1),name:key.split('/').at(-1),sha:f.sha}))):json({},404);
    const key=branch+'/'+filePath,file=state.files.get(key);
    if(method==='GET')return file?json({sha:file.sha,size:new TextEncoder().encode(file.text).length,encoding:file.text.length>1_000_000?'none':'base64',content:file.text.length>1_000_000?'':encodeDocument(file.text)}):json({},404);
    assert.equal(method,'PUT');if(state.deny)return json({},403);
    const body=JSON.parse(init.body);
    if(state.race&&file){file.sha='raced-sha';state.race=false;}
    if(file?file.sha!==body.sha:body.sha!==undefined)return json({},409);
    const text=Buffer.from(body.content,'base64').toString('utf8'),sha='file-'+(++serial);
    state.files.set(key,{text,sha});state.writes++;return json({content:{sha}},201);
  };
  globalThis.localStorage=storage();
  t.after(()=>{disconnectGitHub();globalThis.fetch=original;delete globalThis.localStorage;});
  return state;
}

test('GitHub save/load carries Unicode, formatting and project; excludes credentials and handles concurrent devices',async t=>{
  const state=mockGitHub(t),deviceA=globalThis.localStorage;
  await connectGitHub(settings,'github-test-token');
  assert.equal(githubConnected(),true);
  const first=await saveGitHubDocument('local-a','La città 😀',content('Papà cammina.'),{...EMPTY_PROJECT,brief:{...EMPTY_PROJECT.brief,premise:'Una storia italiana'},apiKey:'must-not-be-exported'});
  assert.ok(state.branches.has('documenti'));
  assert.equal(state.writes,1);
  assert.equal(deviceA.values.has('scrivia:github-token'),false,'tokens are not persisted by default');
  assert.ok(![...state.files.values()][0].text.includes('must-not-be-exported'));
  assert.ok(![...state.files.values()][0].text.includes('github-test-token'));
  const listed=await listGitHubDocuments();assert.equal(listed[0].document.title,'La città 😀');
  assert.equal(listed[0].document.project.brief.premise,'Una storia italiana');
  assert.deepEqual(listed[0].document.content,content('Papà cammina.'));
  assert.equal(githubLocalId(first.document.id,['local-a']),'local-a');
  assert.equal(await githubLocalUnchanged('local-a',first.document.title,first.document.content,first.document.project),true);
  assert.equal(await githubLocalUnchanged('local-a',first.document.title,content('Modifica locale.'),first.document.project),false);
  // A second device opens the same file, with its own local document identifier.
  const deviceB=storage();globalThis.localStorage=deviceB;await connectGitHub(settings,'github-test-token');
  const opened=await loadGitHubDocument(first.path);await bindGitHubDocument('local-b',opened);
  assert.equal(githubLocalId(first.document.id,['local-b']),'local-b');
  globalThis.localStorage=deviceA;
  const second=await saveGitHubDocument('local-a','Versione aggiornata',content('Testo dal dispositivo A.'),EMPTY_PROJECT);
  assert.notEqual(second.sha,first.sha);
  globalThis.localStorage=deviceB;
  await assert.rejects(()=>saveGitHubDocument('local-b','Versione B',content('Modifiche B.'),EMPTY_PROJECT),GitHubConflict);
  assert.equal(state.writes,2,'a stale device cannot overwrite a newer revision');
  assert.equal((await loadGitHubDocument(first.path)).document.title,'Versione aggiornata');
  const copy=await saveGitHubDocument('local-b','Copia B',content('Modifiche B.'),EMPTY_PROJECT,true);
  assert.notEqual(copy.path,first.path);assert.equal(state.files.size,2);
});

test('GitHub prevents a race after the version check and preserves the original on network and permission errors',async t=>{
  const state=mockGitHub(t);await connectGitHub(settings,'github-test-token');
  const first=await saveGitHubDocument('local','Bozza',content('Originale.'),EMPTY_PROJECT);
  state.race=true;
  await assert.rejects(()=>saveGitHubDocument('local','Race',content('Nuovo.'),EMPTY_PROJECT),GitHubConflict);
  assert.equal(state.writes,1);
  assert.equal((await loadGitHubDocument(first.path)).document.title,'Bozza');
  await bindGitHubDocument('local',await loadGitHubDocument(first.path));
  state.deny=true;
  await assert.rejects(()=>saveGitHubDocument('local','Negato',content('Nuovo.'),EMPTY_PROJECT),/permessi Contents/);
  state.deny=false;state.offline=true;
  await assert.rejects(()=>saveGitHubDocument('local','Offline',content('Nuovo.'),EMPTY_PROJECT),/copia nell’app è conservata/);
  assert.equal(state.writes,1);
});

test('large GitHub files use the blob API; invalid formats and oversized documents are rejected',async t=>{
  const state=mockGitHub(t);await connectGitHub(settings,'github-test-token');
  const saved=await saveGitHubDocument('large','Lungo',content('a'.repeat(1_100_000)),EMPTY_PROJECT);
  assert.equal((await loadGitHubDocument(saved.path)).document.content.content[0].content[0].text.length,1_100_000);
  assert.ok(state.requests.some(r=>r.path.startsWith('/git/blobs/')));
  assert.throws(()=>parseGitHubDocument('{"type":"doc"}'),/non è un documento/);
  assert.throws(()=>parseGitHubDocument('a'.repeat(2_000_001)),/2 MB/);
  await assert.rejects(()=>saveGitHubDocument('huge','Troppo lungo',content('a'.repeat(2_000_000)),EMPTY_PROJECT),/2 MB/);
  assert.equal(state.writes,1);
});

test('repository and branch inputs are validated; remembered token can be removed without deleting documents',async t=>{
  const state=mockGitHub(t);
  await assert.rejects(()=>connectGitHub({...settings,repository:'https://evil.test/repo'},'github-test-token'),/proprietario\/nome/);
  await assert.rejects(()=>connectGitHub({...settings,branch:'../bad'},'github-test-token'),/ramo GitHub/);
  await connectGitHub({...settings,remember:true},'github-test-token');
  await saveGitHubDocument('local','Bozza',content('Testo.'),EMPTY_PROJECT);
  assert.ok(localStorage.getItem('scrivia:github-token'));
  disconnectGitHub();assert.equal(githubConnected(),false);assert.equal(state.files.size,1);
});
