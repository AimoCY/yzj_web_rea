export function initAutoReplySettings({api,API_BASE}){
 const $=id=>document.getElementById(id),shell=document.querySelector('.shell');let config,accountId='',targets=new Map(),selected=new Set(),prompts={},loading=false,queryVersion=0,remoteMatches=new Set(),searchTimer;
 const status=(text,error=false)=>{$('auto-status').textContent=text;$('auto-status').className=error?'error':'';};
 const show=open=>{$('auto-reply-settings').hidden=!open;$('chat-main').hidden=open;shell.classList.toggle('auto-settings-open',open);$('auto-reply-nav').classList.toggle('rail-active',open);$('chat-nav').classList.toggle('rail-active',!open);};
 const runtimeNodes=new Map();let runtime={},runtimeTimer,opened=false;
 const element=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const changed=()=>{if(config)status('有未保存的修改，请点击保存并应用');};
 const updateRuntime=()=>{
  $('auto-runtime-summary').textContent=!runtime.connected?'云之家尚未连接，登录后开始监控':!runtime.enabled?'自动回复已暂停':`运行中 · 正在处理 ${runtime.processing||0} 个会话 · 累计失败 ${runtime.errors||0} 次`;
  for(const [id,node] of runtimeNodes){const state=runtime.conversations?.[id];node.textContent=state?.detail||(config?.enabled?'等待建立监控基线':'全局开关已关闭');node.classList.toggle('error',state?.result==='error');}
 };
 const runtimePath=API_BASE.replace(/api\/$/,'')+'plugin-status';
 async function pollRuntime(){clearTimeout(runtimeTimer);if(!opened)return;try{const response=await fetch(runtimePath);if(response.ok){runtime=await response.json();updateRuntime();}}catch{}if(opened)runtimeTimer=setTimeout(pollRuntime,4000);}
 const render=()=>{
  const container=$('auto-recipients'),configured=$('auto-configured');container.replaceChildren();configured.replaceChildren();runtimeNodes.clear();const query=$('auto-search').value.trim().toLowerCase(),kind=$('auto-kind').value;
  const match=t=>(kind==='all'||(kind==='group')===!!t.isGroup)&&(!query||String(t.name||'').toLowerCase().includes(query)||remoteMatches.has(t.id));
  const entries=[...targets.values()];$('auto-configured-count').textContent=selected.size+' 个';let count=0;
  for(const target of entries){
   const chosen=selected.has(target.id);if(!chosen&&!match(target))continue;
   const row=element('div','auto-recipient'+(chosen?' auto-chosen':'')),head=element('div','auto-recipient-heading'),label=element('label','auto-switch'),check=element('input');check.type='checkbox';check.checked=chosen;check.dataset.recipient=target.id;
   label.append(check,element('strong','',target.name||target.id));head.append(label,element('span','auto-type',target.isGroup?'群聊 · 仅 @ 本人':'联系人'));row.append(head);
   check.onchange=()=>{if(check.checked)selected.add(target.id);else selected.delete(target.id);render();changed();};
   if(chosen){
    const persisted=config?.recipients.includes(target.id);row.append(element('span','auto-state-badge',persisted?(config.enabled?'已启用':'已配置 · 全局暂停'):'待保存'));
    const diagnostic=element('p','auto-recipient-runtime');row.append(diagnostic);runtimeNodes.set(target.id,diagnostic);
    const promptLabel=element('label','','单独回复提示词'),prompt=element('textarea');prompt.rows=2;prompt.maxLength=8000;prompt.placeholder='留空使用通用提示词';prompt.value=prompts[target.id]||'';prompt.setAttribute('aria-label',(target.name||target.id)+'的回复提示词');prompt.oninput=()=>{prompts[target.id]=prompt.value;changed();};promptLabel.append(prompt);row.append(promptLabel);
    const details=element('details','auto-id-details');details.append(element('summary','','会话标识'),element('small','',target.id));row.append(details);configured.append(row);
   }else{count++;container.append(row);}
  }
  if(!selected.size)configured.append(element('p','auto-empty','尚未配置会话，请从下方搜索结果中选择。'));
  if(!count)container.append(element('p','auto-empty',query?'没有可添加的匹配结果，已选择的会话展示在已配置区域。':'现有会话已全部选择，可继续搜索其他联系人或群聊。'));
  $('auto-search-status').textContent=query?`匹配到 ${count} 个可添加会话`:`现有会话 · ${count} 个可添加`;
  updateRuntime();
 };
 async function load(){
  if(loading)return;loading=true;$('auto-save').disabled=true;status('正在加载配置…');
  try{
   const data=await api('auto-reply');config=data.config;accountId=data.accountId;selected=new Set(config.recipients);prompts={...config.recipientPrompts};targets.clear();for(const t of data.targets||[])targets.set(t.id,t);
   let listError='';try{const chats=await api('sync');for(const t of chats.items||[])if(t.canSend!==false)targets.set(t.id,t);}catch(e){listError=e.message;}
   for(const id of selected)if(!targets.has(id))targets.set(id,{id,name:id,isGroup:false});
   $('auto-enabled').checked=config.enabled;$('auto-prompt').value=config.prompt||'';$('auto-interval').value=config.pollIntervalMs;$('auto-timeout').value=config.replyTimeoutMs;$('auto-concurrency').value=config.maxConcurrent;$('auto-tools').value=config.allowedTools.join(', ');render();status(listError?'配置已加载，会话列表暂不可用：'+listError:config.enabled?'自动回复已开启':'自动回复已关闭',!!listError);
  }catch(e){config=null;status(e.status===404?'自动回复配置接口未加载，请完整重启 Harness 后重新登录并打开配置；仅刷新页面或重新启用插件可能仍使用旧后端。':e.message,true);}finally{loading=false;$('auto-save').disabled=!config;}
 }
 $('auto-reply-nav').onclick=()=>{show(true);opened=true;load();pollRuntime();};const back=()=>{opened=false;clearTimeout(runtimeTimer);show(false);};$('chat-nav').onclick=back;$('auto-reply-back').onclick=back;$('auto-reload').onclick=load;
 $('auto-kind').onchange=render;
 for(const id of ['auto-enabled','auto-prompt','auto-interval','auto-timeout','auto-concurrency','auto-tools'])$(id).addEventListener('input',changed);
 $('auto-search').oninput=()=>{clearTimeout(searchTimer);queryVersion++;remoteMatches.clear();render();if($('auto-search').value.trim())searchTimer=setTimeout(()=>$('auto-search-button').click(),350);};
 $('auto-search').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();$('auto-search-button').click();}};
 $('auto-search-button').onclick=async()=>{clearTimeout(searchTimer);const version=++queryVersion;$('auto-search-status').textContent='正在搜索…';try{const result=await api('conversations?q='+encodeURIComponent($('auto-search').value.trim()));if(version!==queryVersion)return;remoteMatches=new Set();for(const t of result.items||[])if(t.canSend!==false){targets.set(t.id,t);remoteMatches.add(t.id);}render();}catch(e){if(version===queryVersion)$('auto-search-status').textContent='搜索失败：'+e.message;}};
 $('auto-reply-form').onsubmit=async event=>{
  event.preventDefault();if(loading||!config)return;loading=true;$('auto-save').disabled=true;status('正在保存并应用…');
  const recipients=[...selected],recipientPrompts=Object.fromEntries(recipients.map(id=>[id,prompts[id]||'']));
  const next={enabled:$('auto-enabled').checked,recipients,mentionOnly:true,prompt:$('auto-prompt').value,recipientPrompts,pollIntervalMs:Number($('auto-interval').value),replyTimeoutMs:Number($('auto-timeout').value),maxConcurrent:Number($('auto-concurrency').value),allowedTools:$('auto-tools').value.split(',').map(x=>x.trim()).filter(Boolean)};
  try{const result=await api('auto-reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId,config:next})});config=result.config;selected=new Set(config.recipients);prompts={...config.recipientPrompts};for(const t of result.targets||[])targets.set(t.id,t);render();status(config.enabled?'已保存并开启自动回复':'已保存，自动回复已关闭');pollRuntime();}catch(e){status(e.message,true);}finally{loading=false;$('auto-save').disabled=false;}
 };
 fetch(API_BASE.replace(/api\/$/,'')+'plugin-status').then(response=>{if(response.ok){$('auto-reply-nav').hidden=false;shell.classList.add('plugin-settings-available');}}).catch(()=>{});
}
