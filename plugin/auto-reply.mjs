import {randomUUID} from 'node:crypto';
export function failureDetail(error,stage='read'){
 const message=String(error?.message||'');
 if(/Connection reset|Connection refused|urlopen error|fetch failed|ENOTFOUND|ECONN|TLS|SSL|socket/i.test(message))return '无法连接云之家：请检查插件的 proxy 配置及公司 VPN；登录有效不代表消息连接正常';
 if(error?.status===401)return '登录已过期，请重新扫码登录';
 if(error?.name==='TimeoutError'||/timed? ?out|timeout/i.test(message))return stage==='read'?'读取云之家消息超时，请检查网络和代理':'回复生成或发送超时，请检查模型和网络';
 if(message==='请先在 Harness 配置默认模型')return message;
 return stage==='read'?'会话读取失败，请检查登录或重新选择会话':'回复生成或发送失败，请检查模型、登录和权限';
}
export function identityIds(me){return new Set([me.id,me.wbUserId,me.extId].filter(v=>v!==undefined&&v!==null&&v!=='').map(String));}
export function directlyMentioned(message,me){
 const ids=identityIds(me);let targets=message.param?.notifyTo;
 if(typeof targets==='string'){try{const parsed=JSON.parse(targets);targets=Array.isArray(parsed)?parsed:[parsed];}catch{targets=targets.split(',').map(x=>x.trim());}}
 if(Array.isArray(targets)&&targets.some(id=>(typeof id==='string'||typeof id==='number')&&ids.has(String(id))))return true;
 // Received messages may omit notifyTo; an active notification plus a typed
 // at descriptor carries the recipient ID. Names and forwarded text are not proof.
 const param=message.param||{};
 return Number(param.notifyType)===1&&Array.isArray(param.desc)&&param.desc.some(d=>d&&d.type==='at'&&(typeof d.data==='string'||typeof d.data==='number')&&ids.has(String(d.data)));

}
export function eligible(message,config,me){
 return !exclusionReason(message,config,me);
}
export function exclusionReason(message,config,me){
 if(message.own||identityIds(me).has(String(message.senderId)))return '消息由当前登录账号本人发送，不触发自动回复';
 if(message.withdrawn)return '消息已撤回，不触发自动回复';
 if(!message.id||![2,3,4,8,23].includes(message.type))return '系统消息或不支持的消息类型，不触发自动回复';
 if(config.mentionOnly&&!directlyMentioned(message,me))return '群消息没有明确 @ 当前登录账号，请从群成员列表选择本人';
 return '';
}
export class AutoReplyController{
 constructor(bridge,config,respond,report=()=>{},settingsForAccount=null){this.settingsForAccount=settingsForAccount;this.bridge=bridge;this.config=config;this.respond=respond;this.report=report;this.cursors=new Map();this.seen=new Set();this.pending=new Map();this.jobs=new Set();this.controller=new AbortController();this.account='';this.state={enabled:config.enabled,connected:false,processing:0,errors:0,conversations:{}};}
 status(id,result,detail=''){const now=Date.now(),lastReplyAt=result==='replied'?now:this.state.conversations[id]?.lastReplyAt;this.state.conversations[id]={result,detail,checkedAt:now,...lastReplyAt?{lastReplyAt}:{}};}
 start(){this.loop=this.run();}
 async run(){while(!this.controller.signal.aborted){try{await this.tick();this.state.lastError='';}catch(error){if(!this.controller.signal.aborted){this.state.errors++;this.state.lastError=failureDetail(error);this.report(error);}}await new Promise(resolve=>{const timer=setTimeout(done,this.config.pollIntervalMs);const signal=this.controller.signal;function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();});}}
 async tick(){
  const signal=this.controller.signal,status=await this.bridge.json('status',{},signal);this.state.connected=!!status.authenticated;
  if(!status.authenticated){this.cursors.clear();this.state.conversations={};this.account='';return;}
  const me=await this.bridge.json('me',{},signal);
  if(this.account!==me.id){this.cursors.clear();this.seen.clear();this.state.conversations={};this.account=me.id;}
  if(this.settingsForAccount)this.config=await this.settingsForAccount(me.id);this.state.enabled=this.config.enabled;
  if(!this.config.enabled)return;
  for(const id of this.config.recipients){
   if(this.pending.has(id)||this.jobs.size>=this.config.maxConcurrent)continue;
   try{
   const target=await this.bridge.target(id,signal),cursor=this.cursors.get(id);
   // First read seeds the cursor only; never answer messages predating activation/login.
   if(cursor===undefined){const first=await this.bridge.json('history?'+new URLSearchParams({recipientId:target.id,count:'200'}),{},signal);this.cursors.set(id,first.newest||'');this.status(id,'ready','已建立基线，等待新消息');continue;}
   let after=cursor,count=0;
   do{
    const batch=await this.bridge.json('history?'+new URLSearchParams({recipientId:target.id,after,count:'200'}),{},signal);
    if(this.state.conversations[id]?.readFailed)this.status(id,'ready','消息连接已恢复，等待新消息');
    const rows=batch.items.filter(row=>!this.seen.has(me.id+':'+id+':'+row.id));
    if(batch.newest&&batch.newest!==after){after=batch.newest;this.cursors.set(id,after);}else break;
    const accepted=rows.filter(row=>eligible(row,{...this.config,mentionOnly:target.isGroup},me));
    for(const row of rows)this.seen.add(me.id+':'+id+':'+row.id);
    if(this.seen.size>10000)this.seen=new Set([...this.seen].slice(-5000));
    const ownEcho=rows.every(row=>row.own||identityIds(me).has(String(row.senderId)));
    if(rows.length&&!accepted.length&&!(ownEcho&&this.state.conversations[id]?.result==='replied'))this.status(id,'filtered',exclusionReason(rows.at(-1),{mentionOnly:target.isGroup},me));
    if(accepted.length){
     this.status(id,'generating','正在生成回复');
     const task=this.reply(target,accepted,me).catch(error=>{if(!signal.aborted){this.state.errors++;this.status(id,'error',failureDetail(error,'reply'));this.report(error);}}).finally(()=>{this.pending.delete(id);this.jobs.delete(task);this.state.processing=this.jobs.size;});
     this.pending.set(id,task);this.jobs.add(task);this.state.processing=this.jobs.size;break;
    }
    if(batch.items.length<200)break;
   }while(++count<20);
   }catch(error){if(!signal.aborted){this.state.errors++;this.status(id,'error',failureDetail(error));this.state.conversations[id].readFailed=true;this.report(error);}}
  }
 }
 async reply(target,rows,me){
  const signal=AbortSignal.any([this.controller.signal,AbortSignal.timeout(this.config.replyTimeoutMs)]);
  const prompt=rows.map(row=>`${row.sender||'成员'}：${row.content||'[附件]'}${row.attachments?.length?'\n附件：'+row.attachments.map(a=>a.name||a.kind).join('、'):''}`).join('\n\n');
  const text=await this.respond(target,prompt,me.id,signal,this.config);signal.throwIfAborted();if(!text?.trim()){this.status(target.id,'empty','模型未返回可发送的文字');return;}
  const now=await this.bridge.json('me',{},signal);if(now.id!==me.id)return;
  // Reuse one id if reconciliation is needed. Never resend an ambiguous result.
  this.status(target.id,'sending','正在发送回复');
  const cid=randomUUID();try{await this.bridge.sendText(target.id,([...text].length>10000?[...text].slice(0,9970).join('')+'\n\n（回复过长，已截断）':text),cid,signal);this.status(target.id,'replied','已自动回复');}catch(error){if(!error.data?.uncertain)throw error;try{await this.bridge.json('messages/receipt',{method:'POST',body:{clientMsgId:cid}},signal);}catch{}throw Error('自动回复回执未确认，未重发');}
 }
 async close(){this.controller.abort();await this.loop;await Promise.allSettled([...this.jobs]);}
}
