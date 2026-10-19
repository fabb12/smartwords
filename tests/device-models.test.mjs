import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { deviceBaseUrl, deviceModels, deviceProfileApi, deviceProfiles, deviceAssist } from '../lib/device-models.ts';
import { PROVIDER_MODELS } from '../lib/provider-models.ts';
import { PROVIDERS } from '../lib/providers.ts';

test('local model addresses are restricted to loopback and cannot carry credentials or arbitrary paths', () => {
  assert.equal(deviceBaseUrl('http://localhost:11434/v1/'),'http://localhost:11434');
  assert.equal(deviceBaseUrl('http://[::1]:1234'),'http://[::1]:1234');
  for(const url of ['https://example.org','http://192.168.1.1:1234','http://127.0.0.1.evil.test','file:///tmp/models','http://user:pass@localhost:1234','http://localhost:1234/other','http://localhost:1234/?token=secret']) assert.throws(()=>deviceBaseUrl(url));
});

test('provider model suggestions offer several Claude families and versions', () => {
  for(const family of ['sonnet','haiku','opus'])assert.ok(PROVIDER_MODELS.anthropic.filter(m=>m.includes(family)).length>=2);
  for(const models of Object.values(PROVIDER_MODELS))assert.ok(models.length>=2);
  for(const [id,p] of Object.entries(PROVIDERS))assert.ok(PROVIDER_MODELS[id].includes(p.model),`${id} default ${p.model} missing from suggestions`);
});

test('device profile discovery, authenticated streaming, quotas and updates use only the local server', async t => {
  const storage=new Map();
  globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  t.after(()=>delete globalThis.localStorage);
  let lastRequest, auth;
  const server=createServer(async(req,res)=>{
    auth=req.headers.authorization;
    if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'qwen3:8b'},{id:'llama3.2:latest'},{id:'qwen3:8b'},{bad:true}]}));return;}
    assert.equal(req.url,'/v1/chat/completions');
    let body='';for await(const chunk of req)body+=chunk;lastRequest=JSON.parse(body);
    if(lastRequest.model==='missing'){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type','text/event-stream');
    res.write('data: {"choices":[{"delta":{"content":"Il gatto cammina "}}]}\n\n');
    res.end('data: {"choices":[{"delta":{"content":"nel giardino."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await deviceModels(baseUrl,'local-test-token'),['llama3.2:latest','qwen3:8b']);
  assert.equal(auth,'Bearer local-test-token');
  const form={name:'Sul computer',provider:'ollama',model:'qwen3:8b',baseUrl,key:'local-test-token',dailyLimit:2};
  const {id}=deviceProfileApi(form);
  assert.ok(id.startsWith('device:'));
  assert.equal(deviceProfiles()[0].key,undefined);
  assert.equal(deviceProfiles()[0].hint,'oken');
  await deviceModels(baseUrl,'',undefined,id);
  assert.equal(auth,'Bearer local-test-token', 'discovery reuses the saved token when editing a profile');
  // Blank tokens preserve the original when editing the same local service.
  deviceProfileApi({...form,id,key:'',model:'llama3.2:latest'});
  const result=await deviceAssist({profile:id,mode:'complete',text:'Il gatto camina'},new AbortController().signal);
  assert.equal(result.status,200);
  const events=(await result.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(e=>e.text).map(e=>e.text).join(''),'Il gatto cammina nel giardino.');
  assert.equal(events.at(-1).done,true);
  assert.equal(events.at(-2).usage.provider,'ollama');
  assert.equal(events.at(-2).usage.model,'llama3.2:latest');
  assert.equal(events.at(-2).usage.estimated,true);
  assert.equal(lastRequest.model,'llama3.2:latest');
  assert.equal(lastRequest.stream,true);
  assert.equal(lastRequest.stream_options.include_usage,true);
  assert.equal(auth,'Bearer local-test-token');
  assert.ok(lastRequest.messages[0].content.includes('spelling errors'));
  assert.equal(deviceProfiles()[0].used,1);
  deviceProfileApi({...form,id,key:'',model:'missing'});
  assert.equal((await deviceAssist({profile:id,mode:'complete',text:'Il gatto'},new AbortController().signal)).status,502);
  assert.equal((await deviceAssist({profile:id,mode:'complete',text:'Il gatto'},new AbortController().signal)).status,429);
  // Changing the server never forwards the previous server's token.
  deviceProfileApi({...form,id,key:'',baseUrl:'http://127.0.0.1:1234'});
  assert.equal(deviceProfiles()[0].hint,'');
  assert.equal(JSON.parse(storage.get('scrivia:device-profiles'))[0].key,'');
  deviceProfileApi({id},'DELETE');assert.equal(deviceProfiles().length,0);
  const lm=deviceProfileApi({...form,provider:'lmstudio',key:'',model:'qwen3:8b'});
  const local=await deviceAssist({profile:lm.id,mode:'complete',text:'Il gatto camina'},new AbortController().signal);
  assert.equal(local.status,200);await local.text();
  assert.equal(auth,undefined,'local servers do not require a fabricated API key');
  deviceProfileApi({id:lm.id},'DELETE');
});
