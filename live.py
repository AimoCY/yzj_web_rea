"""Yunzhijia's WebSocket invalidations, relayed to local SSE subscribers."""
import base64
import hashlib
import json
import os
import secrets
import socket
import ssl
import struct
import threading
import time
import urllib.parse
import urllib.request


class WebSocket:
    def __init__(self, path, cookie, proxy=''):
        host='websocket.yunzhijia.com'
        p=urllib.parse.urlparse(proxy)
        if proxy:
            if p.scheme!='http' or not p.hostname:
                raise ValueError('WebSocket 仅支持 HTTP CONNECT 代理')
            raw=socket.create_connection((p.hostname,p.port or 80),timeout=12)
            raw.sendall(f'CONNECT {host}:443 HTTP/1.1\r\nHost: {host}:443\r\n\r\n'.encode())
            header=self.head(raw)
            if header.split(b'\r\n')[0].split()[1]!=b'200':
                raw.close();raise OSError('代理连接失败')
        else:
            raw=socket.create_connection((host,443),timeout=12)
        self.sock=ssl.create_default_context().wrap_socket(raw,server_hostname=host)
        self.sock.settimeout(2)
        key=base64.b64encode(secrets.token_bytes(16)).decode()
        request=f'GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nOrigin: https://www.yunzhijia.com\r\n'
        if cookie:request+='Cookie: '+cookie+'\r\n'
        self.sock.sendall((request+'\r\n').encode())
        header=self.head(self.sock)
        lines=header.decode('latin1').split('\r\n')
        values={k.strip().lower():v.strip() for line in lines[1:] if ':' in line for k,v in [line.split(':',1)]}
        expected=base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
        if lines[0].split()[1]!='101' or values.get('sec-websocket-accept')!=expected:
            self.sock.close();raise OSError('WebSocket 握手未成功')
        self.buffer=bytearray();self.fragments=bytearray();self.fragment_opcode=None

    @staticmethod
    def head(sock):
        data=bytearray()
        while not data.endswith(b'\r\n\r\n'):
            b=sock.recv(1)
            if not b or len(data)>32768:raise OSError('连接响应无效')
            data.extend(b)
        return bytes(data)

    def send(self,value,opcode=1):
        data=json.dumps(value,separators=(',',':')).encode() if opcode==1 else value
        mask=secrets.token_bytes(4);length=len(data)
        header=bytes([0x80|opcode,0x80|min(length,126)])
        if length>=126:header=bytes([0x80|opcode,0xfe])+struct.pack('>H',length)
        masked=bytes(b^mask[i%4] for i,b in enumerate(data))
        self.sock.sendall(header+mask+masked)

    def receive(self):
        while True:
            b=self.buffer
            if len(b)>=2:
                fin=bool(b[0]&0x80);opcode=b[0]&15;masked=bool(b[1]&0x80);n=b[1]&127;offset=2
                if b[0]&0x70:raise OSError('不支持压缩的 WebSocket 帧')
                if n==126:
                    if len(b)<4:n=None
                    else:n=struct.unpack('>H',b[2:4])[0];offset=4
                elif n==127:
                    if len(b)<10:n=None
                    else:n=struct.unpack('>Q',b[2:10])[0];offset=10
                if n is not None:
                    if n>8*1024*1024:raise OSError('通知帧过大')
                    end=offset+(4 if masked else 0)+n
                    if len(b)>=end:
                        mask=bytes(b[offset:offset+4]) if masked else None
                        data=bytes(b[offset+(4 if masked else 0):end]);del b[:end]
                        if mask:data=bytes(v^mask[i%4] for i,v in enumerate(data))
                        if opcode==8:raise OSError('上游关闭连接')
                        if opcode==9:self.send(data,10);continue
                        if opcode==10:continue
                        if opcode in (1,2):self.fragments=bytearray(data);self.fragment_opcode=opcode
                        elif opcode==0 and self.fragment_opcode:self.fragments.extend(data)
                        else:raise OSError('通知帧顺序无效')
                        if len(self.fragments)>8*1024*1024:raise OSError('通知过大')
                        if fin:
                            result=bytes(self.fragments);self.fragments.clear();self.fragment_opcode=None
                            return json.loads(result)
                        continue
            data=self.sock.recv(65536)
            if not data:raise OSError('连接已断开')
            self.buffer.extend(data)

    def close(self):
        try:self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:pass
        self.sock.close()


class Live:
    def __init__(self,session,info):
        self.session=session;self.info=info;self.condition=threading.Condition()
        self.stopped=threading.Event();self.seq=0;self.status='connecting';self.reason='正在连接实时服务'
        self.ws=None;self.clients=0;self.last_client=time.monotonic()
        threading.Thread(target=self.run,daemon=True,name='yzj-live').start()

    def publish(self,kind='change',status=None,reason=None):
        with self.condition:
            if status:self.status=status
            if reason:self.reason=reason
            self.kind=kind;self.seq+=1;self.condition.notify_all()

    def snapshot(self):
        return {'seq':self.seq,'kind':getattr(self,'kind','status'),'status':self.status,'reason':self.reason}

    def close(self):
        self.stopped.set()
        if self.ws:self.ws.close()
        self.publish('status','closed','实时连接已结束')

    def run(self):
        delay=1
        while not self.stopped.is_set() and self.session.authenticated:
            if not self.clients and time.monotonic()-self.last_client>60:break
            try:
                person=self.info.get('id');user=self.info.get('wbUserId')
                if not person or not user:
                    self.publish('status','fallback','自动同步 · 实时身份信息不可用');self.stopped.set();return
                query=urllib.parse.urlencode({'personId':person,'userId':user})
                req=urllib.request.Request('https://websocket.yunzhijia.com/im/mySocket?'+query)
                with self.session.lock:self.session.jar.add_cookie_header(req)
                self.ws=WebSocket('/im/mySocket?'+query,req.get_header('Cookie',''),os.environ.get('YZJ_PROXY',''))
                self.publish('change','connected','实时连接已建立');delay=1
                socket_id=None;heartbeat=time.monotonic();last_message=heartbeat
                while not self.stopped.is_set() and self.session.authenticated:
                    if not self.clients and time.monotonic()-self.last_client>60:break
                    now=time.monotonic()
                    if now-heartbeat>=10:
                        self.ws.send({'socketId':socket_id});heartbeat=now
                    if now-last_message>35:raise OSError('心跳超时')
                    try:message=self.ws.receive()
                    except socket.timeout:continue
                    last_message=time.monotonic();socket_id=message.get('socketId',socket_id)
                    data=message.get('data') or {}
                    kind=data.get('fromSystem') if isinstance(data,dict) else None
                    kind=kind or message.get('type')
                    if kind in ('Message','MessageRead','cardMsg','Group','UserCustomStatusChanged'):
                        self.publish('read' if kind=='MessageRead' else 'change')
            except Exception:
                if not self.stopped.is_set():self.publish('status','fallback','连接重试中 · 自动同步保持运行')
            finally:
                if self.ws:self.ws.close();self.ws=None
            if self.stopped.wait(delay):break
            delay=min(delay*2,20)
        self.stopped.set()


def stream(h,s,info):
    # Origin checks prevent another web origin from consuming private events.
    expected={f'http://127.0.0.1:{h.server.server_port}',f'http://localhost:{h.server.server_port}'}
    if h.headers.get('Origin') and h.headers.get('Origin') not in expected:
        h.respond({'error':'Invalid origin'},403);return
    with s.lock:
        live=getattr(s,'live',None)
        if not live or live.stopped.is_set() or (not live.info.get('id') and info.get('id')):
            if live:live.close()
            live=s.live=Live(s,info)
    h.send_response(200)
    h.send_header('Content-Type','text/event-stream; charset=utf-8')
    h.send_header('Cache-Control','no-store')
    h.send_header('X-Accel-Buffering','no')
    h.end_headers()
    seq=-1
    with live.condition:live.clients+=1
    try:
        while s.authenticated and not live.stopped.is_set():
            with live.condition:
                if seq==live.seq:live.condition.wait(timeout=15)
                value=live.snapshot();seq=live.seq
            h.wfile.write(('data: '+json.dumps(value,ensure_ascii=False)+'\n\n').encode());h.wfile.flush()
    except (BrokenPipeError,ConnectionResetError,OSError):pass
    finally:
        with live.condition:live.clients-=1;live.last_client=time.monotonic()
