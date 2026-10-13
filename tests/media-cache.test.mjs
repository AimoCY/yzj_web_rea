import test from 'node:test';
import assert from 'node:assert/strict';
import {ImageCache} from '../web/media-cache.mjs';
function fixture(options={}){const calls=[],revoked=[];let serial=0;const cache=new ImageCache({fetcher:async(key,init)=>{calls.push({key,init});return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}});},createURL:()=> 'blob:test-'+(++serial),revokeURL:url=>revoked.push(url),...options});return {cache,calls,revoked};}
test('repeated and concurrent image loads reuse one authenticated fetch and object URL',async()=>{
 const {cache,calls}=fixture();const [a,b]=await Promise.all([cache.get('image'),cache.get('image')]);assert.equal(a,b);assert.equal(await cache.get('image'),a);assert.equal(calls.length,1);assert.equal(calls[0].init.cache,'no-store');cache.clear();
});
test('image cache evicts least recently used entries within its byte limit',async()=>{
 const {cache,revoked}=fixture({maxBytes:6});await cache.get('a');await cache.get('b');cache.peek('a');await cache.get('c');assert.equal(cache.peek('b'),'');assert(cache.peek('a'));assert.equal(cache.bytes,6);assert.deepEqual(revoked,['blob:test-2']);cache.clear();assert.equal(cache.bytes,0);
});
test('expired images are fetched again and stale blob URLs revoked',async()=>{
 const {cache,calls,revoked}=fixture();await cache.get('a');cache.items.get('a').time=0;await cache.get('a');assert.equal(calls.length,2);assert.deepEqual(revoked,['blob:test-1']);cache.clear();
});
test('failed image fetches are not cached and can retry',async()=>{
 let attempts=0;const {cache}=fixture({fetcher:async()=>new Response('',{status:++attempts===1?403:200,headers:{'content-type':'image/png'}})});await assert.rejects(cache.get('a'));assert.equal(cache.items.size,0);assert.match(await cache.get('a'),/^blob:/);cache.clear();
});
test('clearing an account rejects late downloads and never restores private blobs',async()=>{
 let finish;const {cache}=fixture({fetcher:()=>new Promise(resolve=>finish=resolve)});const pending=cache.get('a');cache.clear();finish(new Response('old account image',{headers:{'content-type':'image/png'}}));await assert.rejects(pending,/清空/);assert.equal(cache.items.size,0);assert.equal(cache.bytes,0);
});
test('oversized images fall back to the original URL without occupying cache memory',async()=>{
 const {cache}=fixture({maxItemBytes:2});assert.equal(await cache.get('a'),'a');assert.equal(cache.bytes,0);assert.equal(cache.items.size,0);
});
