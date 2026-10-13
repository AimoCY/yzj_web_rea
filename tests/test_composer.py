import json
import io
import unittest
from unittest.mock import patch
import api
import chat
from test_sender import FakeHandler, FakeSession, TARGET, CID, image_request

class ComposerTest(unittest.TestCase):
    def setUp(self):
        self.s=FakeSession()
        self.calls=[]
    def remote(self,s,path,**kwargs):
        self.calls.append((path,kwargs))
        if 'uploadfile' in path:return {'success':True,'data':[{'fileId':'file-id'}]}
        if 'sendMessage' in path:return {'success':True,'data':{'msgId':'sent','groupId':TARGET['groupId']}}
        if 'saveFile' in path:return {'success':True}
        if 'listMessage' in path:return {'success':True,'data':{'list':[]}}
        raise AssertionError(path)
    def test_generic_file_preserves_bytes_and_sends_file_attachment(self):
        h=image_request(data=b'# document\n\n**hello**')
        # Fixture filename is deliberately PNG; file mode must not parse or convert it.
        with patch.object(api,'remote',side_effect=self.remote):api.deliver(h,self.s,False,file=True)
        param=json.loads(self.calls[1][1]['fields']['param'])
        self.assertEqual((param['ftype'],param['name'],param['picWidth']),(0,'sample.png',0))
        self.assertIn(b'# document\n\n**hello**',self.calls[0][1]['body'])
        self.assertEqual(self.calls[1][1]['fields']['content'],'[文件]:sample.png')
    def test_file_timeout_blocks_reupload_and_resend(self):
        def remote(s,path,**kwargs):
            if 'sendMessage' in path:self.calls.append((path,kwargs));raise TimeoutError()
            return self.remote(s,path,**kwargs)
        with patch.object(api,'remote',side_effect=remote):
            first=image_request(data=b'file');api.deliver(first,self.s,False,file=True)
            second=image_request(data=b'file');api.deliver(second,self.s,False,file=True)
        self.assertTrue(second.result[1]['uncertain'])
        self.assertEqual(sum('uploadfile' in path for path,_ in self.calls),1)
        self.assertEqual(sum('sendMessage' in path for path,_ in self.calls),1)
    def test_same_bytes_as_image_and_file_cannot_reuse_request_id(self):
        with patch.object(api,'remote',side_effect=self.remote):
            api.deliver(image_request(),self.s,True)
            with self.assertRaisesRegex(ValueError,'不同消息'):api.deliver(image_request(),self.s,False,file=True)
    def test_member_alert_contract_validates_utf16_positions_and_deduplicates(self):
        mentions=[{'id':'person','start':3,'end':6},{'id':'person','start':7,'end':10}]
        content='👋 @张三 @张三'
        with patch.object(api,'profile',return_value={}),patch.object(chat,'members',return_value={'items':[{'id':'person','name':'张三'}]}):
            self.assertEqual(api.mention_param(self.s,TARGET,content,mentions),{'notifyTo':['person'],'notifyType':1,'notifyToAll':False})
            for invalid in [[{'id':'outsider','start':3,'end':6}],[{'id':'person','start':1,'end':6}]]:
                with self.assertRaises(ValueError):api.mention_param(self.s,TARGET,content,invalid)
            with self.assertRaises(ValueError):api.mention_param(self.s,TARGET,'@张四',[{'id':'person','start':0,'end':3}])
    def test_changed_notify_targets_cannot_reuse_text_id(self):
        body={'recipient':TARGET,'clientMsgId':CID,'text':'@张三 hello','mentions':[{'id':'person','start':0,'end':3}]}
        with patch.object(api,'profile',return_value={}),patch.object(chat,'members',return_value={'items':[{'id':'person','name':'张三'}]}),patch.object(api,'remote',side_effect=self.remote):
            h=FakeHandler(json.dumps(body).encode(),'application/json');api.deliver(h,self.s,False)
            body['mentions']=[]
            with self.assertRaisesRegex(ValueError,'不同消息'):api.deliver(FakeHandler(json.dumps(body).encode(),'application/json'),self.s,False)
    def test_account_endpoint_still_returns_avatar_after_member_extension(self):
        h=FakeHandler(b'','');h.path='/api/me'
        self.assertTrue(chat.handle(h,self.s,'/api/me',self.remote,lambda s:{'id':'demo','name':'演示用户'}))
        self.assertEqual(h.result[1]['name'],'演示用户')
        self.assertEqual(h.result[1]['avatar'],'')
    def document_opener(self,data):
        class Opener:
            def open(self,*args,**kwargs):return io.BytesIO(data)
        return patch.object(chat.urllib.request,'build_opener',return_value=Opener())
    def test_markdown_document_preview_uses_registered_reference(self):
        key=chat.media(self.s,'https://www.yunzhijia.com/docrest/doc/user/downloadfile?fileId=f','demo.md',True).split('key=')[1]
        h=FakeHandler(b'','')
        with self.document_opener(b'\xef\xbb\xbf# Demo'):chat.serve_document(h,self.s,key)
        self.assertEqual(h.result,(200,{'name':'demo.md','text':'# Demo'}))
    def test_markdown_preview_rejects_large_non_utf8_and_unregistered_files(self):
        key=chat.media(self.s,'https://www.yunzhijia.com/a','demo.md',True).split('key=')[1]
        for data,message in [(b'x'*(1024*1024+1),'1 MiB'),(b'\xff','UTF-8')]:
            with self.document_opener(data),self.assertRaisesRegex(ValueError,message):chat.serve_document(FakeHandler(b'',''),self.s,key)
        h=FakeHandler(b'','')
        with patch.object(chat.urllib.request,'build_opener') as opener:chat.serve_document(h,self.s,'unknown');opener.assert_not_called()
        self.assertEqual(h.result[0],404)
    def test_explicit_file_type_is_not_rendered_as_image(self):
        row={'msgId':'file','msgType':8,'param':{'file_id':'id','name':'large.png','ext':'png','ftype':0}}
        self.assertEqual(chat.normalize_message(self.s,row,{})['attachments'][0]['kind'],'file')

if __name__=='__main__':unittest.main()
