"""Local independent Yunzhijia web sender; Python standard library only."""
import http.cookiejar
import json
import importlib.util
import os
import secrets
import threading
import time
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get('PORT', '8765'))
ORIGIN = 'https://www.yunzhijia.com'
SESSIONS = {}

class Session:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        proxy = os.environ.get('YZJ_PROXY', '')
        self.opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({'https': proxy} if proxy else {}),
            urllib.request.HTTPCookieProcessor(self.jar))
        self.lock = threading.RLock()
        self.token = None
        self.qr = None
        self.authenticated = False

    def fetch(self, path, data=None, content_type=None):
        url = urllib.parse.urljoin(ORIGIN, path)
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != 'https' or parsed.hostname not in {'www.yunzhijia.com', 'yunzhijia.com'}:
            raise ValueError('不支持的服务地址')
        headers = {'User-Agent': 'Mozilla/5.0', 'Referer': ORIGIN + '/im/'}
        if content_type:
            headers['Content-Type'] = content_type
        req = urllib.request.Request(url, data=data, headers=headers)
        with self.lock, self.opener.open(req, timeout=25) as res:
            return res.read(), res.headers.get('Content-Type', 'application/octet-stream'), res.url

    def get_json(self, path):
        return json.loads(self.fetch(path)[0])

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Query strings can contain login tokens; never write them to logs.
        pass

    def session(self):
        cookies = dict(part.strip().split('=', 1) for part in self.headers.get('Cookie', '').split(';') if '=' in part)
        sid = cookies.get('yzj_local')
        if sid not in SESSIONS:
            sid = secrets.token_urlsafe(32)
            SESSIONS[sid] = Session()
            self.new_sid = sid
        return SESSIONS[sid]

    def respond(self, payload, status=200, mime='application/json; charset=utf-8'):
        body = json.dumps(payload, ensure_ascii=False).encode() if not isinstance(payload, bytes) else payload
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        if getattr(self, 'new_sid', None):
            self.send_header('Set-Cookie', f'yzj_local={self.new_sid}; HttpOnly; SameSite=Strict; Path=/')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        try:
            if self.headers.get('Host') not in {f'127.0.0.1:{PORT}', f'localhost:{PORT}'}:
                return self.respond({'error': 'Invalid host'}, 403)
            s = self.session()
            path = urllib.parse.urlparse(self.path).path
            if path.startswith('/api/'):
                if self.dynamic(s, path):
                    return
            if path == '/api/status':
                return self.respond({'authenticated': s.authenticated})
            if path == '/api/login/qr-image':
                if not s.qr:
                    return self.respond({'error': '请刷新二维码'}, 400)
                data, mime, _ = s.fetch(s.qr)
                return self.respond(data, mime=mime)
            if path == '/api/login/check':
                if not s.token:
                    return self.respond({'authenticated': False})
                result = s.get_json('/space/c/checkloginstatus?' + urllib.parse.urlencode({'token': s.token, 'time': int(time.time()*1000), 'loginExtendInfo': json.dumps({'userDefinedDeviceName': '独立网页版图片发送'})}))
                if result.get('success'):
                    s.authenticated = True
                return self.respond({'authenticated': s.authenticated, 'errorCode': result.get('errorCode'), 'error': result.get('error')})
            if path == '/':
                return self.respond((ROOT/'web/index.html').read_bytes(), mime='text/html; charset=utf-8')
            if path in {'/app.js', '/style.css'}:
                return self.respond((ROOT/'web'/path[1:]).read_bytes(), mime='text/javascript; charset=utf-8' if path.endswith('.js') else 'text/css; charset=utf-8')
            return self.respond({'error': 'Not found'}, 404)
        except Exception as exc:
            self.respond({'error': '云之家请求失败：' + str(exc)}, 502)

    def do_POST(self):
        try:
            if self.headers.get('Host') not in {f'127.0.0.1:{PORT}', f'localhost:{PORT}'} or self.headers.get('Origin') not in {f'http://127.0.0.1:{PORT}', f'http://localhost:{PORT}'}:
                return self.respond({'error': 'Invalid origin'}, 403)
            s = self.session()
            if self.dynamic(s, self.path):
                return
            if self.path == '/api/login/start':
                result = s.get_json('/space/c/getloginercode?time=' + str(int(time.time()*1000)))
                if not result.get('success'):
                    return self.respond({'error': result.get('error', '二维码获取失败')}, 502)
                s.token = result['data']['token']
                s.qr = result['data']['url']
                return self.respond({'image': '/api/login/qr-image', 'expiresIn': 60})
            if self.path == '/api/logout':
                s.jar.clear()
                s.token = s.qr = None
                s.authenticated = False
                return self.respond({'success': True})
            return self.respond({'error': 'Not found'}, 404)
        except Exception as exc:
            self.respond({'error': '云之家请求失败：' + str(exc)}, 502)

    def dynamic(self, session, path):
        spec = importlib.util.spec_from_file_location('yzj_api', ROOT/'api.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.handle(self, session, path)

if __name__ == '__main__':
    print(f'云之家独立发送器 http://127.0.0.1:{PORT}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
