import React from 'react';
export const name='yunzhijia';
export const inject=['slots','locale','layout'];
export function apply(ctx){
 ctx.effect(()=>ctx.locale.register('yunzhijia',{zh:{panel:'云之家'},en:{panel:'Yunzhijia'}}));
 const t=ctx.locale.bind('yunzhijia');
 let mount=globalThis.__YZJ_PLUGIN__?.mountPath||'/plugins/yzj';
 if(!/^\/[a-zA-Z0-9/_-]+$/.test(mount))mount='/plugins/yzj';
 const Page=()=>React.createElement('iframe',{src:mount+'/',title:'云之家聊天',allow:'display-capture; clipboard-write',style:{width:'100%',height:'100%',border:0,display:'block'}});
 const Icon=({size=20})=>React.createElement('span',{style:{fontSize:size},'aria-hidden':true},'☁');
 ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'yunzhijia',locale:'yunzhijia'},Page));
 ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'yunzhijia',order:20,label:()=>t('panel'),locale:'yunzhijia'},Icon));
}
