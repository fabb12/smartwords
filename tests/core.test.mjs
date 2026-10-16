import test from 'node:test';
import assert from 'node:assert/strict';
import {seal,unseal} from '../lib/vault.ts';
import {PROVIDERS,providerRequest,readTokens,isProvider,assistPrompts,splitWarning,WARNING_MARK} from '../lib/providers.ts';
const master='a-test-only-master-key-that-is-long-enough';
test('vault encrypts, randomizes IV, and binds ciphertext to its owner',async()=>{
 const a=await seal('test-key',master,'alice'),b=await seal('test-key',master,'alice');
 assert.notEqual(a,b);assert.ok(!a.includes('test-key'));assert.equal(await unseal(a,master,'alice'),'test-key');
 await assert.rejects(()=>unseal(a,master,'bob'));await assert.rejects(()=>unseal(a,'different-master-key-longer-than-32-characters','alice'));
});
test('vault fails closed without a master key',async()=>{await assert.rejects(()=>seal('key','','alice'));});
function stream(text){const bytes=new TextEncoder().encode(text);return new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}});}
async function consume(text,provider='openai'){let result='';for await(const token of readTokens(stream(text),provider))result+=token;return result;}
test('SSE handles fragmented UTF-8 and CRLF',async()=>{assert.equal(await consume('data: {"choices":[{"delta":{"content":"È un’idea"}}]}\r\n\r\ndata: [DONE]\r\n\r\n'),'È un’idea');});
test('SSE parses Anthropic text and completion',async()=>{assert.equal(await consume('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Ciao"}}\n\ndata: {"type":"message_stop"}\n\n','anthropic'),'Ciao');});
test('SSE rejects truncated and error responses',async()=>{await assert.rejects(()=>consume('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'));await assert.rejects(()=>consume('data: {"error":{"message":"bad"}}\n\n'));});
test('provider requests use fixed HTTPS endpoints and server-side headers',()=>{for(const provider of Object.keys(PROVIDERS)){const config=providerRequest(provider,'my-model','secret','instruction','text');assert.ok(config.url.startsWith('https://'));assert.equal(config.body.model,'my-model');assert.equal(config.body.stream,true);assert.ok(!JSON.stringify(config.body).includes('secret'));assert.equal(provider==='anthropic'?config.headers['x-api-key']:config.headers.Authorization,provider==='anthropic'?'secret':'Bearer secret');}assert.equal(isProvider('https://evil.test'),false);assert.equal(isProvider('__proto__'),false);});
test('model warnings are kept apart from the proposed text',()=>{
 assert.deepEqual(splitWarning(' e poi andò via.'),{warning:'',text:' e poi andò via.',pending:false});
 assert.deepEqual(splitWarning('<<WAR'),{warning:'',text:'',pending:true});
 assert.deepEqual(splitWarning('<<WARNING>> Il testo contraddice'),{warning:'Il testo contraddice',text:'',pending:true});
 assert.deepEqual(splitWarning('<<WARNING>> Laura ha gli occhi verdi nel capitolo 1.\nLaura lo guardò.'),{warning:'Laura ha gli occhi verdi nel capitolo 1.',text:'Laura lo guardò.',pending:false});
 assert.deepEqual(splitWarning('<<WARNING>> The text is unclear.\n'),{warning:'The text is unclear.',text:'',pending:false});
 assert.ok(assistPrompts({mode:'complete',text:'x'}).system.includes(WARNING_MARK));
 assert.ok(assistPrompts({mode:'rewrite',text:'x'}).system.includes(WARNING_MARK));
 assert.ok(!assistPrompts({mode:'ask',text:'x'}).system.includes(WARNING_MARK));
 assert.ok(!assistPrompts({mode:'memory',text:'x'}).system.includes(WARNING_MARK));
});
