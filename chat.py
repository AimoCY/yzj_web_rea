"""Conversation snapshots, cursor-based history, and authenticated media."""
import hashlib
import html
import json
import re
import threading
import time
import urllib.parse
import urllib.request
import live

TRANSFER='XT-0060b6fb-b5e9-4764-a36d-e3be66276586'

def state(s):
    with s.lock:
        if not hasattr(s,'chat'):
            s.chat={'lock':threading.RLock(),'groups':{},'cursors':{},'media':{},'initialized':False,'lastFull':0,'reads':{},'readCursors':{},'lastReadFetch':{}}
    return s.chat

def object_value(value):
    if isinstance(value,dict):return value
    if isinstance(value,str):
        try:
            parsed=json.loads(value)
            return parsed if isinstance(parsed,dict) else {}
        except ValueError:pass
    return {}

def number(value,default=0):
    try:return int(value)
    except (ValueError,TypeError):return default

def media(s,url,filename='',download=False):
    if not isinstance(url,str) or not url:return ''
    url=urllib.parse.urljoin('https://www.yunzhijia.com',url)
    p=urllib.parse.urlparse(url)
    if p.scheme!='https' or not (p.hostname=='yunzhijia.com' or (p.hostname or '').endswith('.yunzhijia.com')) or p.username or p.port not in (None,443):return ''
    key=hashlib.sha256((url+'\0'+filename+'\0'+str(download)).encode()).hexdigest()
    # Media URLs obtained from this user's upstream messages remain server-side.
    st=state(s)
    with st['lock']:st['media'][key]=(url,filename,download)
    return '/api/media?key='+key

def file_url(s,file_id,original=False,download=False,name=''):
    if not file_id:return ''
    url='/docrest/doc/user/downloadfile?'+urllib.parse.urlencode({'fileId':file_id})
    if original:url+='&original'
    elif not download:url+='&w360'
    return media(s,url,name,download)

def conversation(s,row):
    kind=number(row.get('groupType'));gid=str(row.get('groupId') or '')
    param=object_value(row.get('param'));last=object_value(row.get('lastMsg'))
    status=number(row.get('status'),3)
    name=html.unescape(str(row.get('groupName') or row.get('name') or '未命名会话'))
    transfer=kind==3 and name=='文件传输助手'
    target={'id':gid,'groupId':gid,'name':name,'isGroup':kind==2}
    if transfer:target['id']=TRANSFER
    preview=str(row.get('lastMsgContent') or last.get('content') or '')
    item={**target,'groupType':kind,'avatar':media(s,row.get('headerUrl')),
          'preview':html.unescape(preview),'lastTime':row.get('lastMsgSendTime') or last.get('sendTime') or '',
          'lastMsgId':row.get('updateFlag') or last.get('msgId') or '',
          'lastMsgType':number(row.get('lastMsgType'),number(last.get('msgType'))),
          'sender':row.get('fromUserName') or '', 'direction':number(row.get('direction')),
          'unread':number(row.get('unreadCount')),'mention':bool(row.get('mention')),
          'pinned':bool(status&4),'muted':bool(row.get('fold')),
          'canSend':kind in (1,2) or transfer,'status':status,
          'tag':{'customer':'客户','dept':'部门'}.get(param.get('groupClass'),'')}
    s.recipients=getattr(s,'recipients',{})
    s.recipients[item['id']]=item
    return item

def sync(s,remote,full=False):
    st=state(s)
    with st['lock']:
        # Periodic authoritative refresh catches deletion or updates missed offline.
        full=full or not st['initialized'] or time.monotonic()-st['lastFull']>120
        fresh={} if full else st['groups'].copy()
        cursors=st['cursors'].copy()
        for channel,path in [('inner','/im/rest/group/groupList'),('external','/im/rest/group/extGroupList')]:
            offset=0;first=True
            while True:
                values={'offset':offset,'count':200} if full else {'lastUpdateTime':cursors.get(channel,'')}
                result=remote(s,path+'?'+urllib.parse.urlencode(values))
                if not result.get('success'):
                    error=result.get('error') or result.get('errormsg') or '读取会话失败'
                    # Some teams do not enable external conversations.
                    if channel=='external' and not st['cursors'].get(channel):break
                    raise ValueError(error)
                data=result.get('data') or {};rows=data.get('list',[]) if isinstance(data,dict) else data
                if first and isinstance(data,dict) and data.get('updateTime') is not None:
                    cursors[channel]=data['updateTime']
                for row in rows:
                    gid=row.get('groupId')
                    if not gid:continue
                    item=conversation(s,row)
                    if number(row.get('status'),3)&1:fresh[item['id']]=item
                    else:fresh.pop(item['id'],None)
                more=data.get('more',data.get('hasMore',len(rows)>=200)) if isinstance(data,dict) else len(rows)>=200
                if not full or not more or not rows:break
                offset+=len(rows);first=False
                if offset>100000:raise ValueError('会话分页超过服务保护上限，请缩小账号范围')
        if TRANSFER not in fresh:
            item={'id':TRANSFER,'userId':TRANSFER,'name':'文件传输助手','groupType':3,'isGroup':False,'avatar':'','preview':'','lastTime':'','lastMsgId':'','unread':0,'mention':False,'pinned':False,'muted':False,'canSend':True}
            fresh[TRANSFER]=item;s.recipients[TRANSFER]=item
        st['groups']=fresh;st['cursors']=cursors;st['initialized']=True
        if full:st['lastFull']=time.monotonic()
        items=sorted(fresh.values(),key=lambda x:(x['pinned'],str(x['lastTime']),x['id']),reverse=True)
        return {'items':items,'unread':sum(x['unread'] for x in items),'syncedAt':int(time.time()*1000),'mode':getattr(getattr(s,'live',None),'status','fallback')}

def normalize_message(s,row,info):
    p=object_value(row.get('param'));kind=number(row.get('msgType'))
    mid=str(row.get('msgId') or row.get('clientMsgId') or '')
    sender=str(row.get('fromUserId') or row.get('fromPersonId') or '')
    own=number(row.get('direction'))==1 or bool(sender and sender in tuple(str(info[k]) for k in ('id','wbUserId','extId') if info.get(k)))
    result={'id':mid,'clientMsgId':row.get('clientMsgId') or '', 'type':kind,
            'content':str(row.get('content') or ''),'time':row.get('sendTime') or '',
            'senderId':sender,'sender':row.get('senderName') or row.get('userName') or row.get('fromUserName') or row.get('fromPersonName') or (info.get('name') if own else '') or '未知发送者',
            'own':own,'avatar':media(s,row.get('photoUrl') or row.get('headerUrl') or ('/space/c/photo/load?'+urllib.parse.urlencode({'id':sender,'spec':50}) if sender else '')),
            'param':p,'unreadCount':row.get('unreadUserCount'),'attachments':[]}
    fid=p.get('file_id') or p.get('fileId')
    ext=str(p.get('ext') or '').lower();name=str(p.get('name') or p.get('fileName') or '附件')
    if fid and kind in (3,8,15,17):
        ftype=number(p.get('ftype'),-1)
        image=kind==8 and (ftype in (1,2) or p.get('emojiType') or (ftype<0 and ext in ('jpg','jpeg','png','gif','bmp','webp')))
        mode='image' if image else 'video' if ftype==3 or ext in ('mp4','webm','mov') else 'audio' if kind==3 or ftype==4 or ext in ('mp3','wav','m4a','ogg') else 'file'
        result['attachments'].append({'kind':mode,'name':name,'size':number(p.get('size')),'width':number(p.get('picWidth')),'height':number(p.get('picHeight')),
            'url':file_url(s,fid),'original':file_url(s,fid,True),'download':file_url(s,fid,True,True,name)})
    elif kind==4:
        result['attachments'].append({'kind':'image','name':'图片','url':media(s,'/im/web/imageMessage.do?'+urllib.parse.urlencode({'msgId':mid})),'original':media(s,'/im/web/imageMessage.do?'+urllib.parse.urlencode({'msgId':mid}))})
    elif kind==3:
        url=p.get('url') or p.get('audioUrl') or row.get('url') or '/im/web/videoMessage.do?'+urllib.parse.urlencode({'msgId':mid})
        result['attachments'].append({'kind':'audio','name':'语音','url':media(s,url),'original':media(s,url),'recognizedText':p.get('recognizedText',''),'duration':row.get('msgLen')})
    desc=p.get('desc',[])
    result['segments']=[]
    if isinstance(desc,list):
        for d in desc:
            if not isinstance(d,dict):continue
            segment={k:d.get(k) for k in ['type','start','length','data','url','w','h'] if k in d}
            if d.get('type')=='image':
                segment['url']=file_url(s,d.get('data'));segment['original']=file_url(s,d.get('data'),True)
            result['segments'].append(segment)
    if p.get('withdrawMsgId'):
        result['withdraws']=p['withdrawMsgId'];result['deleted']=p.get('withdrawMsgType')=='delete'
    if p.get('replyMsgId'):
        result['reply']={'id':p['replyMsgId'],'sender':p.get('replyPersonName',''),'text':p.get('replySummary') or p.get('replyTitle') or '', 'image':media(s,p.get('replyImgUrl'))}
    interactive=object_value(p.get('interactiveCard'))
    if kind==25 and interactive.get('cardId'):
        st=state(s)
        with st['lock']:st.setdefault('cards',{})[mid]=interactive['cardId']
        result['card']=prepare_card(s,interactive.get('cardJson'))
    return result

def prepare_card(s,value):
    parsed=object_value(value)
    parsed=parsed.get('zh-CN') or parsed.get('zh') or parsed.get('default') or parsed
    def visit(item):
        if isinstance(item,list):return [visit(x) for x in item]
        if not isinstance(item,dict):return item
        output={k:visit(v) for k,v in item.items()}
        if item.get('type')=='Image':output['url']=media(s,item.get('url'))
        return output
    return visit(parsed)

def history(s,target,remote,info,after='',before='',count=50):
    if before and after:raise ValueError('不能同时指定前后消息游标')
    count=max(1,min(number(count,50),200))
    values={'groupId':target.get('groupId',''),'userId':target.get('userId',''),'type':'old' if before else 'new','count':count,'msgId':before or after}
    result=remote(s,'/im/rest/message/listMessage',fields=values)
    if not result.get('success'):raise ValueError(result.get('error') or result.get('errormsg') or '读取消息失败')
    data=result.get('data') or {};rows=data.get('list',[])
    messages=[normalize_message(s,r,info) for r in rows]
    messages.sort(key=lambda r:str(r['time']))
    group=data.get('groupId') or next((r.get('groupId') for r in rows if r.get('groupId')),None)
    if group and not target.get('groupId'):
        target['groupId']=group
        getattr(s,'recipients',{})[target['id']]=target
    return {'items':messages,'more':bool(data.get('more')),'groupId':group or target.get('groupId',''),
            'oldest':messages[0]['id'] if messages else before,'newest':messages[-1]['id'] if messages else after}

def serve_document(h,s,key):
    entry=state(s)['media'].get(key)
    if not entry or not entry[1].lower().endswith(('.md','.markdown')):
        h.respond({'error':'无效的 Markdown 文件引用'},404);return
    url,name,_=entry
    req=urllib.request.Request(url,headers={'Referer':'https://www.yunzhijia.com/im/xiaoxi/'})
    with s.lock:s.jar.add_cookie_header(req)
    from api import SafeRedirect
    proxy=__import__('os').environ.get('YZJ_PROXY','')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({'https':proxy} if proxy else {}),SafeRedirect())
    with opener.open(req,timeout=30) as res:
        data=res.read(1024*1024+1)
    if len(data)>1024*1024:raise ValueError('Markdown 预览暂限 1 MiB，请下载查看')
    try:text=data.decode('utf-8-sig')
    except UnicodeError:raise ValueError('Markdown 文件需使用 UTF-8 编码，请下载查看')
    h.respond({'name':name,'text':text})

def serve_media(h,s,key):
    entry=state(s)['media'].get(key)
    if not entry:h.respond({'error':'无效或过期的媒体引用'},404);return
    url,name,download=entry
    headers={'Referer':'https://www.yunzhijia.com/im/xiaoxi/','User-Agent':'Mozilla/5.0'}
    range_header=h.headers.get('Range','')
    if range_header and re.fullmatch(r'bytes=\d*-\d*',range_header):headers['Range']=range_header
    # Copy cookies under the session lock, then stream through a separate opener.
    # A large attachment must not block chat updates or change the shared jar.
    req=urllib.request.Request(url,headers=headers)
    with s.lock:s.jar.add_cookie_header(req)
    proxy=__import__('os').environ.get('YZJ_PROXY','')
    from api import SafeRedirect
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({'https':proxy} if proxy else {}),SafeRedirect())
    with opener.open(req,timeout=45) as res:
        mime=res.headers.get('Content-Type','application/octet-stream')
        safe_inline=mime.startswith(('image/','audio/','video/')) and not mime.startswith('image/svg')
        h.send_response(res.status)
        h.send_header('Content-Type',mime if safe_inline else 'application/octet-stream')
        for header in ['Content-Length','Content-Range','Accept-Ranges']:
            if res.headers.get(header):h.send_header(header,res.headers[header])
        h.send_header('Cache-Control','private, no-store');h.send_header('X-Content-Type-Options','nosniff')
        if download or not safe_inline:
            h.send_header('Content-Disposition',"attachment; filename*=UTF-8''"+urllib.parse.quote(name or 'attachment'))
        h.end_headers()
        try:
            while True:
                chunk=res.read(65536)
                if not chunk:break
                h.wfile.write(chunk)
        except (BrokenPipeError,ConnectionResetError):pass

def read_state(s,target,remote):
    st=state(s)
    external='ext' in str(target.get('groupId',''))
    channel='external' if external else 'inner'
    with st['lock']:
        st.setdefault('reads',{});st.setdefault('readCursors',{});st.setdefault('lastReadFetch',{})
        if channel not in st['lastReadFetch'] or time.monotonic()-st['lastReadFetch'][channel]>5:
            endpoint='/im/rest/proxy/xuntong/ecLite/convers/'+('extMessageReadList.action' if external else 'messageReadList.action')
            result=remote(s,endpoint,body=json.dumps({'lastUpdateTime':st['readCursors'].get(channel,'')}).encode(),content_type='application/json; charset=utf-8')
            if result.get('success'):
                data=result.get('data') or {}
                for row in data.get('list',[]):
                    gid=row.get('groupId');mid=row.get('messageId')
                    if gid and mid:st['reads'].setdefault(gid,{})[mid]=number(row.get('unreadUserCount'))
                if data.get('msgLastReadUpdateTime'):st['readCursors'][channel]=data['msgLastReadUpdateTime']
                st['lastReadFetch'][channel]=time.monotonic()
        return {'counts':st['reads'].get(target.get('groupId'),{})}

def members(s,target,remote,avatars=True):
    info=getattr(s,'profile',{})
    own={'id':info.get('id'),'name':info.get('name') or '我','avatar':media(s,info.get('photoUrl')) if avatars else ''}
    if target.get('id')==TRANSFER:return {'items':[own]}
    if not target.get('groupId'):return {'items':[]}
    offset=0;items=[]
    while True:
        result=remote(s,'/im/rest/group/groupUser',fields={'groupId':target['groupId'],'offset':offset,'count':200})
        if not result.get('success'):raise ValueError(result.get('error','读取会话成员失败'))
        data=result.get('data') or {};rows=data.get('users',[])
        items.extend({'id':x.get('id'),'name':x.get('name') or x.get('nickName') or '成员','avatar':media(s,x.get('photoUrl')) if avatars else ''} for x in rows)
        if not data.get('hasMore') or not rows:break
        offset+=len(rows)
        if offset>100000:raise ValueError('成员分页超过服务保护上限')
    if info.get('id') and not any(x['id'] in (info.get('id'),info.get('wbUserId')) for x in items):items.append(own)
    return {'items':items}

def handle(h,s,path,remote,profile):
    if path in {'/api/ui/chat-utils','/api/ui/emojis','/api/ui/markdown','/api/ui/composer-utils','/api/ui/media-cache','/api/ui/auto-reply-settings'}:
        from pathlib import Path
        name={'chat-utils':'chat-utils.mjs','emojis':'emojis.json','markdown':'markdown.mjs','composer-utils':'composer-utils.mjs','media-cache':'media-cache.mjs','auto-reply-settings':'auto-reply-settings.mjs'}[path.rsplit('/',1)[-1]]
        h.respond((Path(__file__).parent/'web'/name).read_bytes(),mime='application/json; charset=utf-8' if name.endswith('.json') else 'text/javascript; charset=utf-8');return True
    if path not in {'/api/sync','/api/history','/api/media','/api/events','/api/me','/api/read-state','/api/members','/api/card','/api/document'}:return False
    if not s.authenticated:h.respond({'error':'请先扫码登录','requiresLogin':True},401);return True
    q=urllib.parse.parse_qs(urllib.parse.urlparse(h.path).query)
    if path=='/api/document':serve_document(h,s,q.get('key',[''])[0]);return True
    if path=='/api/media':serve_media(h,s,q.get('key',[''])[0]);return True
    if path=='/api/card':
        cid=state(s).get('cards',{}).get(q.get('messageId',[''])[0])
        if not cid:h.respond({'error':'无效的卡片引用'},404);return True
        result=remote(s,'/gateway/groupassist/cardmsg/cardMsgInfo',body=json.dumps({'cardId':cid}).encode(),content_type='application/json; charset=utf-8')
        if not result.get('success'):raise ValueError(result.get('error','卡片读取失败'))
        h.respond({'card':prepare_card(s,(result.get('data') or {}).get('cardJson'))});return True
    info=profile(s)
    if path=='/api/me':
        h.respond({'id':info.get('id'),'wbUserId':info.get('wbUserId'),'extId':info.get('extId'),'name':info.get('name','我'),'avatar':media(s,info.get('photoUrl'))});return True
    if path=='/api/events':live.stream(h,s,info);return True
    if path=='/api/sync':h.respond(sync(s,remote,q.get('full',[''])[0]=='1'));return True
    target=getattr(s,'recipients',{}).get(q.get('recipientId',[''])[0])
    if not target:h.respond({'error':'请选择有效会话'},400);return True
    if path=='/api/read-state':h.respond(read_state(s,target,remote));return True
    if path=='/api/members':h.respond(members(s,target,remote));return True
    h.respond(history(s,target,remote,info,q.get('after',[''])[0],q.get('before',[''])[0],q.get('count',['50'])[0]));return True
