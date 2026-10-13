import unittest
from unittest.mock import patch
import server

class PluginSessionTest(unittest.TestCase):
    def handler(self,cookie=''):
        handler=object.__new__(server.Handler)
        handler.headers={'Cookie':cookie}
        return handler
    def test_plugin_requests_share_qr_cookies_and_login_state(self):
        with patch.object(server,'PLUGIN_SECRET','test-secret'),patch.object(server,'SHARED_SESSION','test-shared'),patch.dict(server.SESSIONS,{},clear=True):
            first=self.handler().session()
            first.qr='https://www.yunzhijia.com/example-qr'
            first.token='test-token'
            second=self.handler('yzj_local=ignored-browser-cookie').session()
            self.assertIs(first,second)
            self.assertEqual(second.qr,first.qr)
            second.authenticated=True
            self.assertTrue(self.handler().session().authenticated)
            self.assertEqual(list(server.SESSIONS),['test-shared'])
    def test_standalone_unknown_cookie_does_not_fixate_session_id(self):
        with patch.object(server,'PLUGIN_SECRET',''),patch.object(server,'SHARED_SESSION',''),patch.dict(server.SESSIONS,{},clear=True):
            first=self.handler('yzj_local=attacker-chosen')
            session=first.session()
            self.assertNotEqual(first.new_sid,'attacker-chosen')
            self.assertIs(self.handler('yzj_local='+first.new_sid).session(),session)
    def test_shared_session_still_requires_plugin_secret(self):
        with patch.object(server,'PLUGIN_SECRET','test-secret'):
            handler=self.handler()
            self.assertFalse(handler.plugin_authorized())
            handler.headers['X-YZJ-Plugin-Key']='test-secret'
            self.assertTrue(handler.plugin_authorized())

if __name__=='__main__':unittest.main()
