import {ImageCache} from './api/ui/media-cache';
import {renderMarkdown} from './api/ui/markdown';
import {reconcileMentions,mentionPayload,mentionQuery,looksMarkdown} from './api/ui/composer-utils';
import {safeLink,mergeMessages,richTokens,preview,timeLabel,bytes} from './api/ui/chat-utils';
import {initAutoReplySettings} from './api/ui/auto-reply-settings';
const API_BASE=new URL('./api/',import.meta.url).pathname;
const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
const shell=document.querySelector('.shell');
initAutoReplySettings({api,API_BASE});
let authenticated=false,me={},conversations=[],searchResults=[],recipient=null,images=[],busy=false;
let loginTimer,syncTimer,searchTimer,eventSource,syncBusy=false,syncQueued=false,searchSeq=0;
let emojis={},panelVisible=true;
let liveStatus='fallback',unreadOnly=false,listSignature='',chatGeneration=0,textRequest=null;
let drafts={},restoredId='',restoredText='',matches=[],matchIndex=0;
let selectedMentions=[],previousText='',mentionOptions=[],mentionIndex=0,mentionRange=null,mentionSeq=0,markdownPreview=false;
const histories=new Map(),cardCache=new Map(),memberCache=new Map();
try{const stored=JSON.parse(sessionStorage.getItem('yzj-chat-drafts')||'{}');drafts=stored.drafts||{};restoredId=stored.selected||'';const old=JSON.parse(sessionStorage.getItem('yzj-draft')||'null');if(!restoredId&&old){restoredId=old.recipientId||'';restoredText=old.text||'';}}catch{}

const imageCache=new ImageCache(),imageLoads=new Map(),imageVersions=new WeakMap();
const imageObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting){imageObserver.unobserve(entry.target);const load=imageLoads.get(entry.target);imageLoads.delete(entry.target);load?.();}}},{rootMargin:'200px'});
function pruneImageLoads(){for(const node of imageLoads.keys()){if(!node.isConnected){imageObserver.unobserve(node);imageLoads.delete(node);}}}
function cachedImage(node,url){
  const version=Symbol();imageVersions.set(node,version);
  if(!url.startsWith(API_BASE+'media?')){node.src=url;return;}
  const hit=imageCache.peek(url);if(hit){node.src=hit;return;}
  node.removeAttribute('src');
  const epoch=imageCache.epoch;
  const load=()=>imageCache.get(url).then(source=>{if(imageVersions.get(node)===version&&imageCache.epoch===epoch)node.src=source;}).catch(()=>{if(imageVersions.get(node)===version&&imageCache.epoch===epoch)node.dispatchEvent(new Event('error'));});
  if(node.loading==='lazy'){imageLoads.set(node,load);imageObserver.observe(node);}else load();
}

async function api(path,options={}){
  const response=await fetch(API_BASE+path,options);
  const data=await response.json();
  if(!response.ok){const error=Error(data.error||'请求失败');error.uncertain=!!data.uncertain;if(response.status===401||data.requiresLogin)expire(error.message);throw error;}
  return data;
}
function connection(text,status='fallback'){
  $('connection').textContent=text;liveStatus=status;
  $('light').style.background=status==='connected'?'#47b995':authenticated?'#e2b35d':'#bac5d5';
}
function expire(message){
  imageCache.clear();
  authenticated=false;eventSource?.close();clearTimeout(syncTimer);clearTimeout(loginTimer);
  $('login').hidden=false;$('conversation-view').hidden=true;shell.classList.remove('logged-in');
  $('login-status').textContent=message||'登录已过期，请重新扫码';connection('请重新登录');updateSend();
}
function avatar(node,url,name){
  node.replaceChildren();node.textContent=(name||'☁').slice(0,1);
  if(url){const img=el('img');img.alt='';img.loading='lazy';cachedImage(img,url);img.onerror=()=>{node.textContent=(name||'☁').slice(0,1);};node.append(img);node.firstChild?.nodeType===3&&node.firstChild.remove();}
}
function updateSend(){
  const canSend=authenticated&&recipient&&recipient.canSend!==false;
  $('send').disabled=busy||!canSend||images.some(x=>x.uncertain)||(!images.length&&!$('text').value.trim());
  $('text').disabled=busy||!canSend;$('choose-images').disabled=busy||!canSend;
  for(const id of ['choose-files','capture-screen','markdown-toggle'])$(id).disabled=busy||!canSend;
  $('mention-button').disabled=busy||!canSend||!recipient?.isGroup;
  $('search').disabled=!authenticated;$('refresh-list').disabled=!authenticated;
  $('text').placeholder=!recipient?'选择一个对话开始聊天':recipient.canSend===false?'此会话只支持查看消息':'输入消息…';
  for(const b of $('conversations').querySelectorAll('button'))b.disabled=busy;
}
function saveDraft(){
  if(recipient)drafts[recipient.id]={text:$('text').value,textRequest,mentions:selectedMentions};
  try{sessionStorage.setItem('yzj-chat-drafts',JSON.stringify({drafts,selected:recipient?.id||restoredId}));}catch{}
}
window.addEventListener('beforeunload',()=>{saveDraft();eventSource?.close();});
async function connected(){
  authenticated=true;shell.classList.add('logged-in');$('login').hidden=true;$('conversation-view').hidden=false;$('logout').hidden=false;clearTimeout(loginTimer);connection('正在同步会话');updateSend();
  try{me=await api('me');avatar($('me-avatar'),me.avatar,me.name);}catch(e){if(!authenticated)return;}
  await syncConversations(true);
  if(!recipient&&restoredId){const selected=conversations.find(x=>x.id===restoredId);if(selected){await selectConversation(selected);if(restoredText&&!$('text').value){$('text').value=restoredText;restoredText='';updateSend();}}}
  startEvents();scheduleSync();
}
async function loginPoll(){
  try{const status=await api('login/check');if(status.authenticated)return connected();$('login-status').textContent=status.errorCode===101?'请扫码并在手机上确认登录':status.error||'请用云之家 App 扫码';}
  catch(e){$('login-status').textContent=e.message+'，正在重试';}
  loginTimer=setTimeout(loginPoll,2500);
}
$('qr').onerror=()=>{clearTimeout(loginTimer);$('qr').hidden=true;$('qr-placeholder').hidden=false;$('login-status').textContent='二维码图片加载失败，请重新获取二维码；若仍失败，请检查网络或代理。';};
$('refresh').onclick=async()=>{
  clearTimeout(loginTimer);$('refresh').disabled=true;
  try{await api('login/start',{method:'POST'});$('qr').src=API_BASE+'login/qr-image?t='+Date.now();$('qr').hidden=false;$('qr-placeholder').hidden=true;$('login-status').textContent='请用云之家 App 扫码并确认登录';loginTimer=setTimeout(loginPoll,1500);}
  catch(e){$('login-status').textContent=e.message;}
  finally{$('refresh').disabled=false;}
};
$('logout').onclick=async()=>{imageCache.clear();eventSource?.close();await api('logout',{method:'POST'});sessionStorage.removeItem('yzj-chat-drafts');sessionStorage.removeItem('yzj-draft');location.reload();};

async function syncConversations(full=false){
  if(!authenticated)return;
  if(syncBusy){syncQueued=true;return;}
  syncBusy=true;
  try{
    const result=await api('sync'+(full?'?full=1':''));conversations=result.items;
    if(recipient){const updated=conversations.find(x=>x.id===recipient.id);if(updated){recipient=updated;renderHeader();}}
    $('total-unread').textContent=result.unread>999?'999+':result.unread;$('total-unread').hidden=!result.unread;
    $('unread-chats').textContent=conversations.filter(x=>x.unread>0).length||'';
    $('sync-time').textContent=new Date(result.syncedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
    if(liveStatus!=='connected')connection('自动同步中',liveStatus);
    renderConversations();updateSend();
  }catch(e){if(authenticated)connection('同步重试中');}
  finally{syncBusy=false;if(syncQueued){syncQueued=false;setTimeout(()=>syncConversations(),200);}}
}
function scheduleSync(){
  clearTimeout(syncTimer);if(!authenticated)return;
  syncTimer=setTimeout(async()=>{await syncConversations();await refreshCurrent();await refreshReadState();scheduleSync();},(document.hidden||!panelVisible)?15000:liveStatus==='connected'?10000:2500);
}
function startEvents(){
  eventSource?.close();eventSource=new EventSource(API_BASE+'events');
  eventSource.onmessage=event=>{try{const data=JSON.parse(event.data);connection(data.status==='connected'?'实时连接':data.reason||'自动同步中',data.status);if(['change','read'].includes(data.kind)){syncConversations();refreshCurrent();if(data.kind==='read')refreshReadState();}scheduleSync();}catch{}};
  eventSource.onerror=()=>{if(authenticated){connection('实时重连 · 自动同步中');scheduleSync();}};
}
window.addEventListener('online',()=>{if(authenticated){startEvents();syncConversations();refreshCurrent();}});
window.addEventListener('offline',()=>connection('网络已断开','offline'));
window.addEventListener('message',event=>{
  if(window.parent===window||event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='yzj-panel-visibility'||typeof event.data.visible!=='boolean')return;
  panelVisible=event.data.visible;
  if(authenticated){if(panelVisible){syncConversations();refreshCurrent();refreshReadState();}scheduleSync();}
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&authenticated){syncConversations();refreshCurrent();scheduleSync();}});
$('refresh-list').onclick=()=>syncConversations(true);
function renderConversations(){
  const query=$('search').value.trim().toLocaleLowerCase();
  let items=query?[...conversations.filter(x=>x.name.toLocaleLowerCase().includes(query)),...searchResults]:conversations;
  items=[...new Map(items.map(x=>[x.id,x])).values()];if(unreadOnly)items=items.filter(x=>x.unread>0);
  const signature=JSON.stringify([recipient?.id,query,unreadOnly,items]);if(signature===listSignature)return;listSignature=signature;
  const container=$('conversations'),scroll=container.scrollTop;container.replaceChildren();pruneImageLoads();
  for(const item of items){
    const button=el('button','conversation'+(recipient?.id===item.id?' chosen':'')+(item.pinned?' pinned':'')+(item.muted?' muted':''));button.dataset.id=item.id;button.setAttribute('aria-pressed',String(recipient?.id===item.id));button.ariaLabel=item.name;button.title=item.name+'\n'+preview(item);button.disabled=busy;
    const photo=el('span','avatar');avatar(photo,item.avatar,item.name);
    const body=el('span','conversation-content'),top=el('span','conversation-top'),bottom=el('span','conversation-bottom');
    top.append(el('span','conversation-name',item.name));if(item.pinned)top.append(el('span','pin-mark','置顶'));top.append(el('span','conversation-time',timeLabel(item.lastTime)));
    if(item.mention)bottom.append(el('span','mention','[有人@我]'));
    bottom.append(el('span','conversation-preview',preview(item)));
    if(item.unread>0)bottom.append(el('span','unread-badge',item.unread>99?'99+':item.unread));
    body.append(top,bottom);button.append(photo,body);button.onclick=()=>selectConversation(item);const wrapper=el('div');wrapper.role='listitem';wrapper.append(button);container.append(wrapper);
  }
  if(!items.length)container.append(el('p','empty',query?'没有找到匹配的联系人或群聊':unreadOnly?'没有未读会话':'暂无会话'));
  container.scrollTop=scroll;
}
$('search').oninput=()=>{
  clearTimeout(searchTimer);searchResults=[];renderConversations();const seq=++searchSeq;
  if(!$('search').value.trim())return;
  searchTimer=setTimeout(async()=>{try{const data=await api('conversations?q='+encodeURIComponent($('search').value));if(seq!==searchSeq)return;searchResults=data.items;renderConversations();}catch(e){if(authenticated)status(e.message,true);}},350);
};
$('all-tab').onclick=()=>{unreadOnly=false;$('all-tab').classList.add('active');$('unread-tab').classList.remove('active');renderConversations();};
$('unread-tab').onclick=()=>{unreadOnly=true;$('unread-tab').classList.add('active');$('all-tab').classList.remove('active');renderConversations();};
function renderHeader(){
  if(!recipient)return;avatar($('chat-avatar'),recipient.avatar,recipient.name);$('chat-name').textContent=recipient.name;
  $('chat-meta').textContent=recipient.isGroup?'群聊 · '+(recipient.tag||'协作会话'):recipient.groupType===3?'文件传输助手':recipient.canSend===false?'通知与订阅消息':'与 '+recipient.name+' 的对话';
  $('sending-target').textContent=images.length?'待发送 '+images.length+' 个附件':'';
  $('history-search-toggle').disabled=false;$('members-toggle').disabled=false;
  $('details-content').textContent=recipient.name+'\n'+(recipient.isGroup?'群组对话':'个人对话')+'\n'+(recipient.pinned?'已置顶\n':'')+(recipient.muted?'消息免打扰\n':'')+'未读消息：'+(recipient.unread||0)+'\n'+(recipient.canSend===false?'此会话只能查看消息':'');const members=memberCache.get(recipient.id);if(members)$('details-content').textContent+='\n\n'+(members.error||'成员（'+members.items.length+'）\n'+members.items.map(x=>x.name).join('、'));
}
async function selectConversation(item){
  if(busy)return;saveDraft();recipient=item;const generation=++chatGeneration;
  const draft=drafts[item.id]||{};$('text').value=draft.text||'';textRequest=draft.textRequest||null;
  selectedMentions=reconcileMentions($('text').value,$('text').value,draft.mentions||[]);previousText=$('text').value;closeMentions();renderDraftPreview();
  for(const image of images)URL.revokeObjectURL(image.url);images=[];renderImages();status('');
  $('details').hidden=true;$('history-search-bar').hidden=true;$('history-search').value='';$('history-error').hidden=true;$('new-messages').hidden=true;
  shell.classList.add('mobile-chat');renderHeader();renderConversations();updateSend();
  if(!histories.has(item.id))histories.set(item.id,{items:[],more:true,oldest:'',newest:'',loading:false,updating:false,loaded:false});
  const cache=histories.get(item.id);renderMessages(true);
  if(cache.loaded){refreshCurrent();refreshReadState();return;}
  cache.loading=true;renderMessages(true);
  try{const data=await api('history?recipientId='+encodeURIComponent(item.id));cache.items=mergeMessages([],data.items);cache.more=data.more;cache.oldest=data.oldest;cache.newest=data.newest;cache.loaded=true;if(data.groupId)item.groupId=data.groupId;if(generation===chatGeneration)renderMessages(true);}
  catch(e){if(generation===chatGeneration)historyError(e.message,()=>selectConversation(item));}
  finally{cache.loading=false;if(generation===chatGeneration){renderMessages(true);refreshReadState();}}
}
$('back').onclick=()=>shell.classList.remove('mobile-chat');
function historyError(text,retry){const node=$('history-error');node.hidden=false;node.replaceChildren(el('span','',text));const button=el('button','','重试');button.onclick=retry;node.append(button);}
async function loadOlder(){
  const target=recipient,cache=target&&histories.get(target.id),generation=chatGeneration;if(!cache||cache.loading||!cache.more)return;
  cache.loading=true;const scroll=$('messages').scrollTop,height=$('messages').scrollHeight;renderHistoryButton();
  try{const data=await api('history?'+new URLSearchParams({recipientId:target.id,before:cache.oldest,count:'50'}));cache.items=mergeMessages(data.items,cache.items);cache.more=data.more&&!!data.items.length&&data.oldest!==cache.oldest;cache.oldest=data.oldest||cache.oldest;if(generation===chatGeneration){$('history-error').hidden=true;renderMessages(false);$('messages').scrollTop=scroll+$('messages').scrollHeight-height;}}
  catch(e){if(generation===chatGeneration)historyError(e.message,loadOlder);}
  finally{cache.loading=false;if(generation===chatGeneration)renderHistoryButton();}
}
async function refreshCurrent(){
  const target=recipient,cache=target&&histories.get(target.id),generation=chatGeneration;
  if(!authenticated||!cache||!cache.loaded||cache.updating)return;
  cache.updating=true;let changed=false,count=0;const atBottom=isAtBottom(),position=$('messages').scrollTop;
  try{
    // Catch up in bounded pages; do not skip a burst larger than one page.
    while(count++<20){const after=cache.newest;const data=await api('history?'+new URLSearchParams({recipientId:target.id,after,count:'200'}));const merged=mergeMessages(cache.items,data.items);if(JSON.stringify(merged)!==JSON.stringify(cache.items)){cache.items=merged;changed=true;}if(data.newest)cache.newest=data.newest;if(data.items.length<200||data.newest===after)break;}
    if(changed&&generation===chatGeneration){renderMessages(atBottom);if(!atBottom){$('messages').scrollTop=position;$('new-messages').hidden=false;}$('history-error').hidden=true;}
  }catch(e){if(authenticated&&generation===chatGeneration)historyError('消息同步暂时失败：'+e.message,refreshCurrent);}
  finally{cache.updating=false;}
}
async function refreshReadState(){
  const target=recipient,cache=target&&histories.get(target.id),generation=chatGeneration;
  if(!authenticated||!cache?.loaded)return;
  try{const data=await api('read-state?recipientId='+encodeURIComponent(target.id));let changed=false;for(const row of cache.items){if(row.own&&Object.hasOwn(data.counts,row.id)&&row.unreadCount!==data.counts[row.id]){row.unreadCount=data.counts[row.id];changed=true;}}if(changed&&generation===chatGeneration){const bottom=isAtBottom(),scroll=$('messages').scrollTop;renderMessages(bottom);if(!bottom)$('messages').scrollTop=scroll;}}catch{}
}
function isAtBottom(){const node=$('messages');return node.scrollHeight-node.scrollTop-node.clientHeight<75;}
function scrollBottom(){const node=$('messages');node.scrollTop=node.scrollHeight;$('new-messages').hidden=true;}
$('new-messages').onclick=scrollBottom;
$('messages').onscroll=()=>{if(isAtBottom())$('new-messages').hidden=true;if($('messages').scrollTop<15)loadOlder();};
function renderHistoryButton(){const node=$('history-load'),cache=recipient&&histories.get(recipient.id);if(node&&cache){node.textContent=cache.loading?'正在加载历史消息…':cache.more?'加载更早的消息':'已到达最早的消息';node.disabled=cache.loading||!cache.more;}}
function renderMessages(bottom=false){
  const container=$('messages'),cache=recipient&&histories.get(recipient.id);container.replaceChildren();pruneImageLoads();
  if(!cache)return;
  const more=el('button','load-history');more.id='history-load';more.onclick=loadOlder;container.append(more);renderHistoryButton();
  if(!cache.items.length){container.append(el('p','empty',cache.loading?'正在加载消息…':cache.loaded?'暂无消息，发送第一条消息开始对话':'正在读取消息记录…'));return;}
  let lastTime='';
  for(const message of cache.items){
    const current=String(message.time),gap=new Date(current.replace(' ','T')+'+08:00')-new Date(lastTime.replace(' ','T')+'+08:00');
    if(!lastTime||gap>300000||current.slice(0,10)!==lastTime.slice(0,10))container.append(el('div','time-divider',timeLabel(current,true)));
    lastTime=current;container.append(renderMessage(message));
  }
  searchHistory(false);
  if(bottom)requestAnimationFrame(scrollBottom);
}
function renderMessage(message){
  const p=message.param||{};
  if([0,9].includes(message.type)||message.withdrawn){const node=el('div','system-message',message.content||p.desc||'系统通知');node.dataset.messageId=message.id;return node;}
  const row=el('article','message-row'+(message.own?' own':''));row.dataset.messageId=message.id;
  const picture=el('span','avatar message-avatar');avatar(picture,message.avatar,message.own?me.name:message.sender);
  const body=el('div','message-body'),bubble=el('div','bubble'+(message.attachments?.length?' attachment-bubble':''));
  body.append(el('div','message-sender',message.own?(me.name||'我'):message.sender));
  if(message.reply){const quote=el('div','quote',message.reply.sender+'：'+message.reply.text);quote.title='定位引用消息';quote.onclick=()=>jumpMessage(message.reply.id);if(message.reply.image){const image=el('img');cachedImage(image,message.reply.image);image.alt='引用图片';quote.append(image);}bubble.append(quote);}
  if(message.attachments?.length){for(const attachment of message.attachments)bubble.append(renderAttachment(attachment));}
  else if([2,23].includes(message.type)){const text=el('div','message-text');if(!message.segments?.length&&looksMarkdown(message.content)){renderMarkdown(text,message.content);const toggle=el('button','markdown-source-toggle','查看原文');let source=false;toggle.onclick=()=>{source=!source;toggle.textContent=source?'Markdown 展示':'查看原文';text.classList.toggle('markdown-body',!source);if(source)text.textContent=message.content;else renderMarkdown(text,message.content);};bubble.append(text,toggle);}else{renderRich(text,message);bubble.append(text);}}
  else if(message.type===25&&message.card){const card=el('div','adaptive-card');renderAdaptive(card,cardCache.get(message.id)||message.card);bubble.append(card);if(!cardCache.has(message.id))api('card?messageId='+encodeURIComponent(message.id)).then(data=>{cardCache.set(message.id,data.card);if(card.isConnected){card.replaceChildren();renderAdaptive(card,data.card);}}).catch(()=>{});renderFallback(bubble,message);}
  else if([6,7,17,21,22,24,25,27].includes(message.type))bubble.append(renderCard(message));
  else if(message.type===16){bubble.append(el('strong','','[聊天记录]'));renderFallback(bubble,message);}
  else if(message.type===1)bubble.append(el('span','',p.desc||message.content||'通话记录'));
  else if(message.type===3){bubble.append(el('span','','[语音] '+(message.content||'')));renderFallback(bubble,message);}
  else{bubble.append(el('span','',message.content||'[消息]'));renderFallback(bubble,message);}
  body.append(bubble,el('div','message-meta',timeLabel(message.time,true)+(message.own?(message.unreadCount===0?' · 已读':typeof message.unreadCount==='number'?' · '+message.unreadCount+' 人未读':''):'')));row.append(picture,body);return row;
}
function renderRich(node,message){
  for(const token of richTokens(message)){
    if(token.type==='image'&&token.url){const img=el('img','rich-image');img.alt='图片';img.loading='lazy';cachedImage(img,token.url);img.onclick=()=>showImage(token.original||token.url,'图片');node.append(img);}
    else if(token.type==='link'){const url=safeLink(token.url||token.data||token.text);if(url){const link=el('a','',token.text);link.href=url;link.target='_blank';link.rel='noopener noreferrer';node.append(link);}else node.append(document.createTextNode(token.text));}
    else if(['at','at_all'].includes(token.type))node.append(el('span','mention-token',token.text));
    else if(token.type==='bold')node.append(el('strong','',token.text));
    else linkify(node,token.text);
  }
}
function plainEmoji(node,text){let pos=0;for(const match of text.matchAll(/\[([^\[\]]+)\]/g)){node.append(document.createTextNode(text.slice(pos,match.index)));if(emojis[match[1]]){const img=el('img','default-emoji');img.src=emojis[match[1]];img.alt=match[0];img.title=match[1];node.append(img);}else node.append(document.createTextNode(match[0]));pos=match.index+match[0].length;}node.append(document.createTextNode(text.slice(pos)));}
function linkify(node,text){const regex=/https?:\/\/[^\s<>"']+/g;let pos=0;for(const match of text.matchAll(regex)){plainEmoji(node,text.slice(pos,match.index));const url=safeLink(match[0]);if(url){const a=el('a','',match[0]);a.href=url;a.target='_blank';a.rel='noopener noreferrer';node.append(a);}else node.append(document.createTextNode(match[0]));pos=match.index+match[0].length;}plainEmoji(node,text.slice(pos));}
function renderAttachment(a){
  if(a.kind==='image'){const image=el('img','message-image');image.alt=a.name;image.loading='lazy';cachedImage(image,a.url);if(a.width&&a.height){image.style.aspectRatio=a.width+'/'+a.height;image.style.width=Math.min(a.width,340)+'px';}image.onclick=()=>showImage(a.original||a.url,a.name,a.download);image.onload=()=>{if(isAtBottom())scrollBottom();};image.onerror=()=>{image.alt='图片暂时无法加载，点击查看原图';image.classList.add('unavailable');};return image;}
  if(['audio','video'].includes(a.kind)){const wrap=el('div');const player=el(a.kind,'message-media');player.controls=true;player.preload='none';player.src=a.original||a.url;wrap.append(player);if(a.kind==='audio'){player.style.width='250px';wrap.append(el('small','',a.name+(a.duration?' · '+a.duration+' 秒':'')));if(a.recognizedText)wrap.append(el('p','',a.recognizedText));}return wrap;}
  const card=el('a','file-card');card.href=a.download||a.original||a.url;card.download=a.name;
  const ext=a.name.split('.').pop();card.append(el('span','file-icon',ext.length<8?ext:'FILE'));const text=el('span');text.append(el('strong','',a.name),el('small','',bytes(a.size)+' · 点击下载'));card.append(text);
  if(/\.(md|markdown)$/i.test(a.name)){const wrap=el('div','document-attachment');const button=el('button','document-preview-button','预览 Markdown');button.onclick=async()=>{const key=new URL(a.download||a.original||a.url,location.href).searchParams.get('key');$('document-name').textContent=a.name;$('document-content').textContent='正在加载文档…';$('document-viewer').showModal();try{const data=await api('document?key='+encodeURIComponent(key||''));renderMarkdown($('document-content'),data.text);}catch(e){$('document-content').textContent=e.message;}};wrap.append(card,button);return wrap;}
  return card;
}
function renderAdaptive(node,data,depth=0){
  if(depth>12||!data)return;
  const items=Array.isArray(data)?data:Array.isArray(data.body)?data.body:[data];
  for(const item of items){
    if(!item||typeof item!=='object')continue;
    if(['TextBlock','RichTextBlock'].includes(item.type)){const text=el(item.weight==='Bolder'?'strong':'p','');renderRich(text,{content:item.text||(item.inlines||[]).map(x=>typeof x==='string'?x:x.text||'').join('')});node.append(text);}
    else if(item.type==='Image'&&item.url){const image=el('img','rich-image');image.alt=item.altText||'卡片图片';image.loading='lazy';cachedImage(image,item.url);node.append(image);}
    else if(item.type==='FactSet'){const list=el('dl');for(const fact of item.facts||[])list.append(el('dt','',fact.title||''),el('dd','',fact.value||''));node.append(list);}
    else if(['Container','Column','ColumnSet'].includes(item.type)){const wrap=el('div',item.type==='ColumnSet'?'card-columns':'');renderAdaptive(wrap,item.items||item.columns||[],depth+1);node.append(wrap);}
    else if(item.type==='Action.OpenUrl'){const url=safeLink(item.url);if(url){const link=el('a','card-action',item.title||'打开详情');link.href=url;link.target='_blank';link.rel='noopener noreferrer';node.append(link);}}
    else if(item.type==='ActionSet')renderAdaptive(node,item.actions||[],depth+1);
    else if(item.text||item.title)node.append(el('p','',String(item.text||item.title)));
    if(item.actions&&item.type!=='ActionSet')renderAdaptive(node,item.actions,depth+1);
  }
  if(!Array.isArray(data)&&data.actions)renderAdaptive(node,data.actions,depth+1);
}
function renderCard(message){
  const p=message.param||{},card=el('div','link-card');let details=p;
  try{if(message.type===21&&message.content.trim().startsWith('{'))details={...p,...JSON.parse(message.content)};}catch{}
  card.append(el('h4','',String(details.title||details.appName||message.content||'卡片消息')));
  const content=details.content||details.description||details.summary;if(typeof content==='string')card.append(el('p','',content));
  if(Array.isArray(details.list)){for(const item of details.list){const link=el('a','',String(item.title||item.text||item.name||''));const url=safeLink(item.url);if(url){link.href=url;link.target='_blank';link.rel='noopener noreferrer';}card.append(link,el('p','',String(item.text||'')));}}
  const link=safeLink(details.webpageUrl||details.url);if(link){const a=el('a','','打开详情 ↗');a.href=link;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}
  if(details.appName)card.append(el('small','',details.appName));
  renderFallback(card,message);return card;
}
function renderFallback(node,message){const data=message.param;if(!data||!Object.keys(data).length)return;const details=el('details','unknown-message');details.append(el('summary','','查看完整消息字段'),el('pre','',JSON.stringify(data,null,2)));node.append(details);}
function showImage(url,name,download){cachedImage($('full-image'),url);$('full-image').alt=name;$('image-name').textContent=name;$('image-download').href=download||url;$('image-download').download=name;$('image-viewer').showModal();}
$('document-close').onclick=()=>$('document-viewer').close();
$('image-close').onclick=()=>$('image-viewer').close();$('image-viewer').onclick=e=>{if(e.target===$('image-viewer'))$('image-viewer').close();};
function jumpMessage(id){const node=[...$('messages').querySelectorAll('[data-message-id]')].find(x=>x.dataset.messageId===id);if(!node){status('引用消息尚未加载，可以向前加载历史记录');return;}node.scrollIntoView({block:'center'});node.classList.add('highlight');setTimeout(()=>node.classList.remove('highlight'),1800);}
function searchHistory(jump=true){const query=$('history-search').value.trim().toLocaleLowerCase();matches=[];for(const node of $('messages').querySelectorAll('.message-row')){const row=histories.get(recipient?.id)?.items.find(x=>x.id===node.dataset.messageId);const searchable=[node.textContent,row?.content,row?.param?.name,row?.param?.title,...(row?.attachments||[]).map(x=>x.name)].filter(Boolean).join(' ').toLocaleLowerCase();const yes=!!query&&searchable.includes(query);node.classList.toggle('match',yes);if(yes)matches.push(node);}$('history-match').textContent=query?matches.length+' 条匹配':'';matchIndex=0;if(jump&&matches.length)matches[0].scrollIntoView({block:'center'});}
$('history-search-toggle').onclick=()=>{$('history-search-bar').hidden=!$('history-search-bar').hidden;if(!$('history-search-bar').hidden)$('history-search').focus();};$('history-search').oninput=()=>searchHistory();
$('search-close').onclick=()=>{$('history-search-bar').hidden=true;$('history-search').value='';searchHistory(false);};
$('search-next').onclick=()=>{if(matches.length){matchIndex=(matchIndex+1)%matches.length;matches[matchIndex].scrollIntoView({block:'center'});}};
$('search-prev').onclick=()=>{if(matches.length){matchIndex=(matchIndex-1+matches.length)%matches.length;matches[matchIndex].scrollIntoView({block:'center'});}};
$('members-toggle').onclick=async()=>{$('details').hidden=!$('details').hidden;renderHeader();if($('details').hidden)return;const target=recipient;try{const data=await api('members?recipientId='+encodeURIComponent(target.id));memberCache.set(target.id,data);if(recipient?.id===target.id)renderHeader();}catch(e){memberCache.set(target.id,{error:e.message});if(recipient?.id===target.id)renderHeader();}};$('details-close').onclick=()=>$('details').hidden=true;
function status(text,error=false){$('send-status').textContent=text;$('send-status').className=error?'error':'';}

async function addAttachments(files,forceFile=false){
  const list=[...files];await addImages(list.filter(x=>!forceFile&&['image/png','image/jpeg','image/gif','image/bmp'].includes(x.type)));
  if(busy||!recipient||recipient.canSend===false)return;
  for(const file of list.filter(x=>forceFile||!['image/png','image/jpeg','image/gif','image/bmp'].includes(x.type))){if(!file.size||file.size>32*1024*1024){status('单个附件需为 1 字节至 32 MiB',true);continue;}images.push({file,kind:'file',url:'',id:crypto.randomUUID()});}
  renderImages();updateSend();renderHeader();
}
async function addImages(files){
  if(busy||!recipient||recipient.canSend===false)return;
  for(const file of files){
    if(!['image/png','image/jpeg','image/gif','image/bmp'].includes(file.type)){status('请选择 PNG、JPG、GIF 或 BMP 图片',true);continue;}
    if(!file.size||file.size>32*1024*1024){status('单张图片暂限 32 MiB，不能选择空文件',true);continue;}
    const url=URL.createObjectURL(file),img=new Image();
    try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});images.push({file,kind:'image',url,width:img.naturalWidth,height:img.naturalHeight,id:crypto.randomUUID()});}
    catch{URL.revokeObjectURL(url);status('无法读取图片：'+file.name,true);}
  }
  renderImages();updateSend();renderHeader();
}
function renderImages(){
  $('previews').replaceChildren();
  for(const item of images){
    const box=el('div','preview'),image=el(item.kind==='file'?'div':'img',item.kind==='file'?'queue-file-icon':'');if(item.kind==='file')image.textContent='FILE';else{image.src=item.url;image.alt=item.file.name;}const caption=el('small','',item.file.name+' · '+bytes(item.file.size));caption.title=caption.textContent;
    const remove=el('button','','×');remove.ariaLabel='移除'+item.file.name;remove.disabled=busy;remove.onclick=()=>{images=images.filter(x=>x!==item);URL.revokeObjectURL(item.url);renderImages();updateSend();renderHeader();};box.append(image,caption,remove);
    if(item.kind!=='file'&&item.file.type!=='image/gif'&&(item.file.size>=8388608||item.width>=5000||item.height>=5000))box.append(el('small','warn','将以文件形式发送'));
    if(item.uncertain){const check=el('button','receipt','检查发送回执');check.disabled=busy;check.onclick=async()=>{try{await api('messages/receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientMsgId:item.id})});images=images.filter(x=>x!==item);URL.revokeObjectURL(item.url);renderImages();updateSend();refreshCurrent();syncConversations();}catch(e){status(e.message,true);}};box.append(check);}
    $('previews').append(box);
  }
}
$('choose-files').onclick=()=>{if(!busy)$('attachments').click();};$('attachments').onchange=async()=>{await addAttachments($('attachments').files,true);$('attachments').value='';};
$('choose-images').onclick=()=>{if(!busy)$('files').click();};$('files').onchange=async()=>{await addImages($('files').files);$('files').value='';};
for(const event of ['dragenter','dragover'])$('composer').addEventListener(event,e=>{e.preventDefault();if(recipient&&!busy)$('composer').classList.add('dragover');});
for(const event of ['dragleave','drop'])$('composer').addEventListener(event,e=>{e.preventDefault();$('composer').classList.remove('dragover');});
$('composer').addEventListener('drop',e=>addAttachments(e.dataTransfer.files));document.addEventListener('paste',e=>{if(!recipient||busy)return;const files=[...e.clipboardData.items].filter(x=>x.kind==='file').map(x=>x.getAsFile());if(files.length){e.preventDefault();addAttachments(files);}});
$('text').oninput=()=>{selectedMentions=reconcileMentions(previousText,$('text').value,selectedMentions);previousText=$('text').value;updateSend();saveDraft();renderDraftPreview();if(!eComposition)updateMentions();};let eComposition=false;$('text').addEventListener('compositionstart',()=>{eComposition=true;closeMentions();});$('text').addEventListener('compositionend',()=>{eComposition=false;updateMentions();});$('text').onkeydown=e=>{if(!e.isComposing&&!$('mention-menu').hidden){if(mentionOptions.length&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();mentionIndex=(mentionIndex+(e.key==='ArrowDown'?1:-1)+mentionOptions.length)%mentionOptions.length;renderMentionMenu();return;}if(e.key==='Enter'&&mentionOptions.length){e.preventDefault();chooseMention(mentionOptions[mentionIndex]);return;}if(e.key==='Escape'){e.preventDefault();closeMentions();return;}}if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!$('send').disabled)$('send').click();}};
$('send').onclick=async()=>{
  if(busy||$('send').disabled)return;busy=true;updateSend();renderImages();const target={...recipient},batch=[...images];let current=null;
  try{
    for(let index=0;index<batch.length;index++){const item=current=batch[index];status(`正在上传并发送 ${index+1}/${batch.length}：${item.file.name}`);const body=new FormData();body.append('recipient',JSON.stringify(target));body.append('clientMsgId',item.id);body.append('file',item.file);const receipt=await api(item.kind==='file'?'messages/file':'messages/image',{method:'POST',body});images=images.filter(x=>x!==item);URL.revokeObjectURL(item.url);if(receipt.groupId)recipient.groupId=receipt.groupId;renderImages();await refreshCurrent();}
    current=null;const text=$('text').value.trim();
    if(text){const mentions=mentionPayload($('text').value,selectedMentions),key=JSON.stringify([target.id,text,mentions]);if(!textRequest||textRequest.key!==key)textRequest={key,id:crypto.randomUUID()};status('正在发送…');const receipt=await api('messages/text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipient:target,text,mentions,clientMsgId:textRequest.id})});if(receipt.groupId)recipient.groupId=receipt.groupId;$('text').value='';textRequest=null;selectedMentions=[];previousText='';closeMentions();renderDraftPreview();saveDraft();}
    status('已发送');$('send-status').className='success';await refreshCurrent();await syncConversations();scrollBottom();
  }catch(e){if(current&&e.uncertain)current.uncertain=true;status(e.message,true);}
  finally{busy=false;renderImages();updateSend();renderHeader();}
};
function renderDraftPreview(){
 $('markdown-preview').hidden=!markdownPreview;
 if(markdownPreview)renderMarkdown($('markdown-preview'),$('text').value||'Markdown 预览：输入标题、列表或代码块…');
 $('markdown-toggle').setAttribute('aria-pressed',String(markdownPreview));
}
$('markdown-toggle').onclick=()=>{markdownPreview=!markdownPreview;renderDraftPreview();};
function closeMentions(){mentionSeq++;$('mention-menu').hidden=true;mentionOptions=[];mentionRange=null;}
function renderMentionMenu(){
 const menu=$('mention-menu');menu.replaceChildren();
 if(!mentionOptions.length){menu.append(el('p','mention-empty','没有匹配的群成员'));return;}
 mentionOptions.forEach((member,index)=>{const button=el('button','mention-option'+(index===mentionIndex?' selected':''));button.role='option';button.setAttribute('aria-selected',String(index===mentionIndex));const photo=el('span','avatar');avatar(photo,member.avatar,member.name);button.append(photo,el('span','',member.name));button.onmousedown=e=>e.preventDefault();button.onclick=()=>chooseMention(member);menu.append(button);});
 menu.children[mentionIndex]?.scrollIntoView({block:'nearest'});
}
async function updateMentions(){
 const input=$('text'),range=mentionQuery(input.value,input.selectionStart);
 if(!recipient?.isGroup||busy||!range||selectedMentions.some(x=>x.start===range.start&&input.selectionStart>=x.end)){closeMentions();return;}
 const seq=++mentionSeq,target=recipient;mentionRange=range;mentionIndex=0;mentionOptions=[];$('mention-menu').hidden=false;$('mention-menu').replaceChildren(el('p','mention-empty','正在读取群成员…'));
 try{
  let data=memberCache.get(target.id);if(!data?.items){data=await api('members?recipientId='+encodeURIComponent(target.id));memberCache.set(target.id,data);}
  if(seq!==mentionSeq||recipient?.id!==target.id)return;
  mentionOptions=data.items.filter(x=>x.id&&x.name?.toLocaleLowerCase().includes(range.query.trim().toLocaleLowerCase())).slice(0,50);renderMentionMenu();
 }catch(e){if(seq===mentionSeq)$('mention-menu').replaceChildren(el('p','mention-empty',e.message));}
}
function chooseMention(member){
 const range=mentionRange;if(!range)return;
 const input=$('text'),before=input.value,label='@'+member.name.trim();
 input.setRangeText(label+' ',range.start,range.end,'end');
 selectedMentions=reconcileMentions(before,input.value,selectedMentions);
 selectedMentions.push({id:member.id,name:member.name.trim(),start:range.start,end:range.start+label.length});previousText=input.value;closeMentions();input.focus();updateSend();saveDraft();renderDraftPreview();
}
$('mention-button').onclick=()=>{const input=$('text'),before=input.value;input.focus();const start=input.selectionStart,prefix=start&& !/\s/.test(before[start-1])?' @':'@';input.setRangeText(prefix,input.selectionStart,input.selectionEnd,'end');selectedMentions=reconcileMentions(before,input.value,selectedMentions);previousText=input.value;saveDraft();updateSend();renderDraftPreview();updateMentions();};
$('text').addEventListener('click',updateMentions);
document.addEventListener('pointerdown',e=>{if(!$('mention-menu').contains(e.target)&&!['mention-button','text'].includes(e.target.id))closeMentions();});

let captureImage=null,captureRect=null,captureStart=null;
const captureCanvas=$('screenshot-canvas');
function capturePoint(event){const bounds=captureCanvas.getBoundingClientRect();return {x:Math.max(0,Math.min(captureCanvas.width,(event.clientX-bounds.left)*captureCanvas.width/bounds.width)),y:Math.max(0,Math.min(captureCanvas.height,(event.clientY-bounds.top)*captureCanvas.height/bounds.height))};}
function drawCapture(){
 if(!captureImage)return;const ctx=captureCanvas.getContext('2d');ctx.clearRect(0,0,captureCanvas.width,captureCanvas.height);ctx.drawImage(captureImage,0,0);
 const r=captureRect;ctx.fillStyle='#11182766';ctx.fillRect(0,0,captureCanvas.width,r.y);ctx.fillRect(0,r.y+r.h,captureCanvas.width,captureCanvas.height-r.y-r.h);ctx.fillRect(0,r.y,r.x,r.h);ctx.fillRect(r.x+r.w,r.y,captureCanvas.width-r.x-r.w,r.h);ctx.strokeStyle='#3478f6';ctx.lineWidth=Math.max(2,captureCanvas.width/captureCanvas.clientWidth*2);ctx.strokeRect(r.x,r.y,r.w,r.h);$('screenshot-size').textContent=Math.round(r.w)+' × '+Math.round(r.h);$('screenshot-add').disabled=r.w<2||r.h<2;
}
captureCanvas.onpointerdown=e=>{captureStart=capturePoint(e);captureCanvas.setPointerCapture(e.pointerId);};
captureCanvas.onpointermove=e=>{if(!captureStart)return;const point=capturePoint(e);captureRect={x:Math.min(captureStart.x,point.x),y:Math.min(captureStart.y,point.y),w:Math.abs(point.x-captureStart.x),h:Math.abs(point.y-captureStart.y)};drawCapture();};
captureCanvas.onpointerup=()=>{captureStart=null;};captureCanvas.onpointercancel=()=>{captureStart=null;};
$('capture-screen').onclick=async()=>{
 if(busy||!recipient)return;if(!navigator.mediaDevices?.getDisplayMedia){status('此浏览器不支持屏幕截图；可使用系统截图后粘贴到输入框。',true);return;}
 let stream;const target=recipient.id;$('capture-screen').disabled=true;
 try{
  stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});const video=document.createElement('video');video.muted=true;video.srcObject=stream;await video.play();
  await Promise.race([new Promise(resolve=>{if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(resolve);else setTimeout(resolve,200);}),new Promise(resolve=>setTimeout(resolve,2500))]);
  if(recipient?.id!==target||!authenticated)return;
  if(!video.videoWidth||!video.videoHeight)throw Error('未获取到截图画面');
  captureImage=document.createElement('canvas');captureImage.width=video.videoWidth;captureImage.height=video.videoHeight;captureImage.getContext('2d').drawImage(video,0,0);captureCanvas.width=video.videoWidth;captureCanvas.height=video.videoHeight;captureRect={x:0,y:0,w:video.videoWidth,h:video.videoHeight};$('screenshot-dialog').showModal();drawCapture();
 }catch(e){status(['NotAllowedError','AbortError'].includes(e.name)?'截图已取消；也可使用系统截图后粘贴。':'截图失败：'+e.message,true);}
 finally{stream?.getTracks().forEach(track=>track.stop());updateSend();}
};
$('screenshot-close').onclick=()=>$('screenshot-dialog').close();
$('screenshot-dialog').addEventListener('close',()=>{captureImage=null;captureStart=null;captureCanvas.width=1;captureCanvas.height=1;});
$('screenshot-add').onclick=async()=>{
 if(!captureImage||busy||!recipient)return;
 const r=captureRect,canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(r.w));canvas.height=Math.max(1,Math.round(r.h));canvas.getContext('2d').drawImage(captureImage,r.x,r.y,r.w,r.h,0,0,canvas.width,canvas.height);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob){status('截图生成失败',true);return;}
 $('screenshot-dialog').close();await addImages([new File([blob],'screenshot-'+new Date().toISOString().replace(/[:.]/g,'-')+'.png',{type:'image/png'})]);
};

api('ui/emojis').then(data=>{emojis=data;}).catch(()=>{});
api('status').then(s=>{if(s.authenticated)connected();else if(s.pendingToken){$('qr').src=API_BASE+'login/qr-image?t='+Date.now();$('qr').hidden=false;$('qr-placeholder').hidden=true;loginPoll();}}).catch(e=>$('login-status').textContent=e.message);
