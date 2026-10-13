import test from 'node:test';
import assert from 'node:assert/strict';
import {YunzhijiaBridge} from '../plugin/bridge.mjs';
import {AutoReplyController,eligible} from '../plugin/auto-reply.mjs';
import {rewriteMedia,mountedPath} from '../plugin/http.mjs';
const opts={python:'python3',proxy:'',startupTimeoutMs:10000,requestTimeoutMs:10000};
test('managed Python sidecar rejects unauthenticated access and shares one memory session',async()=>{
 const bridge=await new YunzhijiaBridge(opts).start();
 try{
  assert.equal((await fetch(bridge.origin+'/api/status')).status,401);
  assert.equal((await bridge.json('status')).authenticated,false);
  assert.equal((await bridge.fetch('/')).headers.get('set-cookie'),null);
  const script=await (await bridge.fetch('/app.js')).text();assert(script.includes("from './api/ui/markdown'"));
 }finally{await bridge.close();}
 await assert.rejects(fetch(bridge.origin+'/api/status'));
});
test('invalid Python executable fails cleanly without hanging on teardown',async()=>{
 const bridge=new YunzhijiaBridge({...opts,python:'yzj-nonexistent-python-executable',startupTimeoutMs:1000});await assert.rejects(bridge.start(),/Python|启动失败/);await bridge.close();
});
test('mount adaptation rewrites private media references, not message text',()=>{
 assert.equal(mountedPath('/plugins/yzj/api/history?a=b','/plugins/yzj'),'/api/history?a=b');
 assert.throws(()=>mountedPath('/plugins/yzj-other/api/me','/plugins/yzj'));
 assert.deepEqual(rewriteMedia({content:'/api/private is text',avatar:'/api/media?key=k',items:[{image:'/api/media?key=i'}]},'/plugins/yzj'),{content:'/api/private is text',avatar:'/plugins/yzj/api/media?key=k',items:[{image:'/plugins/yzj/api/media?key=i'}]});
});
const config={enabled:true,recipients:['group'],mentionOnly:false,pollIntervalMs:1000,replyTimeoutMs:5000,maxConcurrent:2};
function fixture(batches){const sent=[],receipts=[];const bridge={json:async(path,options)=>{if(path==='status')return {authenticated:true};if(path==='me')return {id:'mine',wbUserId:'web-mine'};if(path.startsWith('history?'))return batches.shift()||{items:[],newest:'m1'};if(path==='messages/receipt'){receipts.push(options.body);return {}; }throw Error(path);},target:async()=>({id:'group',name:'Demo',isGroup:true}),sendText:async(...args)=>{sent.push(args);return {success:true};}};return {bridge,sent,receipts};}
test('activation seeds history, new inbound triggers one response, own/duplicate messages do not loop',async()=>{
 const f=fixture([{items:[{id:'old',type:2,content:'historical'}],newest:'old'},{items:[{id:'m1',type:2,senderId:'other',content:'hello'},{id:'own',type:2,own:true,content:'mine'}],newest:'own'},{items:[{id:'m1',type:2,content:'duplicate'}],newest:'own'}]);let turns=0;
 const auto=new AutoReplyController(f.bridge,config,async()=>{turns++;return 'reply';});
 await auto.tick();assert.equal(turns,0);
 await auto.tick();await Promise.all([...auto.jobs]);assert.equal(turns,1);assert.equal(f.sent.length,1);
 await auto.tick();assert.equal(turns,1);await auto.close();
});
test('group mention filter and withdrawal handling avoid unintended replies',()=>{
 const me={id:'mine'};
 assert.equal(eligible({id:'1',type:2,senderId:'other',param:{}},{mentionOnly:true},me),false);
 assert.equal(eligible({id:'1',type:2,senderId:'other',param:{notifyTo:['mine']}},{mentionOnly:true},me),true);
 assert.equal(eligible({id:'1',type:2,withdrawn:true,param:{notifyTo:['mine']}},{mentionOnly:true},me),false);
});
test('uncertain automatic delivery checks receipt and never resends',async()=>{
 const f=fixture([]);f.bridge.sendText=async(...args)=>{f.sent.push(args);const error=Error('uncertain');error.data={uncertain:true};throw error;};
 const auto=new AutoReplyController(f.bridge,config,async()=>'reply');
 await assert.rejects(auto.reply({id:'group'},[{content:'hello'}],{id:'mine'}),/未重发/);
 assert.equal(f.sent.length,1);assert.equal(f.receipts.length,1);assert.equal(f.receipts[0].clientMsgId,f.sent[0][2]);await auto.close();
});
test('account switch during generation suppresses a stale response',async()=>{
 const f=fixture([]);f.bridge.json=async() =>({id:'new-account'});
 const auto=new AutoReplyController(f.bridge,config,async()=>'reply');
 await auto.reply({id:'group'},[{content:'hello'}],{id:'mine'});assert.equal(f.sent.length,0);await auto.close();
});
