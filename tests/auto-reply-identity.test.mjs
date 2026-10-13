import test from 'node:test';
import assert from 'node:assert/strict';
import {eligible,directlyMentioned,AutoReplyController} from '../plugin/auto-reply.mjs';
const me={id:'person-id',wbUserId:'web-id',extId:'external-id'};
test('direct mentions match person, web and external IDs, including serialized notifyTo',()=>{
 for(const notifyTo of [['person-id'],['web-id'],['external-id'],'["external-id"]','external-id','other,external-id'])assert(eligible({id:'m',type:2,senderId:'other',param:{notifyTo}},{mentionOnly:true},me));
 assert(directlyMentioned({param:{notifyTo:[123]}},{extId:123}));
 for(const param of [{notifyToAll:true},{notifyTo:['someone-else']},{notifyTo:['prefix-external-id']},{notifyTo:[{id:'external-id'}]},{}])assert.equal(eligible({id:'m',type:2,content:'@my-name',senderId:'other',param},{mentionOnly:true},me),false);
 assert.equal(eligible({id:'own',type:2,senderId:'external-id',param:{notifyTo:['person-id']}},{mentionOnly:true},me),false);
});
test('external-ID mention triggers exactly one group reply and a bad configured chat does not block it',async()=>{
 let page=0,turns=0,sends=0;
 const bridge={json:async p=>p==='status'?{authenticated:true}:p==='me'?me:++page===1?{items:[],newest:'base'}:{items:[{id:'new',type:2,senderId:'other',content:'question',param:{notifyTo:['external-id']}}],newest:'new'},target:async id=>{if(id==='bad')throw Error('unavailable');return {id,isGroup:true};},sendText:async()=>sends++};
 const cfg={enabled:true,recipients:['bad','group'],pollIntervalMs:1000,replyTimeoutMs:5000,maxConcurrent:2,allowedTools:[]};
 const auto=new AutoReplyController(bridge,cfg,async()=>{turns++;return 'reply';});await auto.tick();assert.equal(auto.state.conversations.group.result,'ready');await auto.tick();await Promise.all([...auto.jobs]);assert.equal(turns,1);assert.equal(sends,1);assert.equal(auto.state.conversations.group.result,'replied');assert.equal(auto.state.conversations.bad.result,'error');await auto.tick();assert.equal(turns,1);await auto.close();
});
test('model configuration failure is visible in per-chat status instead of silently losing the trigger',async()=>{
 let page=0;const bridge={json:async p=>p==='status'?{authenticated:true}:p==='me'?me:++page===1?{items:[],newest:'base'}:{items:[{id:'new',type:2,param:{notifyTo:['external-id']}}],newest:'new'},target:async id=>({id,isGroup:true})};
 const auto=new AutoReplyController(bridge,{enabled:true,recipients:['group'],pollIntervalMs:1000,replyTimeoutMs:5000,maxConcurrent:2},async()=>{throw Error('请先在 Harness 配置默认模型');});await auto.tick();await auto.tick();await Promise.all([...auto.jobs]);assert.equal(auto.state.conversations.group.result,'error');assert.match(auto.state.conversations.group.detail,/默认模型/);await auto.close();
});
