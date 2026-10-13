import {randomUUID} from 'node:crypto';
export function eligible(message,config,me){
 if(message.own||message.withdrawn||[0,9].includes(message.type)||!message.id||(me.id&&message.senderId===me.id)||(me.wbUserId&&message.senderId===me.wbUserId))return false;
 if(config.mentionOnly&&!((Array.isArray(message.param?.notifyTo)?message.param.notifyTo:[]).some(id=>id===me.id||id===me.wbUserId)))return false;
 return [2,3,4,8,23].includes(message.type);
}
export class AutoReplyController{
 constructor(bridge,config,respond,report=()=>{},settingsForAccount=null){this.settingsForAccount=settingsForAccount;this.bridge=bridge;this.config=config;this.respond=respond;this.report=report;this.cursors=new Map();this.seen=new Set();this.pending=new Map();this.jobs=new Set();this.controller=new AbortController();this.account='';this.state={enabled:config.enabled,connected:false,processing:0,errors:0};}
 start(){this.loop=this.run();}
 async run(){while(!this.controller.signal.aborted){try{await this.tick();}catch(error){if(!this.controller.signal.aborted){this.state.errors++;this.report(error);}}await new Promise(resolve=>{const timer=setTimeout(done,this.config.pollIntervalMs);const signal=this.controller.signal;function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();});}}
 async tick(){
  const signal=this.controller.signal,status=await this.bridge.json('status',{},signal);this.state.connected=!!status.authenticated;
  if(!status.authenticated){this.cursors.clear();this.account='';return;}
  const me=await this.bridge.json('me',{},signal);
  if(this.account!==me.id){this.cursors.clear();this.seen.clear();this.account=me.id;}
  if(this.settingsForAccount)this.config=await this.settingsForAccount(me.id);this.state.enabled=this.config.enabled;
  if(!this.config.enabled)return;
  for(const id of this.config.recipients){
   if(this.pending.has(id)||this.jobs.size>=this.config.maxConcurrent)continue;
   const target=await this.bridge.target(id,signal),cursor=this.cursors.get(id);
   // First read seeds the cursor only; never answer messages predating activation/login.
   if(cursor===undefined){const first=await this.bridge.json('history?'+new URLSearchParams({recipientId:target.id,count:'200'}),{},signal);this.cursors.set(id,first.newest||'');continue;}
   let after=cursor,count=0;
   do{
    const batch=await this.bridge.json('history?'+new URLSearchParams({recipientId:target.id,after,count:'200'}),{},signal);
    const rows=batch.items.filter(row=>!this.seen.has(me.id+':'+id+':'+row.id));
    if(batch.newest&&batch.newest!==after){after=batch.newest;this.cursors.set(id,after);}else break;
    const accepted=rows.filter(row=>eligible(row,{...this.config,mentionOnly:target.isGroup},me));
    for(const row of rows)this.seen.add(me.id+':'+id+':'+row.id);
    if(this.seen.size>10000)this.seen=new Set([...this.seen].slice(-5000));
    if(accepted.length){
     const task=this.reply(target,accepted,me).catch(error=>{if(!signal.aborted){this.state.errors++;this.report(error);}}).finally(()=>{this.pending.delete(id);this.jobs.delete(task);this.state.processing=this.jobs.size;});
     this.pending.set(id,task);this.jobs.add(task);this.state.processing=this.jobs.size;break;
    }
    if(batch.items.length<200)break;
   }while(++count<20);
  }
 }
 async reply(target,rows,me){
  const signal=AbortSignal.any([this.controller.signal,AbortSignal.timeout(this.config.replyTimeoutMs)]);
  const prompt=rows.map(row=>`${row.sender||'成员'}：${row.content||'[附件]'}${row.attachments?.length?'\n附件：'+row.attachments.map(a=>a.name||a.kind).join('、'):''}`).join('\n\n');
  const text=await this.respond(target,prompt,me.id,signal,this.config);signal.throwIfAborted();if(!text?.trim())return;
  const now=await this.bridge.json('me',{},signal);if(now.id!==me.id)return;
  // Reuse one id if reconciliation is needed. Never resend an ambiguous result.
  const cid=randomUUID();try{await this.bridge.sendText(target.id,([...text].length>10000?[...text].slice(0,9970).join('')+'\n\n（回复过长，已截断）':text),cid,signal);}catch(error){if(!error.data?.uncertain)throw error;try{await this.bridge.json('messages/receipt',{method:'POST',body:{clientMsgId:cid}},signal);}catch{}throw Error('自动回复回执未确认，未重发');}
 }
 async close(){this.controller.abort();await this.loop;await Promise.allSettled([...this.jobs]);}
}
