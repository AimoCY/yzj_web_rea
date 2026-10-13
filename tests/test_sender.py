import http.cookiejar
import io
import json
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
import api

CID='12345678-1234-4234-8234-123456789012'
TARGET={'id':'group-1','groupId':'group-1','name':'测试群','isGroup':True}
PNG=(Path(__file__).parent/'fixtures/sample.png').read_bytes()

class FakeSession:
    def __init__(self):
        self.authenticated=True
        self.lock=threading.RLock()
        self.recipients={TARGET['id']:TARGET}
        self.upload_url='/docrest/doc/file/uploadfile'
        self.jar=http.cookiejar.CookieJar()
        self.jar.set_cookie(http.cookiejar.Cookie(0,'at','test-only',None,False,'www.yunzhijia.com',False,False,'/',True,True,None,True,None,None,{},False))

class FakeHandler:
    def __init__(self,body,content_type):
        self.headers={'Content-Length':str(len(body)),'Content-Type':content_type}
        self.rfile=io.BytesIO(body)
        self.result=None
    def respond(self,value,status=200):
        self.result=(status,value)

def image_request(target=TARGET,data=PNG):
    boundary='test-boundary'
    body=b''
    for key,value in {'recipient':json.dumps(target),'clientMsgId':CID,'width':'9999','height':'9999'}.items():
        body+=f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
    body+=f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.png"\r\nContent-Type: image/png\r\n\r\n'.encode()+data+b'\r\n'+f'--{boundary}--\r\n'.encode()
    return FakeHandler(body,'multipart/form-data; boundary='+boundary)

class SenderTest(unittest.TestCase):
    def setUp(self):
        self.s=FakeSession();self.calls=[]
    def upstream(self,s,path,**kwargs):
        self.calls.append((path,kwargs))
        if 'uploadfile' in path:return {'success':True,'data':[{'fileId':'uploaded-id'}]}
        if 'sendMessage' in path:return {'success':True,'data':{'msgId':'server-msg','groupId':'group-1'}}
        if 'saveFile' in path:return {'success':True}
        if 'listMessage' in path:return {'success':True,'data':{'list':[]}}
        raise AssertionError(path)
    def test_image_upload_precedes_message_and_dimensions_come_from_file(self):
        h=image_request()
        with patch.object(api,'remote',side_effect=self.upstream):api.deliver(h,self.s,True)
        self.assertEqual([x[0].split('?')[0] for x in self.calls],['/docrest/doc/file/uploadfile','/im/web/sendMessage.do','/im/rest/saveFile'])
        fields=self.calls[1][1]['fields'];param=json.loads(fields['param'])
        self.assertEqual((param['file_id'],param['ftype'],param['picWidth'],param['picHeight']),('uploaded-id',1,360,220))
        self.assertEqual(fields['msgType'],8)
        self.assertEqual(h.result[1]['msgId'],'server-msg')
        self.assertIn(b'name="fileToUpload"',self.calls[0][1]['body'])
        self.assertIn(b'name="auth_token"',self.calls[0][1]['body'])
    def test_successful_replay_never_uploads_or_sends_twice(self):
        with patch.object(api,'remote',side_effect=self.upstream):
            api.deliver(image_request(),self.s,True)
            count=len(self.calls)
            second=image_request();api.deliver(second,self.s,True)
        self.assertEqual(len(self.calls),count)
        self.assertEqual(second.result[1]['msgId'],'server-msg')
    def test_failed_upload_never_sends_message(self):
        with patch.object(api,'remote',return_value={'success':False,'error':'拒绝上传'}):
            with self.assertRaisesRegex(ValueError,'拒绝上传'):api.deliver(image_request(),self.s,True)
        self.assertEqual(self.s.operations[CID]['state'],'new')
    def test_timeout_after_send_blocks_resubmission(self):
        def remote(s,path,**kwargs):
            if 'sendMessage' in path:
                self.calls.append((path,kwargs));raise TimeoutError()
            return self.upstream(s,path,**kwargs)
        with patch.object(api,'remote',side_effect=remote):
            first=image_request();api.deliver(first,self.s,True)
            second=image_request();api.deliver(second,self.s,True)
        self.assertTrue(first.result[1]['uncertain'])
        self.assertTrue(second.result[1]['uncertain'])
        self.assertEqual(sum('sendMessage' in x[0] for x in self.calls),1)
    def test_invalid_target_is_rejected_before_network(self):
        with patch.object(api,'remote') as network:
            with self.assertRaises(ValueError):api.deliver(image_request({'id':'unknown'}),self.s,True)
            network.assert_not_called()
    def test_spoofed_file_is_rejected_before_network(self):
        with patch.object(api,'remote') as network:
            with self.assertRaises(ValueError):api.deliver(image_request(data=b'<html>fake image</html>'),self.s,True)
            network.assert_not_called()
    def test_same_id_cannot_target_different_content(self):
        with patch.object(api,'remote',side_effect=self.upstream):
            api.deliver(image_request(),self.s,True)
            # A valid GIF has a different digest, even if CID is identical.
            with self.assertRaisesRegex(ValueError,'不同消息'):
                api.deliver(image_request(data=b'GIF89a\x01\x00\x01\x00\x80\x00\x00'),self.s,True)
    def test_utf16_message_length_matches_web_javascript(self):
        h=FakeHandler(json.dumps({'recipient':TARGET,'clientMsgId':CID,'text':'你好👋'}).encode(),'application/json')
        with patch.object(api,'remote',side_effect=self.upstream):api.deliver(h,self.s,False)
        self.assertEqual(self.calls[0][1]['fields']['msgLen'],4)
    def test_untrusted_upstream_domains_are_blocked(self):
        for url in ['https://yunzhijia.com.evil.test/','http://www.yunzhijia.com/','https://127.0.0.1/','https://user@www.yunzhijia.com/']:
            self.assertFalse(api.trusted_url(url))

if __name__=='__main__':unittest.main()
