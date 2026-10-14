import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {access} from 'node:fs/promises';
import {resolvePython,startupDetail} from './python.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export class BridgeError extends Error {constructor(message,status,data){super(message);this.status=status;this.data=data;}}
async function freePort(){const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));return port;}
export class YunzhijiaBridge{
 constructor(config){this.config=config;this.secret=randomBytes(32).toString('hex');this.shared=randomBytes(32).toString('hex');this.controller=new AbortController();this.closed=false;}
 async start(){
  try{await access(new URL('../server.py',import.meta.url));}catch{throw Error('插件安装不完整：缺少 server.py，请重新安装完整的插件 tgz 包');}
  this.python=await resolvePython(this.config.python||'');
  this.port=await freePort();this.origin=`http://127.0.0.1:${this.port}`;
  this.child=spawn(this.python.command,[...this.python.args,'-u','server.py'],{cwd:root,windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PORT:String(this.port),YZJ_PROXY:this.config.proxy||'',YZJ_PLUGIN_SECRET:this.secret,YZJ_SHARED_SESSION:this.shared},stdio:['ignore','ignore','pipe']});
  let stderr='',ready=false;this.child.stderr.setEncoding('utf8');this.child.stderr.on('data',chunk=>{if(!ready)stderr=(stderr+chunk).slice(-8192);});
  let failure;this.child.on('error',error=>{failure=error;});this.child.on('exit',()=>{if(!this.closed)this.controller.abort(Error('云之家连接服务已停止'));});
  const deadline=Date.now()+this.config.startupTimeoutMs;
  while(Date.now()<deadline){if(failure){await this.close();throw Error('无法启动 Python 连接服务（'+(failure.code||'执行失败')+'），请检查 python 配置');}if(this.child.exitCode!==null||this.child.signalCode!==null){await this.close();throw Error('云之家连接服务启动失败（Python '+this.python.version.join('.')+'，退出码 '+this.child.exitCode+'）：'+(startupDetail(stderr,[this.secret,this.shared])||'后台未输出错误，请检查 Python 和安全软件'));}try{await this.json('status',{},AbortSignal.timeout(Math.max(1,Math.min(500,deadline-Date.now()))));ready=true;stderr='';return this;}catch{await new Promise(r=>setTimeout(r,100));}}
  await this.close();throw Error('云之家连接服务启动超时：'+(startupDetail(stderr,[this.secret,this.shared])||'Python 已启动，但本机服务未就绪，请检查防火墙或增加 startupTimeoutMs'));
 }
 signal(signal,timeout=true){return AbortSignal.any([this.controller.signal,...(signal?[signal]:[]),...(timeout?[AbortSignal.timeout(this.config.requestTimeoutMs)]:[])]);}
 async fetch(path,options={},signal,timeout=true){
  if(!path.startsWith('/')||path.startsWith('//')||path.includes('://'))throw Error('Invalid local bridge path');
  return fetch(this.origin+path,{...options,headers:{...options.headers,'X-YZJ-Plugin-Key':this.secret},signal:this.signal(signal,timeout),redirect:'error'});
 }
 async json(path,{method='GET',body}={},signal){
  const response=await this.fetch('/api/'+path,{method,...(body===undefined?{}:{body:JSON.stringify(body),headers:{'Content-Type':'application/json'}})},signal);
  const data=await response.json();if(!response.ok)throw new BridgeError(data.error||'云之家请求失败',response.status,data);return data;
 }
 async target(id,signal){try{return (await this.json('recipient?recipientId='+encodeURIComponent(id),{},signal)).recipient;}catch(error){if(error.status!==404)throw error;}let data=await this.json('sync',{},signal);let item=data.items.find(x=>x.id===id||x.groupId===id);if(!item){data=await this.json('conversations?q='+encodeURIComponent(id),{},signal);item=data.items.find(x=>x.id===id||x.groupId===id);}if(!item)throw Error('未找到会话，请先使用云之家会话查询工具取得准确 ID');return item;}
 async sendText(id,text,clientMsgId=randomUUID(),signal){const recipient=await this.target(id,signal);return this.json('messages/text',{method:'POST',body:{recipient,text,clientMsgId}},signal);}
 async sendFile(id,name,data,image,clientMsgId=randomUUID(),signal){const recipient=await this.target(id,signal),body=new FormData();body.set('recipient',JSON.stringify(recipient));body.set('clientMsgId',clientMsgId);body.set('file',new Blob([data],{type:'application/octet-stream'}),name);const res=await this.fetch('/api/messages/'+(image?'image':'file'),{method:'POST',body},signal);const result=await res.json();if(!res.ok)throw new BridgeError(result.error,res.status,result);return result;}
 async close(){if(this.closed)return;this.closed=true;this.controller.abort();if(!this.child||!this.child.pid||this.child.exitCode!==null||this.child.signalCode!==null)return;const exit=once(this.child,'exit').catch(()=>{});this.child.kill('SIGTERM');const timer=setTimeout(()=>this.child?.kill('SIGKILL'),2000);timer.unref();await exit;clearTimeout(timer);}
}
