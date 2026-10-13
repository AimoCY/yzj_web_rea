import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeMessages,richTokens,safeLink} from '../web/chat-utils.mjs';
test('history pages merge without duplicate messages or reordered same-second records',()=>{
  const data=mergeMessages([{id:'z',time:'2026-10-13 10:00:00',content:'a'},{id:'a',time:'2026-10-13 10:00:00',content:'b'}],[{id:'z',time:'2026-10-13 10:00:00',content:'updated'}]);
  assert.deepEqual(data.map(x=>x.id),['z','a']);assert.equal(data[0].content,'updated');
});
test('server acknowledgements replace the matching client request',()=>{
  assert.equal(mergeMessages([{id:'pending',clientMsgId:'cid',time:'x'}],[{id:'server',clientMsgId:'cid',time:'x'}]).length,1);
});
test('withdrawals remove image content but preserve original position',()=>{
  const data=mergeMessages([{id:'old',time:'a',type:8,attachments:[{url:'secret'}]}],[{id:'notice',time:'b',type:9,withdraws:'old',content:'已撤回'}]);
  assert.equal(data.length,1);assert.equal(data[0].id,'old');assert.equal(data[0].time,'a');assert.deepEqual(data[0].attachments,[]);
});
test('delete notices cannot reintroduce removed messages',()=>assert.equal(mergeMessages([{id:'old'}],[{id:'notice',withdraws:'old',deleted:true}]).length,0));
test('UTF-16 rich offsets preserve emoji and inline images',()=>{
  const tokens=richTokens({content:'👋[图片]结束',segments:[{type:'image',start:2,length:4,url:'local'}]});
  assert.deepEqual(tokens.map(x=>x.text),['👋','[图片]','结束']);
});
test('malformed or overlapping rich descriptors do not lose original text',()=>{
  const tokens=richTokens({content:'abcdef',segments:[{type:'link',start:0,length:3},{type:'image',start:2,length:3},{type:'bold',start:9,length:1}]});
  assert.equal(tokens.map(x=>x.text).join(''),'abcdef');
});
test('untrusted link schemes and embedded credentials are not clickable',()=>{
  for(const value of ['javascript:alert(1)','data:text/html,x','https://user:pass@example.com'])assert.equal(safeLink(value),'');
  assert.equal(safeLink('/im/xiaoxi/'),'https://www.yunzhijia.com/im/xiaoxi/');
});
