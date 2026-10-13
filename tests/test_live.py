import json
import socket
import struct
import unittest
import live

class Socket:
    def __init__(self,chunks):self.chunks=list(chunks);self.sent=[]
    def recv(self,count):
        item=self.chunks.pop(0)
        if isinstance(item,Exception):raise item
        return item
    def sendall(self,data):self.sent.append(data)

def frame(data,opcode=1,fin=True):
    data=data if isinstance(data,bytes) else json.dumps(data).encode()
    first=(128 if fin else 0)|opcode
    return bytes([first,len(data)])+data if len(data)<126 else bytes([first,126])+struct.pack('>H',len(data))+data

def ws(chunks):
    obj=live.WebSocket.__new__(live.WebSocket);obj.sock=Socket(chunks);obj.buffer=bytearray();obj.fragments=bytearray();obj.fragment_opcode=None
    return obj

class LiveTest(unittest.TestCase):
    def test_partial_frame_survives_a_socket_timeout(self):
        packet=frame({'type':'Message','socketId':'test'})
        obj=ws([packet[:7],socket.timeout(),packet[7:]])
        with self.assertRaises(socket.timeout):obj.receive()
        self.assertEqual(obj.receive()['type'],'Message')
    def test_fragmented_notifications_and_control_ping(self):
        obj=ws([frame(b'{"type":',fin=False)+frame(b'ping',9)+frame(b'"MessageRead"}',0)])
        self.assertEqual(obj.receive()['type'],'MessageRead');self.assertEqual(obj.sock.sent[0][0],138)
    def test_masked_client_heartbeat(self):
        obj=ws([]);obj.send({'socketId':'abc'});data=obj.sock.sent[0];length=data[1]&127;mask=data[2:6]
        decoded=bytes(v^mask[i%4] for i,v in enumerate(data[6:6+length]))
        self.assertEqual(json.loads(decoded),{'socketId':'abc'});self.assertTrue(data[1]&128)
    def test_unbounded_frame_is_rejected_before_reading_payload(self):
        obj=ws([bytes([129,127])+struct.pack('>Q',20*1024*1024)])
        with self.assertRaises(OSError):obj.receive()

if __name__=='__main__':unittest.main()
