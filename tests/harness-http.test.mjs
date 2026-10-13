import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {Readable} from 'node:stream';
import {serveMounted} from '../plugin/http.mjs';
async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return 'http://127.0.0.1:'+server.address().port;}
async function close(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
async function fixture(run){
 const calls=[];
 const upstream=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const data=Buffer.concat(chunks);calls.push({headers:req.headers,data});res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({bytes:data.length}));});
 const origin=await listen(upstream);
 const bridge={fetch:(path,options,signal)=>fetch(origin+path,{...options,signal})};
 const mounted=createServer((req,res)=>serveMounted(bridge,'/plugins/yzj',req,res).catch(()=>{res.writeHead(502).end();}));
 const url=await listen(mounted);
 try{await run(url,calls);}finally{await close(mounted);await close(upstream);}
}
test('mounted UTF-8 text has Content-Length even when browser request is chunked',async()=>fixture(async(url,calls)=>{
 const data=Buffer.from(JSON.stringify({text:'你好 😀',recipient:{id:'demo'}}));
 const response=await fetch(url+'/plugins/yzj/api/messages/text',{method:'POST',headers:{'Content-Type':'application/json'},body:Readable.from([data.subarray(0,8),data.subarray(8)]),duplex:'half'});
 assert.equal(response.status,200);assert.deepEqual(calls[0].data,data);assert.equal(calls[0].headers['content-length'],String(data.length));assert.equal(calls[0].headers['transfer-encoding'],undefined);
}));
for(const kind of ['image','file'])test('mounted multipart '+kind+' preserves binary data and boundary',async()=>fixture(async(url,calls)=>{
 const binary=Buffer.from([0,255,13,10,128,42]),body=new FormData();body.set('file',new Blob([binary]),'demo.bin');body.set('clientMsgId','test');
 const response=await fetch(url+'/plugins/yzj/api/messages/'+kind,{method:'POST',body});
 assert.equal(response.status,200);const call=calls[0];assert(call.data.includes(binary));assert.match(call.headers['content-type'],/^multipart\/form-data; boundary=/);assert.equal(Number(call.headers['content-length']),call.data.length);assert.equal(call.headers['transfer-encoding'],undefined);
}));
test('oversized text is rejected before forwarding to the sidecar',async()=>fixture(async(url,calls)=>{
 const response=await fetch(url+'/plugins/yzj/api/messages/text',{method:'POST',body:Buffer.alloc(65537)});
 assert.equal(response.status,413);assert.match((await response.json()).error,/请求大小/);assert.equal(calls.length,0);
}));
