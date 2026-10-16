import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
const scope='https://example.test/fluid-pocket-sandbox/';
function worker(caches,fetch=async()=>{throw Error('offline');}) {
  const handlers=new Map();
  vm.runInNewContext(source,{URL,Request,caches,fetch,location:new URL(scope),self:{
    registration:{scope},skipWaiting:async()=>{},clients:{claim:async()=>{}},
    addEventListener:(name,handler)=>handlers.set(name,handler)
  }});
  return handlers;
}

test('install refreshes the complete graph even when the HTTP cache holds the prior release',async()=>{
  let requests,done;
  const handlers=worker({open:async()=>({addAll:async entries=>{requests=entries;}})});
  handlers.get('install')({waitUntil:promise=>{done=promise;}});await done;
  assert.ok(requests.length>100);
  assert.ok(requests.every(request=>request.cache==='reload'),'fresh module bytes must replace cached prior exports');
  for(const name of ['RabbitArtGeometry','RabbitArtRenderer','RabbitAssets','RabbitPixelArt'])
    assert.ok(requests.some(request=>request.url===`${scope}src/game/${name}.mjs`));
});

test('offline modules and sprites ignore a prior cache recreated by an older worker',async()=>{
  const current={version:'current'},stale={version:'old'},opened=[];
  const handlers=worker({
    match:async()=>stale,
    open:async name=>{opened.push(name);return {match:async()=>current};}
  });
  for(const path of ['src/game/RabbitAssets.mjs?release=current','public/assets/rabbit-trials/effects/sprites/base/base.png']){
    let response;
    handlers.get('fetch')({request:new Request(scope+path),respondWith:promise=>{response=promise;}});
    assert.equal(await response,current,'the response must come from this worker’s cache, not an older cache');
  }
  assert.equal(new Set(opened).size,1);
  assert.ok(opened[0].startsWith('alchemist-shop-rabbit-animation-'));
});
