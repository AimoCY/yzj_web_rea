import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const root=fileURLToPath(new URL('../',import.meta.url));
test('official Harness creates an isolated auto-reply Agent using a mock model', {timeout:35000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yzj-harness-test-')),patch=join(dir,'patch.yml'),resultFile=join(dir,'result.json');
 await writeFile(patch,'- insert:\n    - id: yunzhijia\n      name: '+JSON.stringify(join(root,'plugin/index.mjs'))+'\n    - id: mock-agent\n      name: '+JSON.stringify(join(root,'tests/fixtures/harness/mock-agent.mjs'))+'\n');
 const child=spawn(process.execPath,[fileURLToPath(import.meta.resolve('@deepseek-ai/dsh/lib/bin.js')),'web','--patch',patch,'--no-open','--port','0'],{cwd:root,env:{...process.env,DSH_HOME:join(dir,'home'),YZJ_TEST_RESULT:resultFile},stdio:'ignore'});
 try{
  let value;
  for(let i=0;i<200;i++){try{value=JSON.parse(await readFile(resultFile,'utf8'));break;}catch{}if(child.exitCode!==null)throw Error('Harness exited before verification');await new Promise(r=>setTimeout(r,100));}
  assert.deepEqual(value,{result:'synthetic reply',agents:2,promptsVerified:true});
 }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}await rm(dir,{recursive:true,force:true});}
});
