export function safeLink(value, base = 'https://www.yunzhijia.com') {
  if (typeof value !== 'string' || !value) return '';
  try { const url = new URL(value, base); return ['https:', 'http:'].includes(url.protocol) && !url.username ? url.href : ''; }
  catch { return ''; }
}
export function mergeMessages(existing, incoming) {
  const rows = existing.map(x => ({...x}));
  for (const item of incoming) {
    if (item.withdraws) {
      const index = rows.findIndex(x => x.id === item.withdraws);
      if (index >= 0) {
        if (item.deleted) rows.splice(index, 1);
        else rows[index] = {...item, id: rows[index].id, time: rows[index].time, withdrawn: true, attachments: [], segments: []};
      } else if (!item.deleted && !rows.some(x => x.id === item.id)) rows.push({...item, withdrawn: true});
      continue;
    }
    const index = rows.findIndex(x => x.id === item.id || (item.clientMsgId && x.clientMsgId === item.clientMsgId));
    if (index >= 0) rows[index] = {...rows[index], ...item};
    else if (item.id) rows.push({...item});
  }
  return rows.sort((a, b) => String(a.time).localeCompare(String(b.time)));
}
export function richTokens(message) {
  const content = message.content || '';
  const segments = (message.segments || []).filter(x => ['image', 'link', 'at', 'at_all', 'bold'].includes(x.type) && Number.isInteger(x.start) && x.start >= 0 && Number.isInteger(x.length) && x.length > 0 && x.start + x.length <= content.length).sort((a,b) => a.start-b.start);
  const tokens = []; let pos = 0;
  for (const item of segments) {
    if (item.start < pos) continue;
    if (item.start > pos) tokens.push({type:'text', text:content.slice(pos,item.start)});
    tokens.push({...item, text:content.slice(item.start,item.start+item.length)});
    pos=item.start+item.length;
  }
  if (pos<content.length) tokens.push({type:'text',text:content.slice(pos)});
  return tokens.length ? tokens : [{type:'text',text:content}];
}
export function preview(item) {
  let text = item.preview || '';
  if (!text) text = ({3:'[语音]',4:'[图片]',8:'[附件]',15:'[机密文件]',16:'[聊天记录]',17:'[在线文档]',21:'[机器人消息]',23:'[富文本]',25:'[卡片消息]'})[item.lastMsgType] || '暂无消息';
  return (item.isGroup && item.sender ? (item.direction===1?'我':item.sender)+'：' : '') + text.replace(/\s+/g,' ');
}
export function timeLabel(value, full = false) {
  if (!value) return '';
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:/.test(value) ? value.replace(' ','T')+'+08:00' : value);
  if (!Number.isFinite(date.getTime())) return String(value);
  const now=new Date();
  const time=date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  if (full) return date.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  if (date.toDateString()===now.toDateString()) return time;
  const yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
  if (date.toDateString()===yesterday.toDateString()) return '昨天';
  return date.toLocaleDateString('zh-CN',{...(date.getFullYear()!==now.getFullYear()?{year:'numeric'}:{}),month:'numeric',day:'numeric'});
}
export function bytes(value) {
  if (!value) return '';
  const units=['B','KB','MB','GB'];let i=0;
  while(value>=1024&&i<3){value/=1024;i++;}
  return `${i?value.toFixed(1):value} ${units[i]}`;
}
