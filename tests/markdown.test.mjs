import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline, renderMarkdown, safeMarkdownUrl } from '../web/markdown.mjs';

test('Markdown blocks preserve code and support common document content', () => {
  const blocks = parseMarkdown('# 标题\r\n\r\n段落 **粗体**\n第二行\n\n> 引用\n> 文本\n\n- [x] 完成\n- [ ] 待办\n\n3. 第三项\n4. 第四项\n\n```js\nconst x = "<script>";\n```\n\n---');
  assert.deepEqual(blocks.map(block => block.type), ['heading', 'paragraph', 'quote', 'list', 'list', 'codeblock', 'rule']);
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[3].items[0].checked, true);
  assert.equal(blocks[3].items[1].checked, false);
  assert.equal(blocks[4].start, 3);
  assert.equal(blocks[5].language, 'js');
  assert.equal(blocks[5].text, 'const x = "<script>";');
});

test('inline formatting and escaped delimiters', () => {
  const nodes = parseInline('**bold** *italic* ~~gone~~ `a < b` \\*literal\\*');
  assert.deepEqual(nodes.filter(node => node.type !== 'text').map(node => node.type), ['strong', 'em', 'del', 'code']);
  assert.ok(nodes.some(node => node.type === 'text' && node.text.includes('*literal*')));
});

test('tables align cells and support escaped pipes', () => {
  const [table] = parseMarkdown('| 名称 | 数量 | 备注 |\n| :--- | ---: | :---: |\n| A\\|B | 2 | **好** |');
  assert.equal(table.type, 'table');
  assert.deepEqual(table.align, ['left', 'right', 'center']);
  assert.equal(table.rows[0][0], 'A|B');
});

test('links only allow absolute HTTP(S) URLs without credentials', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', '//example.com', '/private', 'https://user:secret@example.com', 'vbscript:msgbox(1)']) assert.equal(safeMarkdownUrl(value), null);
  assert.equal(safeMarkdownUrl('https://example.com/docs?q=1'), 'https://example.com/docs?q=1');
  const links = parseInline('[坏](javascript:alert) ![头像](https://example.com/private.png)');
  assert.equal(links[0].href, null);
  assert.equal(links[2].type, 'image');
});

test('unclosed fences remain code and raw HTML remains text', () => {
  assert.equal(parseMarkdown('~~~text\n<script>alert(1)</script>')[0].text, '<script>alert(1)</script>');
  assert.deepEqual(parseInline('<img src=x onerror=alert(1)>'), [{ type: 'text', text: '<img src=x onerror=alert(1)>' }]);
});

// Minimal DOM double exercises the actual renderer without adding runtime dependencies.
class Element {
  constructor(tag, doc, text = '') { this.tagName = tag; this.ownerDocument = doc; this.textContent = text; this.children = []; this.style = {}; this.attributes = {}; this.classList = { add() {} }; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener() {}
}
test('renderer never creates executable HTML or automatically loads message images', () => {
  const doc = { createElement: tag => new Element(tag, doc), createTextNode: text => new Element('#text', doc, text), defaultView: {} };
  const root = new Element('div', doc);
  renderMarkdown(root, '<script>alert(1)</script>\n\n![secret](https://example.com/private.png) [unsafe](javascript:alert)\n\n```html\n<img src=x onerror=alert(1)>\n```');
  const all = [];
  const visit = node => { all.push(node); node.children.forEach(visit); };
  visit(root);
  assert.ok(!all.some(node => ['script', 'img', 'iframe', 'object'].includes(node.tagName)));
  assert.ok(all.some(node => node.textContent.includes('<script>')));
  const links = all.filter(node => node.tagName === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://example.com/private.png');
  assert.equal(links[0].rel, 'noopener noreferrer');
  assert.equal(links[0].target, '_blank');
});
