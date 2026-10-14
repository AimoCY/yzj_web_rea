import {execFile} from 'node:child_process';
import {basename} from 'node:path';
const probeCode="import sys,json; print(json.dumps({'yzjPython':list(sys.version_info[:3])}))";
export function probePython(command,args=[],timeout=2500){
 return new Promise((resolve,reject)=>execFile(command,[...args,'-c',probeCode],{timeout,maxBuffer:4096,windowsHide:true,encoding:'utf8',env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}},(error,stdout)=>{
  if(error)return reject(Error(error.code==='ENOENT'?'命令不存在':error.killed?'检测超时':'命令执行失败'));
  try{const version=JSON.parse(stdout.trim()).yzjPython;if(!Array.isArray(version)||version.length!==3||!version.every(Number.isInteger))throw Error();if(version[0]!==3||version[1]<9)return reject(Error('需要 Python 3.9 或更高的 Python 3 版本'));resolve(version);}catch{reject(Error('命令未返回 Python 版本，可能是 Windows 应用执行别名'));}
 }));
}
export async function resolvePython(configured='',{platform=process.platform,probe=probePython}={}){
 const explicit=configured.trim()&&!['auto'].includes(configured.trim());
 const commands=explicit?[configured.trim()]:platform==='win32'?['python','py','python3']:['python3','python','py'];
 const failures=[];
 for(const command of commands){
  // py is the Windows Python launcher. Keep executable paths intact; never use a shell.
  const args=/^py(?:\.exe)?$/i.test(basename(command.replaceAll('\\','/')))?['-3']:[];
  try{return {command,args,version:await probe(command,args)};}catch(error){failures.push(`${command}：${error.message}`);}
 }
 throw Error('无法找到可用的 Python 3.9+。'+failures.join('；')+'。请安装 Python 3，并将插件 python 配置为可用命令或可执行文件的绝对路径（py 启动器填写 py，不要填写 py -3）。');
}
export function startupDetail(stderr,secrets=[]){
 let text=String(stderr).replace(/\x1b\[[0-9;]*m/g,'').trim();
 for(const secret of secrets)if(secret)text=text.replaceAll(secret,'[已隐藏]');
 text=text.replace(/https?:\/\/\S+/g,'[URL 已隐藏]').replace(/(?:token|password|cookie|secret|authorization)\s*[:=]\s*\S+/gi,'[凭据已隐藏]');
 return text.split(/\r?\n/).filter(Boolean).slice(-3).join(' ').slice(0,500);
}
