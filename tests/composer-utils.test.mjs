import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileMentions,mentionPayload,mentionQuery,looksMarkdown} from '../web/composer-utils.mjs';
const selected={id:'one',name:'张三',start:0,end:3};
test('mention offsets follow insertions, but edited/deleted labels stop alerting',()=>{
 assert.deepEqual(reconcileMentions('@张三 你好','👋 @张三 你好',[selected]),[{...selected,start:3,end:6}]);
 assert.deepEqual(reconcileMentions('@张三 你好','@张四 你好',[selected]),[]);
 assert.deepEqual(reconcileMentions('@张三 你好','你好',[selected]),[]);
 assert.deepEqual(reconcileMentions('@张三 你好','@张三 你好！',[selected]),[selected]);
});
test('UTF-16 payload adjusts leading trim without changing member IDs',()=>{
 assert.deepEqual(mentionPayload('  👋 @张三 hi  ',[{...selected,start:5,end:8}]),[{id:'one',start:3,end:6}]);
 assert.deepEqual(mentionPayload('@张四',[selected]),[]);
});
test('mention menu uses current caret and avoids email addresses',()=>{
 assert.deepEqual(mentionQuery('你好 @张',5),{start:3,end:5,query:'张'});
 assert.equal(mentionQuery('demo@example.com',16),null);
});
test('Markdown detection keeps ordinary emoji messages in the rich renderer',()=>{
 assert.equal(looksMarkdown('# 文档\n\n- 条目'),true);
 assert.equal(looksMarkdown('你好 [微笑]'),false);
 assert.equal(looksMarkdown('使用 `code`'),true);
 assert.equal(looksMarkdown('*斜体*'),true);
 assert.equal(looksMarkdown('~~删除线~~'),true);
});
