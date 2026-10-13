"""Standalone HTTP login regression using synthetic QR and account data only."""
import http.client
import json
import threading
import unittest
from unittest.mock import patch
import server

class WebSessionTest(unittest.TestCase):
    def handler(self,cookie=''):
        h=object.__new__(server.Handler);h.headers={'Cookie':cookie};return h
    def test_unknown_cookie_cannot_choose_session_identifier(self):
        with patch.dict(server.SESSIONS,{},clear=True):
            first=self.handler('yzj_local=attacker-chosen');session=first.session()
            self.assertNotEqual(first.new_sid,'attacker-chosen')
            self.assertIs(self.handler('yzj_local='+first.new_sid).session(),session)
    def test_http_qr_image_and_confirmation_share_cookie_session(self):
        def upstream(session,path):
            if path.startswith('/space/c/getloginercode'):
                return {'success':True,'data':{'token':'synthetic-token','url':'/synthetic-qr.png'}}
            if path.startswith('/space/c/checkloginstatus'):
                self.assertEqual(session.token,'synthetic-token');return {'success':True}
            raise AssertionError('Unexpected upstream request')
        def image(session,path,*args,**kwargs):
            self.assertEqual(path,'/synthetic-qr.png');return b'synthetic QR bytes','image/png',''
        httpd=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        thread=threading.Thread(target=httpd.serve_forever,daemon=True)
        with patch.object(server,'PORT',httpd.server_port),patch.dict(server.SESSIONS,{},clear=True),patch.object(server.Session,'get_json',upstream),patch.object(server.Session,'fetch',image):
            thread.start();client=http.client.HTTPConnection('127.0.0.1',httpd.server_port,timeout=5)
            try:
                origin='http://127.0.0.1:'+str(httpd.server_port)
                client.request('POST','/api/login/start',body=b'',headers={'Origin':origin})
                response=client.getresponse();self.assertEqual(response.status,200);data=json.loads(response.read())
                cookie=response.getheader('Set-Cookie').split(';')[0];self.assertIn('HttpOnly',response.getheader('Set-Cookie'))
                client.request('GET',data['image'],headers={'Cookie':cookie});response=client.getresponse()
                self.assertEqual(response.status,200);self.assertEqual(response.read(),b'synthetic QR bytes')
                client.request('GET','/api/login/check',headers={'Cookie':cookie});response=client.getresponse()
                self.assertTrue(json.loads(response.read())['authenticated']);self.assertEqual(len(server.SESSIONS),1)
                client.request('GET','/api/status',headers={'Cookie':cookie});response=client.getresponse()
                self.assertTrue(json.loads(response.read())['authenticated'])
            finally:client.close();httpd.shutdown();thread.join();httpd.server_close()

if __name__=='__main__':unittest.main()
