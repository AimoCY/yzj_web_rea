import React from 'react';
export const name='yunzhijia';
export const inject=['slots','locale','layout'];
export function apply(ctx){
 ctx.effect(()=>ctx.locale.register('yunzhijia',{zh:{panel:'云之家'},en:{panel:'Yunzhijia'}}));
 const t=ctx.locale.bind('yunzhijia');
 let mount=globalThis.__YZJ_PLUGIN__?.mountPath||'/plugins/yzj';
 if(!/^\/[a-zA-Z0-9/_-]+$/.test(mount))mount='/plugins/yzj';
 // The main slot unmounts on navigation. Keep the browsing context in the
 // persistent shell overlay and use the main slot only to measure its seat.
 let anchor=null,snapshot={visited:false,rect:null};const listeners=new Set();
 const subscribe=listener=>{listeners.add(listener);return ()=>listeners.delete(listener);};
 const publish=rect=>{snapshot={visited:snapshot.visited||!!rect,rect};for(const listener of listeners)listener();};
 const Page=()=>{
  const ref=React.useRef(null);
  React.useLayoutEffect(()=>{
   const node=ref.current;anchor=node;
   const measure=()=>{if(anchor!==node)return;const r=node.getBoundingClientRect();publish({left:r.left,top:r.top,width:r.width,height:r.height});};
   const observer=new ResizeObserver(measure);observer.observe(node);window.addEventListener('resize',measure);measure();
   return ()=>{observer.disconnect();window.removeEventListener('resize',measure);if(anchor===node){anchor=null;publish(null);}};
  },[]);
  return React.createElement('div',{ref,style:{width:'100%',height:'100%','minHeight':0}});
 };
 const ChatSurface=()=>{
  const state=React.useSyncExternalStore(subscribe,()=>snapshot,()=>snapshot);
  const ref=React.useRef(null),visible=!!state.rect;
  const notify=()=>ref.current?.contentWindow?.postMessage({type:'yzj-panel-visibility',visible},window.location.origin);
  React.useEffect(notify,[visible]);
  if(!state.visited)return null;
  const rect=state.rect;
  return React.createElement('iframe',{ref,onLoad:notify,src:mount+'/',title:'云之家聊天',allow:'display-capture; clipboard-write',style:{position:'fixed',left:rect?.left||0,top:rect?.top||0,width:rect?.width||0,height:rect?.height||0,border:0,display:rect?'block':'none'}});
 };
 const Icon=({size=20})=>React.createElement('span',{style:{fontSize:size},'aria-hidden':true},'☁');
 ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'yunzhijia',locale:'yunzhijia'},Page));
 ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'yunzhijia-chat-surface',order:0,locale:'yunzhijia'},ChatSurface));
 ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'yunzhijia',order:20,label:()=>t('panel'),locale:'yunzhijia'},Icon));
}
