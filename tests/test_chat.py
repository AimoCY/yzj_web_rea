import json
import threading
import unittest
import urllib.error
from unittest.mock import patch
import chat
import api

class Session:
    def __init__(self):self.lock=threading.RLock();self.recipients={};self.authenticated=True

class ChatTest(unittest.TestCase):
    def setUp(self):self.s=Session();self.calls=[]
    def test_full_pagination_and_incremental_cursor_preserve_unchanged_groups(self):
        def upstream(s,path,**kw):
            self.calls.append(path)
            if 'extGroupList' in path:return {'success':True,'data':{'list':[],'updateTime':'ext1','more':False}}
            if 'lastUpdateTime=' in path:return {'success':True,'data':{'list':[{'groupId':'a','groupType':2,'groupName':'新名字','status':7,'unreadCount':3}],'updateTime':'v2'}}
            if 'offset=0' in path:return {'success':True,'data':{'list':[{'groupId':'a','groupType':2,'groupName':'旧名字','status':3}],'updateTime':'v1','more':True}}
            return {'success':True,'data':{'list':[{'groupId':'b','groupType':1,'groupName':'单聊','status':3}],'more':False}}
        first=chat.sync(self.s,upstream)
        self.assertIn('offset=1',self.calls[1]);self.assertEqual(len(first['items']),3)
        second=chat.sync(self.s,upstream)
        rows={x['id']:x for x in second['items']}
        self.assertEqual(rows['a']['name'],'新名字');self.assertEqual(rows['a']['unread'],3);self.assertTrue(rows['a']['pinned']);self.assertIn('b',rows)
        self.assertTrue(any('lastUpdateTime=v1' in x for x in self.calls))
    def test_deleted_group_is_removed_on_incremental_sync(self):
        def upstream(s,path,**kw):
            if 'extGroupList' in path:return {'success':True,'data':{'list':[]}}
            row={'groupId':'a','groupType':2,'groupName':'群','status':0 if 'lastUpdateTime=' in path else 3}
            return {'success':True,'data':{'list':[row],'updateTime':'v1','more':False}}
        chat.sync(self.s,upstream)
        self.assertNotIn('a',{x['id']:x for x in chat.sync(self.s,upstream)['items']})
    def test_transfer_assistant_uses_real_group_without_duplicate(self):
        def upstream(s,path,**kw):return {'success':True,'data':{'list':[] if 'extGroupList' in path else [{'groupId':'transfer-real','groupType':3,'groupName':'文件传输助手','status':3}],'more':False}}
        rows=chat.sync(self.s,upstream)['items'];self.assertEqual(len(rows),1);self.assertEqual(rows[0]['groupId'],'transfer-real');self.assertEqual(rows[0]['id'],chat.TRANSFER)
    def test_old_history_cursor_and_stable_same_second_order(self):
        def upstream(s,path,**kw):
            self.calls.append(kw['fields'])
            return {'success':True,'data':{'list':[{'msgId':'z','sendTime':'2026-10-13 10:00:00','content':'1','msgType':2},{'msgId':'a','sendTime':'2026-10-13 10:00:00','content':'2','msgType':2}],'more':True}}
        data=chat.history(self.s,{'id':'t','groupId':'t'},upstream,{},before='oldest')
        self.assertEqual(self.calls[0]['type'],'old');self.assertEqual(self.calls[0]['msgId'],'oldest');self.assertEqual([x['id'] for x in data['items']],['z','a'])
    def test_history_establishes_actual_group_for_new_contact(self):
        target={'id':'person:u','userId':'u'}
        data=chat.history(self.s,target,lambda *a,**kw:{'success':True,'data':{'list':[{'msgId':'m','groupId':'g','msgType':2}]}},{})
        self.assertEqual(target['groupId'],'g');self.assertEqual(data['groupId'],'g')
    def test_rich_images_and_attachments_use_private_media_references(self):
        row={'msgId':'m','msgType':8,'direction':1,'param':json.dumps({'ftype':1,'file_id':'f','name':'x.png','picWidth':360})}
        data=chat.normalize_message(self.s,row,{'id':'me','name':'我'})
        self.assertTrue(data['own']);self.assertTrue(data['attachments'][0]['url'].startswith('/api/media?key='));self.assertNotIn('fileId=',data['attachments'][0]['url'])
        rich=chat.normalize_message(self.s,{'msgId':'r','msgType':23,'param':{'desc':[{'type':'image','data':'f','start':0,'length':4}]}},{})
        self.assertTrue(rich['segments'][0]['url'].startswith('/api/media?'))
    def test_media_rejects_external_and_credentialed_urls(self):
        for url in ['https://evil.test/img','javascript:alert(1)','http://www.yunzhijia.com/a','https://user@www.yunzhijia.com/a']:
            self.assertEqual(chat.media(self.s,url),'')
    def test_official_sender_name_is_used_for_text_and_image_history(self):
        def remote(s,path,**kw):
            return {'success':True,'data':{'list':[
                {'msgId':'text','msgType':2,'fromUserId':'other','senderName':'测试同事','content':'你好'},
                {'msgId':'image','msgType':8,'fromUserId':'other','senderName':'测试同事','param':{'file_id':'f','ftype':1}}]}}
        data=chat.history(self.s,{'id':'g','groupId':'g'},remote,{'id':'self','name':'自己'})
        self.assertEqual([x['sender'] for x in data['items']],['测试同事','测试同事'])
        self.assertTrue(all(x['senderId']=='other' and not x['own'] for x in data['items']))
    def test_sender_name_priority_and_legacy_fallbacks(self):
        data=chat.normalize_message(self.s,{'msgId':'m','senderName':'当前姓名','fromUserName':'旧姓名','msgType':2},{})
        self.assertEqual(data['sender'],'当前姓名')
        data=chat.normalize_message(self.s,{'msgId':'m','fromPersonName':'旧接口姓名','msgType':2},{})
        self.assertEqual(data['sender'],'旧接口姓名')
        data=chat.normalize_message(self.s,{'msgId':'m','direction':1,'msgType':2},{'name':'自己'})
        self.assertEqual(data['sender'],'自己')
    def test_recipient_lookup_uses_only_current_authenticated_session(self):
        class Handler:
            path='/api/recipient?recipientId=person%3Au'
            def respond(self,data,status=200):self.data=data;self.status=status
        h=Handler();self.s.recipients={'person:u':{'id':'person:u','userId':'u','name':'Test Contact'}}
        self.assertTrue(api.handle(h,self.s,'/api/recipient'));self.assertEqual(h.data['recipient']['id'],'person:u')
        self.s.recipients['person:u']['groupId']='real-group';h.path='/api/recipient?recipientId=real-group';api.handle(h,self.s,'/api/recipient');self.assertEqual(h.data['recipient']['id'],'real-group')
        self.s.recipients={};api.handle(h,self.s,'/api/recipient');self.assertEqual(h.status,404)
        self.s.authenticated=False;api.handle(h,self.s,'/api/recipient');self.assertEqual(h.status,401)
    def test_withdrawal_metadata_is_preserved(self):
        row={'msgId':'notice','msgType':9,'param':{'withdrawMsgId':'original','withdrawMsgType':'delete'}}
        data=chat.normalize_message(self.s,row,{})
        self.assertEqual(data['withdraws'],'original');self.assertTrue(data['deleted'])
    def test_history_does_not_accept_conflicting_cursors(self):
        with self.assertRaises(ValueError):chat.history(self.s,{},None,{},after='a',before='b')
    def test_account_script_is_parsed_without_retaining_credentials(self):
        raw='var __sessionUser = {id:"old",name:"张三",wbUserId:"web", tokenId:"secret", phone:"private",flag:false,}; var __myinfo={}; __myinfo.id="person";'
        self.assertEqual(api.parse_web_profile(raw),{'id':'person','name':'张三','wbUserId':'web'})
    def test_account_parser_rejects_executable_values(self):
        self.assertEqual(api.parse_web_profile('var __sessionUser = {id:alert("x")};'),{})
    def test_read_receipts_use_dedicated_cursor_and_do_not_guess_read_status(self):
        self.calls=[]
        def remote(s,path,**kw):
            self.calls.append(json.loads(kw['body']))
            return {'success':True,'data':{'msgLastReadUpdateTime':'read-cursor','list':[{'groupId':'g','messageId':'m','unreadUserCount':0}]}}
        data=chat.read_state(self.s,{'groupId':'g'},remote)
        self.assertEqual(data['counts'],{'m':0});self.assertEqual(self.calls,[{'lastUpdateTime':''}])
        chat.read_state(self.s,{'groupId':'g'},remote);self.assertEqual(len(self.calls),1)
    def test_voice_uses_official_video_message_endpoint(self):
        data=chat.normalize_message(self.s,{'msgId':'voice','msgType':3,'param':{'recognizedText':'转录'}},{})
        attachment=data['attachments'][0]
        self.assertEqual(attachment['kind'],'audio');key=attachment['url'].split('=')[1]
        self.assertIn('/im/web/videoMessage.do?msgId=voice',chat.state(self.s)['media'][key][0])
    def test_adaptive_cards_keep_structure_with_private_image_proxy(self):
        row={'msgId':'card-msg','msgType':25,'param':{'interactiveCard':{'cardId':'card-id','cardJson':{'default':{'type':'AdaptiveCard','body':[{'type':'TextBlock','text':'标题'},{'type':'Image','url':'https://static.yunzhijia.com/card.png'}]}}}}}
        message=chat.normalize_message(self.s,row,{})
        self.assertEqual(message['card']['body'][0]['text'],'标题')
        self.assertTrue(message['card']['body'][1]['url'].startswith('/api/media?'))
        self.assertEqual(chat.state(self.s)['cards']['card-msg'],'card-id')
    def test_members_paginate_and_include_self(self):
        self.s.profile={'id':'self','name':'我'}
        def remote(s,path,**kw):
            offset=kw['fields']['offset'];self.calls.append(offset)
            return {'success':True,'data':{'users':[{'id':'u'+str(offset),'name':'成员'}],'hasMore':offset==0}}
        data=chat.members(self.s,{'groupId':'g'},remote)
        self.assertEqual(self.calls,[0,1]);self.assertEqual(len(data['items']),3)
    def test_forbidden_resource_does_not_expire_the_entire_session(self):
        self.s.safe_redirects=True
        class Opener:
            def open(self,*a,**kw):raise urllib.error.HTTPError('https://www.yunzhijia.com/private',403,'Forbidden',{},None)
        self.s.opener=Opener()
        with self.assertRaises(PermissionError):api.remote(self.s,'/private')
        self.assertTrue(self.s.authenticated)

if __name__=='__main__':unittest.main()
