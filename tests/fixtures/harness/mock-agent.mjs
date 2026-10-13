// Loaded only by the isolated Harness runtime test; no model/network credentials.
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
import {createResponder,Config} from '../../../plugin/index.mjs';
import {writeFile} from 'node:fs/promises';
class MockAdapter extends LlmAdapter{
 async resolveModel(provider,id){return {provider,id,name:id};}
 async *stream(){yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'synthetic reply'};yield {type:'block-end',index:0,block:{type:'text',text:'synthetic reply'}};yield {type:'finish',reason:{kind:'stop'}};}
}
export const inject=['agents','agentLoop','tools','llm','agentDefaultModel'];
export async function apply(ctx){
 const handles=new Map();ctx.llm.registerAdapter(['yunzhijia-test'],new MockAdapter());
 await ctx.effect(async()=>{
  try{const respond=createResponder(ctx,Config({}),handles,()=>({provider:'yunzhijia-test',model:'mock'}));const result=await respond({id:'demo',name:'Synthetic Demo'},'hello','synthetic-account',AbortSignal.timeout(15000));await writeFile(process.env.YZJ_TEST_RESULT,JSON.stringify({result,agents:handles.size}));}
  catch(error){await writeFile(process.env.YZJ_TEST_RESULT,JSON.stringify({error:error.message}));}
  return async()=>{await Promise.allSettled([...handles.values()].map(h=>h.dispose()));};
 });
}
