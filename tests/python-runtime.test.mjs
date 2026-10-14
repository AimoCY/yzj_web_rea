import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolvePython,probePython,startupDetail} from '../plugin/python.mjs';
import {YunzhijiaBridge} from '../plugin/bridge.mjs';

test('Windows automatically skips unusable aliases and uses the Python launcher',async()=>{
 const calls=[];const runtime=await resolvePython('',{platform:'win32',probe:async(command,args)=>{calls.push([command,args]);if(command==='python')throw Error('命令未返回 Python 版本');return [3,14,0];}});
 assert.deepEqual(calls,[['python',[]],['py',['-3']]]);assert.equal(runtime.command,'py');
});
test('an explicit Python path is kept intact and never silently replaced',async()=>{
 const command='C:\\Program Files\\Python\\python.exe';let calls=0;
 assert.equal((await resolvePython(command,{platform:'win32',probe:async(name,args)=>{calls++;assert.equal(name,command);assert.deepEqual(args,[]);return [3,14,0];}})).command,command);
 assert.equal(calls,1);await assert.rejects(resolvePython(command,{probe:async()=>{throw Error('命令不存在');}}),/无法找到可用/);
 const launcher=await resolvePython('C:\\Program Files\\Python\\py.exe',{probe:async(_name,args)=>{assert.deepEqual(args,['-3']);return [3,14,0];}});assert.deepEqual(launcher.args,['-3']);
});
test('a command that exits successfully without running Python is rejected',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yzj-python-probe-'));
 try{const script=join(dir,'alias.cjs');await writeFile(script,'process.exit(0)');await assert.rejects(probePython(process.execPath,[script]),/未返回 Python 版本/);
 await writeFile(script,"process.stdout.write(JSON.stringify({yzjPython:[3,8,0]}))");await assert.rejects(probePython(process.execPath,[script]),/3.9/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('startup failure includes stderr and exit code while redacting credentials', {skip:process.platform==='win32'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yzj-python-failure-'));
 const executable=join(dir,'fake python');await writeFile(executable,"#!/usr/bin/env node\nif(process.argv.includes('-c'))console.log(JSON.stringify({yzjPython:[3,14,0]}));else{console.error('RuntimeError: startup broken token='+process.env.YZJ_PLUGIN_SECRET);process.exit(7)}\n");await chmod(executable,0o700);
 const bridge=new YunzhijiaBridge({python:executable,startupTimeoutMs:2000,requestTimeoutMs:1000});
 try{await assert.rejects(bridge.start(),error=>{assert.match(error.message,/退出码 7/);assert.match(error.message,/RuntimeError: startup broken/);assert(!error.message.includes(bridge.secret));return true;});assert(bridge.closed);}finally{await bridge.close();await rm(dir,{recursive:true,force:true});}
});
test('startup diagnostics hide URL credentials and the shared bridge keys',()=>{
 const detail=startupDetail('ValueError: secret=private https://host/?token=abc\nRuntimeError: shared-key',['shared-key']);assert(!detail.includes('private'));assert(!detail.includes('token=abc'));assert(!detail.includes('shared-key'));assert.match(detail,/RuntimeError/);
});
