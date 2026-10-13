import * as yunzhijia from '../../../plugin/index.mjs';
import {writeFile} from 'node:fs/promises';
export const inject=yunzhijia.inject;
export async function apply(ctx){
 let fiber;
 try{
  fiber=await ctx.plugin(yunzhijia,{mountPath:'/plugins/yzj-reload-test'});
  await fiber.restart();await fiber.restart();await fiber.dispose();fiber=undefined;
  // An actual WebServer registration must be possible after unload.
  const remove=ctx.webServer.register({kind:'prefix',path:'/plugins/yzj-reload-test',handler:(_req,res)=>res.end()});remove();
  fiber=await ctx.plugin(yunzhijia,{mountPath:'/plugins/yzj-reload-test'});await fiber.dispose();fiber=undefined;
  await writeFile(process.env.YZJ_TEST_RESULT,JSON.stringify({reloads:3,cleaned:true}));
 }catch(error){await fiber?.dispose().catch(()=>{});await writeFile(process.env.YZJ_TEST_RESULT,JSON.stringify({error:error.message}));}
}
