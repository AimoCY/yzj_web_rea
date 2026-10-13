"""Hot-loaded API handlers: developing endpoints never discards login cookies."""
import hashlib
import ast
from email.parser import BytesParser
from email.policy import default
import json
import re
import secrets
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAX_IMAGE = 32 * 1024 * 1024
TRANSFER_ID = 'XT-0060b6fb-b5e9-4764-a36d-e3be66276586'

class AuthenticationError(ValueError):
    pass

def trusted_url(url):
    p = urllib.parse.urlparse(url)
    return p.scheme == 'https' and (p.hostname == 'yunzhijia.com' or (p.hostname or '').endswith('.yunzhijia.com')) and p.port in (None,443) and not p.username

class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not trusted_url(newurl):
            raise ValueError('服务返回了不支持的跳转地址')
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def remote(s, path, fields=None, body=None, content_type=None):
    url = urllib.parse.urljoin('https://www.yunzhijia.com', path)
    if not trusted_url(url):
        raise ValueError('不支持的服务地址')
    if fields is not None:
        body = urllib.parse.urlencode(fields).encode()
        content_type = 'application/x-www-form-urlencoded; charset=UTF-8'
    headers = {'User-Agent':'Mozilla/5.0','Referer':'https://www.yunzhijia.com/im/xiaoxi/','X-Requested-With':'XMLHttpRequest'}
    if content_type:
        headers['Content-Type'] = content_type
    if not getattr(s,'safe_redirects',False):
        s.opener.add_handler(SafeRedirect())
        s.safe_redirects = True
    try:
        with s.lock, s.opener.open(urllib.request.Request(url, data=body, headers=headers), timeout=45) as res:
            if '/home/' in urllib.parse.urlparse(res.url).path:
                raise AuthenticationError('网页登录已过期，请重新扫码')
            content = res.read()
    except urllib.error.HTTPError as exc:
        if exc.code==401:
            raise AuthenticationError('网页登录已过期，请重新扫码')
        if exc.code==403:
            raise PermissionError('没有访问该云之家资源的权限')
        raise
    try:
        return json.loads(content)
    except (ValueError,UnicodeError):
        raise RuntimeError('服务未返回有效 JSON，登录可能已过期')

def js_literal(source,position=0):
    """Read inert JS literals only. Never eval or execute account-page scripts."""
    def skip(i):
        while True:
            m=re.match(r'\s+|//[^\n]*(?:\n|$)|/\*[\s\S]*?\*/',source[i:])
            if not m:return i
            i+=m.end()
    i=skip(position)
    if i>=len(source):raise ValueError('缺少字面量')
    if source[i] in '\"\'':
        m=re.match(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'',source[i:])
        if not m:raise ValueError('无效字符串')
        value=json.loads(m.group()) if source[i]=='"' else ast.literal_eval(m.group())
        return value,i+m.end()
    if source[i] in '{[':
        obj=source[i]=='{';value={} if obj else [];i+=1
        while True:
            i=skip(i)
            if source[i]==('}' if obj else ']'):return value,i+1
            if obj:
                if source[i] in '\"\'':key,i=js_literal(source,i)
                else:
                    m=re.match(r'[\w$]+',source[i:])
                    if not m:raise ValueError('无效属性')
                    key=m.group();i+=m.end()
                i=skip(i)
                if source[i]!=':':raise ValueError('缺少属性冒号')
                item,i=js_literal(source,i+1);value[key]=item
            else:
                item,i=js_literal(source,i);value.append(item)
            i=skip(i)
            if source[i]==',':i+=1;continue
            if source[i]!=('}' if obj else ']'):raise ValueError('不支持的表达式')
    m=re.match(r'(?:true|false|null|undefined)\b|-?\d+(?:\.\d+)?',source[i:])
    if not m:raise ValueError('不支持的账户脚本表达式')
    text=m.group()
    return ({'true':True,'false':False,'null':None,'undefined':None}.get(text) if text in ('true','false','null','undefined') else float(text) if '.' in text else int(text)),i+m.end()

def parse_web_profile(raw):
    values={}
    for var in ['__sessionUser','__myinfo']:
        m=re.search(r'\b'+var+r'\s*=\s*',raw)
        if m:
            try:values[var]=js_literal(raw,m.end())[0]
            except (ValueError,SyntaxError,IndexError):pass
    info={**object_profile(values.get('__sessionUser')),**object_profile(values.get('__myinfo'))}
    for m in re.finditer(r'\b__myinfo\.(\w+)\s*=\s*',raw):
        try:info[m.group(1)]=js_literal(raw,m.end())[0]
        except (ValueError,SyntaxError,IndexError):pass
    return {k:v for k,v in info.items() if k in {'id','wbUserId','eid','name','photoUrl','networkId','wbNetworkId','extId','openStatus','mixInfo'}}

def object_profile(value):
    return value if isinstance(value,dict) else {}

def profile(s):
    if getattr(s,'profile',None):
        return s.profile
    raw = s.fetch('/im/api/myinfo')[0].decode('utf-8')
    s.profile = parse_web_profile(raw)
    if not s.profile:
        if hasattr(s,'profile'):delattr(s,'profile')
        return {}
    return s.profile

def upload_url(s):
    if hasattr(s,'upload_url'):
        return s.upload_url
    s.upload_url='/docrest/doc/file/uploadfile'
    info=profile(s)
    if info.get('eid'):
        result=remote(s,'/gateway/opencloud/params/acqParm2Gen',fields={'eid':info['eid'],'field':'all'})
        if result.get('success'):
            host=((result.get('data',{}).get('domains') or {}).get('xuntong') or {}).get('upload')
            if host:
                candidate='https://'+host+'/docrest/doc/file/uploadfile'
                if not trusted_url(candidate):raise ValueError('团队上传服务不在支持的云之家域名内')
                s.upload_url=candidate
    return s.upload_url

def load_recipients(s, query=''):
    recipients = getattr(s,'recipients',{})
    items = []
    if not query:
        for offset in range(0,2000,200):
            result = remote(s,f'/im/rest/group/groupList?offset={offset}&count=200')
            if not result.get('success'):
                error=result.get('error','读取会话失败，请重新登录')
                if '登录' in error:raise AuthenticationError(error)
                raise ValueError(error)
            rows = result.get('data',{}).get('list',[])
            for x in rows:
                if x.get('groupType') not in (1,2):
                    continue
                gid = x.get('groupId')
                if not gid:
                    continue
                item = {'id':gid,'groupId':gid,'name':x.get('groupName') or x.get('name') or '未命名会话','isGroup':x.get('groupType')==2}
                recipients[gid] = item
                items.append(item)
            if len(rows)<200:
                break
        transfer = {'id':TRANSFER_ID,'userId':TRANSFER_ID,'name':'文件传输助手','isGroup':False}
        recipients[TRANSFER_ID] = transfer
        items.insert(0,transfer)
    else:
        items = [x for x in recipients.values() if query.casefold() in x['name'].casefold()]
        result = remote(s,'/gateway/openorg/v2/contacts/searchPersonsInfo',fields={'word':query,'page':1,'pageSize':30})
        if result.get('success'):
            data = result.get('data',{})
            rows = data if isinstance(data,list) else data.get('list',data.get('persons',data.get('person',[])))
            for x in rows:
                uid=x.get('id') or x.get('personId')
                if uid and x.get('name'):
                    item={'id':'person:'+uid,'userId':uid,'name':x['name'],'isGroup':False}
                    recipients[item['id']]=item
                    items.append(item)
        result = remote(s,'/im/rest/search/groupByName?'+urllib.parse.urlencode({'count':30,'word':query,'page':1}))
        if result.get('success'):
            data=result.get('data',{})
            rows=data if isinstance(data,list) else data.get('list',[])
            for x in rows:
                gid=x.get('groupId')
                if gid:
                    item={'id':gid,'groupId':gid,'name':x.get('groupName') or x.get('name') or '未命名群聊','isGroup':True}
                    recipients[gid]=item
                    items.append(item)
    s.recipients=recipients
    return list({x['id']:x for x in items}.values())

def recipient(s, supplied):
    # Only accept targets returned by upstream to this logged-in session.
    target=getattr(s,'recipients',{}).get(supplied.get('id'))
    if not target:
        raise ValueError('请重新选择有效的联系人或群聊')
    return target

def read_body(h, limit):
    length=int(h.headers.get('Content-Length','0'))
    if length<=0 or length>limit:
        raise ValueError('请求大小超出限制')
    body=h.rfile.read(length)
    if len(body)!=length:
        raise ValueError('请求未完整上传')
    return body

def image_info(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n') and len(data)>=33 and data[12:16]==b'IHDR':
        w,h=struct.unpack('>II',data[16:24]);ext,mime='png','image/png'
    elif data[:6] in (b'GIF87a',b'GIF89a') and len(data)>=13:
        w,h=struct.unpack('<HH',data[6:10]);ext,mime='gif','image/gif'
    elif data[:2]==b'BM' and len(data)>=26:
        header=struct.unpack('<I',data[14:18])[0]
        if header==12:w,h=struct.unpack('<HH',data[18:22])
        elif header>=40:w,h=struct.unpack('<ii',data[18:26]);h=abs(h)
        else:raise ValueError('不支持的 BMP 图片')
        ext,mime='bmp','image/bmp'
    elif data[:2]==b'\xff\xd8':
        i=2;w=h=0
        while i<len(data)-4:
            if data[i]!=255:i+=1;continue
            while i<len(data) and data[i]==255:i+=1
            if i>=len(data):break
            marker=data[i];i+=1
            if marker in (0xd8,0xd9,0x01) or 0xd0<=marker<=0xd7:continue
            length=struct.unpack('>H',data[i:i+2])[0]
            if length<2 or i+length>len(data):break
            if marker in (0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf) and length>=8:
                h,w=struct.unpack('>HH',data[i+3:i+7]);break
            i+=length
        ext,mime='jpg','image/jpeg'
    else:
        raise ValueError('只支持 PNG、JPG、GIF、BMP 图片')
    if not w or not h or w<0:
        raise ValueError('图片尺寸无效')
    return w,h,ext,mime

def multipart(fields, filename, data, mime):
    boundary='yzj_'+secrets.token_hex(20)
    parts=[]
    for key,value in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
    safe_name=filename.replace('"','_').replace('\r','_').replace('\n','_')
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="{safe_name}"\r\nContent-Type: {mime}\r\n\r\n'.encode()+data+b'\r\n')
    parts.append(f'--{boundary}--\r\n'.encode())
    return b''.join(parts),'multipart/form-data; boundary='+boundary

def send(s, target, cid, content, msg_type, param):
    result=remote(s,'/im/web/sendMessage.do',fields={'clientMsgId':cid,'groupId':target.get('groupId',''),'toUserId':target.get('userId',''),'msgType':msg_type,'content':content,'msgLen':len(content.encode('utf-16-le'))//2,'param':json.dumps(param,ensure_ascii=False,separators=(',',':'))})
    if not result.get('success'):
        raise ValueError(result.get('error',result.get('errormsg','消息发送失败')))
    data=result.get('data') or {}
    if not isinstance(data,dict) or not data.get('msgId'):
        raise RuntimeError('发送请求已提交，但未取得消息 ID；请核对会话后再操作')
    return {'success':True,'msgId':data['msgId'],'groupId':data.get('groupId'),'sendTime':data.get('sendTime'),'clientMsgId':cid}

def operation(s,cid,digest,target):
    if not isinstance(cid,str) or not re.fullmatch(r'[0-9a-f-]{36}',cid):
        raise ValueError('消息请求 ID 无效')
    if not hasattr(s,'operations'):s.operations={}
    op=s.operations.get(cid)
    if op and op['digest']!=digest:
        raise ValueError('同一个请求 ID 不能用于不同消息')
    if not op:
        op={'digest':digest,'target':target,'state':'new'}
        s.operations[cid]=op
    return op

def reconcile(s,cid,op):
    target=op['target']
    result=remote(s,'/im/rest/message/listMessage',fields={'groupId':target.get('groupId',''),'userId':target.get('userId',''),'type':'new','count':100,'msgId':''})
    if result.get('success'):
        for row in (result.get('data') or {}).get('list',[]):
            if row.get('clientMsgId')==cid and row.get('msgId'):
                op['state']='sent'
                op['receipt']={'success':True,'msgId':row['msgId'],'groupId':row.get('groupId'),'sendTime':row.get('sendTime'),'clientMsgId':cid}
                return op['receipt']
    return None

def mention_param(s,target,content,mentions):
    if not isinstance(mentions,list) or len(mentions)>50:raise ValueError('@ 成员数量无效，最多 50 人')
    if not mentions:return {}
    if not target.get('isGroup') or not target.get('groupId'):raise ValueError('只能在群聊中 @ 成员')
    import chat
    profile(s)
    known={str(x['id']):x['name'].strip() for x in chat.members(s,target,remote,avatars=False)['items'] if x.get('id')}
    encoded=content.encode('utf-16-le');ids=[];ranges=[]
    for item in mentions:
        if not isinstance(item,dict) or str(item.get('id','')) not in known:raise ValueError('@ 的成员已不在当前群聊，请重新选择')
        start,end=item.get('start'),item.get('end')
        if type(start)!=int or type(end)!=int or not 0<=start<end<=len(encoded)//2:raise ValueError('@ 成员位置无效')
        try:label=encoded[start*2:end*2].decode('utf-16-le')
        except UnicodeError:raise ValueError('@ 成员位置无效')
        if label!='@'+known[str(item['id'])]:raise ValueError('@ 成员文字已变化，请重新选择')
        if any(start<b and end>a for a,b in ranges):raise ValueError('@ 成员位置重叠')
        ranges.append((start,end))
        uid=str(item['id'])
        if uid not in ids:ids.append(uid)
    # Observed official web text sender contract; all-member alerts are excluded.
    return {'notifyTo':ids,'notifyType':1,'notifyToAll':False}

def deliver(h,s,image,file=False):
    attachment=image or file
    if not s.authenticated:
        h.respond({'error':'请先扫码登录'},401);return
    if attachment:
        mime=h.headers.get('Content-Type','')
        if not mime.startswith('multipart/form-data;'):
            raise ValueError('附件请求格式无效')
        msg=BytesParser(policy=default).parsebytes(b'Content-Type: '+mime.encode()+b'\r\nMIME-Version: 1.0\r\n\r\n'+read_body(h,MAX_IMAGE+65536))
        fields={}
        for part in msg.iter_parts():
            key=part.get_param('name',header='content-disposition')
            if key in fields:raise ValueError('重复的上传字段')
            fields[key]=part
        part=fields.get('file')
        if part is None:raise ValueError('缺少附件')
        data=part.get_payload(decode=True)
        if not data or len(data)>MAX_IMAGE:raise ValueError('单个附件暂限 32 MiB，不能发送空文件')
        supplied=json.loads(fields['recipient'].get_content())
        cid=fields['clientMsgId'].get_content().strip()
        if image:w,height,ext,file_mime=image_info(data)
        else:w,height,ext,file_mime=0,0,'','application/octet-stream'
        name=(part.get_filename() or 'image').replace('\\','/').split('/')[-1]
        name=re.sub(r'[\x00-\x1f"<>]','_',name)[:180]
        if image:name=(name.rsplit('.',1)[0] if '.' in name else name)+'.'+ext
        else:
            name=name.strip().strip('.') or 'attachment'
            ext=re.sub(r'[^a-z0-9]','',name.rsplit('.',1)[-1].lower())[:20] if '.' in name else ''
        digest=hashlib.sha256(('image' if image else 'file').encode()+json.dumps(supplied,sort_keys=True).encode()+name.encode()+data).hexdigest()
    else:
        fields=json.loads(read_body(h,65536))
        supplied=fields['recipient'];cid=fields['clientMsgId'];content=fields['text'].strip()
        if not content or len(content)>10000:raise ValueError('文字需为 1 至 10000 个字符')
        mentions=fields.get('mentions',[])
        digest=hashlib.sha256(json.dumps({'recipient':supplied,'text':content,'mentions':mentions},sort_keys=True).encode()).hexdigest()
    with s.lock:
        target=recipient(s,supplied)
        op=operation(s,cid,digest,target)
        if op['state']=='sent':h.respond(op['receipt']);return
        if op['state']=='uncertain':
            receipt=reconcile(s,cid,op)
            h.respond(receipt or {'error':'该消息的回执尚未确认，已阻止重复发送；请到云之家核对或稍后检查回执','uncertain':True},200 if receipt else 409)
            return
        if attachment:
            if not op.get('fileId'):
                auth=next((c.value for c in s.jar if c.name=='at'),'')
                if not auth:raise ValueError('网页登录已过期，请重新扫码')
                upload_body,upload_mime=multipart({'bizkey':'xuntong','auth_token':auth},name,data,file_mime)
                result=remote(s,upload_url(s)+'?t='+str(int(time.time()*1000)),body=upload_body,content_type=upload_mime)
                rows=result.get('data',[])
                if not result.get('success') or not isinstance(rows,list) or not rows or not rows[0].get('fileId'):
                    raise ValueError(result.get('error','附件上传失败，未发送消息'))
                op['fileId']=rows[0]['fileId']
            # Desktop-derived conservative fallback, explicitly reported to UI.
            ftype=0 if file else (2 if ext=='gif' else (0 if len(data)>=8388608 or w>=5000 or height>=5000 else 1))
            param={'file_id':op['fileId'],'name':name,'size':len(data),'ext':ext,'ftype':ftype,'unreadMonitor':int(ftype==0),'picWidth':w,'picHeight':height}
            content='[文件]:'+name if ftype==0 else '[图片]'
            msg_type=8
        else:
            param=mention_param(s,target,content,mentions);msg_type=2
        op['state']='sending'
        try:
            receipt=send(s,target,cid,content,msg_type,param)
        except ValueError as exc:
            op['state']='rejected'
            raise exc
        except Exception:
            op['state']='uncertain'
            h.respond({'error':'消息请求已提交，但回执未确认。请检查回执，避免重复发送。','uncertain':True},504)
            return
        op['state']='sent';op['receipt']=receipt
        if attachment:
            receipt.update({'fileId':op['fileId'],'ftype':ftype,'width':w,'height':height})
            # Official UI registers the uploaded file with the conversation after sending.
            try:
                result=remote(s,'/im/rest/saveFile',fields={'fileId':op['fileId'],'threadId':receipt.get('groupId') or target.get('groupId',''),'isEncrypted':'false','uploadFileMode':1})
                if not result.get('success'):receipt['fileListWarning']='消息已发送，但群文件列表登记未成功'
            except Exception:
                receipt['fileListWarning']='消息已发送，但群文件列表登记未确认'
        h.respond(receipt)

def handle(h, s, path):
    try:
        return _handle(h,s,path)
    except AuthenticationError as exc:
        s.authenticated=False
        h.respond({'error':str(exc),'requiresLogin':True},401)
        return True
    except (ValueError,KeyError,TypeError) as exc:
        if '登录' in str(exc):
            s.authenticated=False
            h.respond({'error':str(exc),'requiresLogin':True},401)
        else:
            h.respond({'error':str(exc)},400)
        return True

def _handle(h,s,path):
    import chat
    import importlib
    import live
    live_stamp=(ROOT/'live.py').stat().st_mtime_ns
    if getattr(live,'_loaded_stamp',None)!=live_stamp:
        importlib.reload(live)
        live._loaded_stamp=live_stamp
    stamp=(ROOT/'chat.py').stat().st_mtime_ns
    if getattr(chat,'_loaded_stamp',None)!=stamp:
        importlib.reload(chat)
        chat._loaded_stamp=stamp
    if chat.handle(h,s,path,remote,profile):
        return True
    if path=='/api/logout' and h.command=='POST':
        with s.lock:
            if getattr(s,'live',None):s.live.close()
            s.jar.clear()
            s.token=s.qr=None
            s.authenticated=False
            for name in ['profile','upload_url','operations','recipients','chat','live']:
                if hasattr(s,name):delattr(s,name)
        h.respond({'success':True})
        return True
    if path in {'/api/messages/image','/api/messages/file','/api/messages/text'} and h.command=='POST':
        try:
            deliver(h,s,path.endswith('/image'),file=path.endswith('/file'))
        except AuthenticationError:
            raise
        except (ValueError,KeyError,TypeError) as exc:
            h.respond({'error':str(exc)},400)
        return True
    if path=='/api/messages/receipt' and h.command=='POST':
        if not s.authenticated:
            h.respond({'error':'请先登录'},401);return True
        data=json.loads(read_body(h,4096))
        cid=data.get('clientMsgId')
        with s.lock:
            op=getattr(s,'operations',{}).get(cid)
            if not op:
                h.respond({'error':'没有对应的发送记录'},404)
            else:
                receipt=op.get('receipt') or reconcile(s,cid,op)
                h.respond(receipt or {'error':'暂未找到该消息回执，请到云之家核对；系统不会自动重发','uncertain':True},200 if receipt else 409)
        return True
    if path == '/api/login/start' and h.command == 'POST':
        if getattr(s,'live',None):s.live.close()
        for name in ['profile','upload_url','chat','recipients','operations','live']:
            if hasattr(s,name):delattr(s,name)
        s.jar.clear()
        result = s.get_json('/space/c/getloginercode?time=' + str(int(time.time()*1000)))
        if not result.get('success'):
            h.respond({'error':result.get('error','二维码获取失败')},502)
        else:
            s.token = result['data']['token']
            s.qr = result['data']['url']
            s.authenticated = False
            h.respond({'image':'/api/login/qr-image','expiresIn':60})
        return True
    if path in {'/api/login/check', '/api/status'}:
        if not s.authenticated and any(c.name == 'at' for c in s.jar):
            try:
                groups = s.get_json('/im/rest/group/groupList?offset=0&count=200')
                if groups.get('success'):
                    s.authenticated = True
            except urllib.error.HTTPError as exc:
                if exc.code not in (401,403):raise
        if s.authenticated:
            h.respond({'authenticated': True})
            return True
        if not s.token:
            h.respond({'authenticated':False})
            return True
        result = s.get_json('/space/c/checkloginstatus?' + urllib.parse.urlencode({'token':s.token,'time':int(time.time()*1000),'loginExtendInfo':json.dumps({'userDefinedDeviceName':'独立网页版图片发送'})}))
        if result.get('success'):
            s.authenticated = True
        h.respond({'authenticated':s.authenticated,'pendingToken':bool(s.token),'errorCode':result.get('errorCode',result.get('errorcode')),'error':result.get('error')})
        return True
    if path == '/api/recipient':
        if not s.authenticated:
            h.respond({'error':'请先扫码登录'},401)
        else:
            rid=urllib.parse.parse_qs(urllib.parse.urlparse(h.path).query).get('recipientId',[''])[0]
            known=getattr(s,'recipients',{})
            target=known.get(rid) or next((t for t in known.values() if t.get('groupId')==rid),None)
            if target:
                target={**target,'id':rid};known[rid]=target;h.respond({'recipient':target})
            else:h.respond({'error':'请选择当前账号已查询到的会话'},404)
        return True
    if path == '/api/conversations':
        if not s.authenticated:
            h.respond({'error':'请先扫码登录'},401)
        else:
            query=urllib.parse.parse_qs(urllib.parse.urlparse(h.path).query).get('q',[''])[0].strip()[:80]
            h.respond({'items':load_recipients(s,query)})
        return True
    return False
