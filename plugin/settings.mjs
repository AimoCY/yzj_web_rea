import {mkdir,readFile,writeFile,rename,chmod} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
export function validateAutoReply(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('自动回复配置格式无效');
 const text=(v,max,label)=>{if(typeof v!=='string'||v.length>max)throw Error(label+'格式或长度无效');return v.trim();};
 const integer=(v,min,max,label)=>{if(!Number.isInteger(v)||v<min||v>max)throw Error(label+'超出范围');return v;};
 if(typeof value.enabled!=='boolean')throw Error('自动回复开关格式无效');
 if(!Array.isArray(value.recipients)||value.recipients.length>200)throw Error('最多选择 200 个会话');
 const recipients=[...new Set(value.recipients.map(v=>text(v,256,'会话 ID')))];if(recipients.some(v=>!v)||value.enabled&&!recipients.length)throw Error('开启自动回复时请选择会话');
 if(value.recipientPrompts&&(typeof value.recipientPrompts!=='object'||Array.isArray(value.recipientPrompts)))throw Error('会话提示词格式无效');
 const recipientPrompts=Object.create(null);for(const [id,prompt] of Object.entries(value.recipientPrompts||{})){if(!recipients.includes(id))throw Error('单独提示词必须对应已选择的会话');recipientPrompts[id]=text(prompt,8000,'会话提示词');}
 if(!Array.isArray(value.allowedTools)||value.allowedTools.length>100)throw Error('工具列表格式无效');
 const allowedTools=[...new Set(value.allowedTools.map(v=>text(v,128,'工具名称')))];if(allowedTools.some(v=>!v||!/^[\w.-]+$/.test(v)))throw Error('工具名称格式无效');
 return {enabled:value.enabled,recipients,mentionOnly:true,prompt:text(value.prompt??'',8000,'通用提示词'),recipientPrompts,pollIntervalMs:integer(value.pollIntervalMs,1000,60000,'检查间隔'),replyTimeoutMs:integer(value.replyTimeoutMs,1000,600000,'回复超时'),maxConcurrent:integer(value.maxConcurrent,1,10,'并发数'),allowedTools};
}
export class ReplySettings{
 constructor(path,defaults){this.path=path;this.defaults=validateAutoReply({...defaults,prompt:defaults.prompt||'',recipientPrompts:defaults.recipientPrompts||{}});this.accounts={};this.targets={};}
 async load(){try{const data=JSON.parse(await readFile(this.path,'utf8'));if(data.version!==1||!data.accounts||typeof data.accounts!=='object')throw Error('自动回复配置文件格式无效');this.targets=data.targets&&typeof data.targets==='object'?data.targets:{};for(const [id,value] of Object.entries(data.accounts))this.accounts[id]=validateAutoReply(value);}catch(error){if(error.code!=='ENOENT')throw error;}return this;}
 get(id){return Object.hasOwn(this.accounts,id)?this.accounts[id]:this.defaults;}
 getTargets(id){const rows=Object.hasOwn(this.targets,id)&&Array.isArray(this.targets[id])?this.targets[id]:[];return rows.filter(t=>t&&this.get(id).recipients.includes(t.id));}
 async save(id,value,metadata=[]){const settings=validateAutoReply(value),accounts={...this.accounts,[id]:settings},targets={...this.targets,[id]:metadata.map(t=>({id:t.id,name:t.name||t.id,isGroup:!!t.isGroup}))};await mkdir(dirname(this.path),{recursive:true,mode:0o700});const temp=this.path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify({version:1,accounts,targets}),{mode:0o600});await rename(temp,this.path);await chmod(this.path,0o600);this.accounts=accounts;this.targets=targets;return settings;}
}
export async function serveReplySettings(req,res,{bridge,settings,update}){
 const respond=(status,payload)=>res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(payload));
 if(!['GET','POST'].includes(req.method))return respond(405,{error:'不支持的方法'});
 if(req.method==='POST'){try{const origin=new URL(req.headers.origin);if(!['http:','https:'].includes(origin.protocol)||origin.host!==req.headers.host)return respond(403,{error:'Invalid origin'});}catch{return respond(403,{error:'Invalid origin'});}}
 try{
  const status=await bridge.json('status');if(!status.authenticated)return respond(401,{error:'请先登录云之家'});
  const me=await bridge.json('me');
  if(req.method==='GET')return respond(200,{accountId:me.id,config:settings.get(me.id),targets:settings.getTargets(me.id)});
  const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>65536)return respond(413,{error:'配置最多 64 KiB'});chunks.push(chunk);}
  const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(input.accountId!==me.id)return respond(409,{error:'登录账号已变化，请重新加载配置'});
  const config=validateAutoReply(input.config),targets=[],recipientPrompts=Object.create(null);
  for(const id of config.recipients){
   const target=await bridge.target(id);if(target.canSend===false)throw Error('所选会话不支持发送消息');
   let canonical=target.groupId||id;
   if(id.startsWith('person:')&&!target.groupId){const history=await bridge.json('history?'+new URLSearchParams({recipientId:id,count:'1'}));if(!history.groupId)throw Error('未取得联系人的会话，请先打开该联系人聊天后重试');canonical=history.groupId;}
   targets.push({...target,id:canonical});if(config.recipientPrompts[id])recipientPrompts[canonical]=config.recipientPrompts[id];
  }
  config.recipients=[...new Set(targets.map(t=>t.id))];config.recipientPrompts=recipientPrompts;
  const now=await bridge.json('me');if(now.id!==me.id)return respond(409,{error:'登录账号已变化，请重新加载配置'});
  await settings.save(me.id,config,targets);await update(config);return respond(200,{accountId:me.id,config,targets});
 }catch(error){return respond(error.status===401?401:400,{error:error.status===401?'请先登录云之家':error.message||'保存失败'});}
}
