import test from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../plugin/index.mjs';
function fixture(failTool=false){
 const routes=new Map(),tools=new Map(),listeners=new Set(),cleanups=[];
 const ctx={logger:{warn(){}},agents:{},agentDefaultModel:{},systemPrompt:{},connection:{requestRejection(){}},
  effect:async init=>{cleanups.push(await init());},
  on:()=>{const marker={};listeners.add(marker);return ()=>listeners.delete(marker);},
  webServer:{register:route=>{if(routes.has(route.path))throw Error('duplicate route');routes.set(route.path,route);return ()=>routes.delete(route.path);}},
  tools:{register:tool=>{if(failTool)throw Error('registration failed');if(tools.has(tool.name))throw Error('duplicate tool');tools.set(tool.name,tool);return ()=>tools.delete(tool.name);}}
 };
 return {ctx,routes,tools,listeners,cleanups};
}
test('disable and re-enable releases route, tools and bootstrap registrations',async()=>{
 const f=fixture();
 for(let i=0;i<3;i++){
  await apply(f.ctx,{startupTimeoutMs:5000});
  assert.equal(f.routes.size,1);assert.equal(f.tools.size,8);assert.equal(f.listeners.size,1);
  const close=f.cleanups.pop();await close();await close();
  assert.equal(f.routes.size,0);assert.equal(f.tools.size,0);assert.equal(f.listeners.size,0);
 }
});
test('activation rollback removes a route registered before a later failure',async()=>{
 const f=fixture(true);
 await assert.rejects(apply(f.ctx,{startupTimeoutMs:5000}),/registration failed/);
 assert.equal(f.routes.size,0);assert.equal(f.listeners.size,0);
});
