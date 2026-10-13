import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {ReplySettings,validateAutoReply,serveReplySettings} from '../plugin/settings.mjs';
import {AutoReplyController} from '../plugin/auto-reply.mjs';
const defaults={enabled:false,recipients:[],prompt:'通用提示词',recipientPrompts:{},pollIntervalMs:4000,replyTimeoutMs:180000,maxConcurrent:2,allowedTools:[]};
test('settings persist per account with private file permissions and strict group mention rule',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yzj-settings-'));try{
 const path=join(dir,'settings.json'),store=await new ReplySettings(path,defaults).load();
 await store.save('a',{...defaults,enabled:true,recipients:['group'],mentionOnly:false,recipientPrompts:{group:'群提示词'}});
 const loaded=await new ReplySettings(path,defaults).load();assert.equal(loaded.get('a').mentionOnly,true);assert.equal(loaded.get('a').recipientPrompts.group,'群提示词');assert.equal(loaded.get('b').enabled,false);assert.equal((await stat(path)).mode&0o777,0o600);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('invalid ranges, missing recipients and orphan prompts are rejected',()=>{
 assert.throws(()=>validateAutoReply({...defaults,enabled:true}),/请选择/);assert.throws(()=>validateAutoReply({...defaults,pollIntervalMs:0}),/范围/);assert.throws(()=>validateAutoReply({...defaults,recipientPrompts:{other:'x'}}),/已选择/);assert.throws(()=>validateAutoReply({...defaults,allowedTools:['bad tool']}),/工具/);
});
test('HTTP settings enforce origin, login, current account and valid sendable targets before updating',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yzj-settings-http-'));let authenticated=true,updates=0;
 const store=await new ReplySettings(join(dir,'settings.json'),defaults).load(),bridge={json:async p=>p==='status'?{authenticated}:{id:'a'},target:async id=>{if(id!=='group')throw Error('请选择有效会话');return {id,canSend:true};}};
 const server=createServer((req,res)=>serveReplySettings(req,res,{bridge,settings:store,update:async()=>updates++}));server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 const send=(body,from=origin)=>fetch(origin,{method:'POST',headers:{Origin:from,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
 assert.equal((await send({accountId:'a',config:defaults},'https://evil.test')).status,403);
 assert.equal((await send({accountId:'b',config:defaults})).status,409);
 assert.equal((await send({accountId:'a',config:{...defaults,recipients:['invalid']}})).status,400);
 const result=await send({accountId:'a',config:{...defaults,enabled:true,recipients:['group'],prompt:'简洁回复'}});assert.equal(result.status,200);assert.equal(updates,1);assert.equal((await (await fetch(origin)).json()).config.prompt,'简洁回复');
 authenticated=false;assert.equal((await fetch(origin)).status,401);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
test('group requires direct mention even with legacy mentionOnly=false; only selected conversations reply',async()=>{
 const batches=[{items:[],newest:'baseline'},{items:[{id:'all',type:2,content:'all-only-message',param:{notifyToAll:true}},{id:'direct',type:2,content:'direct-mention-message',param:{notifyTo:['me']}}],newest:'direct'}];let turns=0,received;
 const bridge={json:async p=>p==='status'?{authenticated:true}:p==='me'?{id:'me'}:batches.shift(),target:async id=>({id,isGroup:true}),sendText:async()=>{}};
 const config={...defaults,enabled:true,recipients:['g'],mentionOnly:false,recipientPrompts:{g:'group policy'}};
 const auto=new AutoReplyController(bridge,config,async(_target,text,_me,_signal,settings)=>{turns++;received={text,settings};return 'reply';});await auto.tick();await auto.tick();await Promise.all([...auto.jobs]);assert.equal(turns,1);assert(!received.text.includes('all-only-message'));assert(received.text.includes('direct-mention-message'));assert.equal(received.settings.recipientPrompts.g,'group policy');await auto.close();
});
test('a discovered contact resolves from the authenticated registry instead of searching its ID as a name',async()=>{
 const {YunzhijiaBridge}=await import('../plugin/bridge.mjs');const bridge=new YunzhijiaBridge({}),calls=[];
 bridge.json=async path=>{calls.push(path);if(path==='recipient?recipientId=person%3Au')return {recipient:{id:'person:u',userId:'u',name:'Contact'}};throw Error('Unexpected name search');};
 assert.equal((await bridge.target('person:u')).name,'Contact');assert.equal(calls.length,1);
});
test('saving a searched contact persists the real group ID and remaps its custom prompt for restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yzj-contact-save-')),store=await new ReplySettings(join(dir,'s.json'),defaults).load();
 const bridge={json:async p=>p==='status'?{authenticated:true}:p==='me'?{id:'a'}:{groupId:'real-group'},target:async()=>({id:'person:u',userId:'u',name:'Contact'})};
 const server=createServer((req,res)=>serveReplySettings(req,res,{bridge,settings:store,update:async()=>{}}));server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 try{const response=await fetch(origin,{method:'POST',headers:{Origin:origin},body:JSON.stringify({accountId:'a',config:{...defaults,enabled:true,recipients:['person:u'],recipientPrompts:{'person:u':'contact policy'}}})});assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.config.recipients,['real-group']);assert.equal(data.config.recipientPrompts['real-group'],'contact policy');assert.equal(data.targets[0].name,'Contact');}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
