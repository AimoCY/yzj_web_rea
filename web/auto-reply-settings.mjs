export function initAutoReplySettings({api,API_BASE}){
 const $=id=>document.getElementById(id),shell=document.querySelector('.shell');let config,accountId='',targets=new Map(),selected=new Set(),prompts={},loading=false,queryVersion=0,remoteMatches=new Set(),searchTimer;
 const status=(text,error=false)=>{$('auto-status').textContent=text;$('auto-status').className=error?'error':'';};
 const show=open=>{$('auto-reply-settings').hidden=!open;$('chat-main').hidden=open;shell.classList.toggle('auto-settings-open',open);$('auto-reply-nav').classList.toggle('rail-active',open);$('chat-nav').classList.toggle('rail-active',!open);};
 const render=()=>{
  const container=$('auto-recipients');container.replaceChildren();const query=$('auto-search').value.trim().toLowerCase();
  const entries=[...targets.values()].filter(t=>selected.has(t.id)||!query||t.name.toLowerCase().includes(query)||remoteMatches.has(t.id));
  for(const target of entries){
   const row=document.createElement('div');row.className='auto-recipient';const label=document.createElement('label');label.className='auto-switch';const check=document.createElement('input');check.type='checkbox';check.checked=selected.has(target.id);check.dataset.recipient=target.id;
   label.append(check,document.createTextNode(target.name+(target.isGroup?' · 群聊（仅 @ 本人）':' · 联系人')));row.append(label);
   const prompt=document.createElement('textarea');prompt.rows=2;prompt.maxLength=8000;prompt.placeholder='此会话的单独提示词（留空使用通用提示词）';prompt.value=prompts[target.id]||'';prompt.hidden=!check.checked;prompt.setAttribute('aria-label',target.name+'的回复提示词');
   check.onchange=()=>{if(check.checked)selected.add(target.id);else selected.delete(target.id);prompt.hidden=!check.checked;};prompt.oninput=()=>{prompts[target.id]=prompt.value;};row.append(prompt);container.append(row);
  }
  if(!entries.length)container.textContent='暂无匹配会话，可以搜索联系人或群聊。';
 };
 async function load(){
  if(loading)return;loading=true;$('auto-save').disabled=true;status('正在加载配置…');
  try{
   const data=await api('auto-reply');config=data.config;accountId=data.accountId;selected=new Set(config.recipients);prompts={...config.recipientPrompts};targets.clear();
   let listError='';try{const chats=await api('sync');for(const t of chats.items||[])if(t.canSend!==false)targets.set(t.id,t);}catch(e){listError=e.message;}
   for(const id of selected)if(!targets.has(id))targets.set(id,{id,name:id,isGroup:false});
   $('auto-enabled').checked=config.enabled;$('auto-prompt').value=config.prompt||'';$('auto-interval').value=config.pollIntervalMs;$('auto-timeout').value=config.replyTimeoutMs;$('auto-concurrency').value=config.maxConcurrent;$('auto-tools').value=config.allowedTools.join(', ');render();status(listError?'配置已加载，会话列表暂不可用：'+listError:config.enabled?'自动回复已开启':'自动回复已关闭',!!listError);
  }catch(e){config=null;status(e.status===404?'自动回复配置接口未加载，请完整重启 Harness 后重新登录并打开配置；仅刷新页面或重新启用插件可能仍使用旧后端。':e.message,true);}finally{loading=false;$('auto-save').disabled=!config;}
 }
 $('auto-reply-nav').onclick=()=>{show(true);load();};$('chat-nav').onclick=() =>show(false);$('auto-reply-back').onclick=()=>show(false);$('auto-reload').onclick=load;
 $('auto-search').oninput=()=>{clearTimeout(searchTimer);queryVersion++;remoteMatches.clear();render();if($('auto-search').value.trim())searchTimer=setTimeout(()=>$('auto-search-button').click(),350);};
 $('auto-search').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();$('auto-search-button').click();}};
 $('auto-search-button').onclick=async()=>{clearTimeout(searchTimer);const version=++queryVersion;try{const result=await api('conversations?q='+encodeURIComponent($('auto-search').value.trim()));if(version!==queryVersion)return;remoteMatches=new Set();for(const t of result.items||[])if(t.canSend!==false){targets.set(t.id,t);remoteMatches.add(t.id);}render();}catch(e){status(e.message,true);}};
 $('auto-reply-form').onsubmit=async event=>{
  event.preventDefault();if(loading||!config)return;loading=true;$('auto-save').disabled=true;status('正在保存并应用…');
  const recipients=[...selected],recipientPrompts=Object.fromEntries(recipients.map(id=>[id,prompts[id]||'']));
  const next={enabled:$('auto-enabled').checked,recipients,mentionOnly:true,prompt:$('auto-prompt').value,recipientPrompts,pollIntervalMs:Number($('auto-interval').value),replyTimeoutMs:Number($('auto-timeout').value),maxConcurrent:Number($('auto-concurrency').value),allowedTools:$('auto-tools').value.split(',').map(x=>x.trim()).filter(Boolean)};
  try{const result=await api('auto-reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId,config:next})});config=result.config;selected=new Set(config.recipients);prompts={...config.recipientPrompts};for(const t of result.targets||[])targets.set(t.id,t);render();status(config.enabled?'已保存并开启自动回复':'已保存，自动回复已关闭');}catch(e){status(e.message,true);}finally{loading=false;$('auto-save').disabled=false;}
 };
 fetch(API_BASE.replace(/api\/$/,'')+'plugin-status').then(response=>{if(response.ok){$('auto-reply-nav').hidden=false;shell.classList.add('plugin-settings-available');}}).catch(()=>{});
}
