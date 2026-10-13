// A deliberately small Markdown subset. Raw HTML is always plain text.
export function safeMarkdownUrl(value) {
  try {
    const url = new URL(String(value));
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function parseInline(source, depth = 0) {
  const text = String(source);
  if (depth > 12) return [{ type: 'text', text }];
  const nodes = [];
  let plain = '';
  const flush = () => { if (plain) { nodes.push({ type: 'text', text: plain }); plain = ''; } };
  for (let i = 0; i < text.length;) {
    const tail = text.slice(i);
    if (/^\\[\\`*_{}\[\]()#+.!>~-]/.test(tail)) { plain += tail[1]; i += 2; continue; }
    if (tail[0] === '`') {
      const marker = tail.match(/^`+/)[0];
      const end = text.indexOf(marker, i + marker.length);
      if (end >= 0) { flush(); nodes.push({ type: 'code', text: text.slice(i + marker.length, end).replace(/\n/g, ' ') }); i = end + marker.length; continue; }
    }
    const link = tail.match(/^(!?)\[([^\]\n]*)\]\(([^\s)]*)(?:\s+"[^"\n]*")?\)/);
    if (link) {
      flush();
      const href = safeMarkdownUrl(link[3]);
      nodes.push({ type: link[1] ? 'image' : 'link', href, text: link[2], children: parseInline(link[2], depth + 1) });
      i += link[0].length; continue;
    }
    const auto = tail.match(/^<(https?:\/\/[^<>\s]+)>/);
    if (auto) { flush(); nodes.push({ type: 'link', href: safeMarkdownUrl(auto[1]), text: auto[1], children: [{ type: 'text', text: auto[1] }] }); i += auto[0].length; continue; }
    let matched = false;
    for (const [marker, type] of [['**', 'strong'], ['__', 'strong'], ['~~', 'del'], ['*', 'em'], ['_', 'em']]) {
      if (!tail.startsWith(marker) || (marker === '_' && /\w/.test(text[i - 1] || ''))) continue;
      const end = text.indexOf(marker, i + marker.length);
      if (end > i + marker.length && !/\s/.test(text[i + marker.length]) && !/\s/.test(text[end - 1])) {
        flush(); nodes.push({ type, children: parseInline(text.slice(i + marker.length, end), depth + 1) });
        i = end + marker.length; matched = true; break;
      }
    }
    if (matched) continue;
    if (tail[0] === '\n') { flush(); nodes.push({ type: 'break' }); i++; continue; }
    plain += text[i++];
  }
  flush(); return nodes;
}

const listItem = line => line.match(/^ {0,3}([-+*]|\d+[.)])\s+(.*)$/);
const fence = line => line.match(/^ {0,3}(`{3,}|~{3,})\s*([^ ]*)\s*$/);
const ruler = line => /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line);
const heading = line => line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
}
const separator = line => line.includes('|') && tableCells(line).every(cell => /^:?-{3,}:?$/.test(cell));
const startsBlock = line => fence(line) || heading(line) || ruler(line) || listItem(line) || /^ {0,3}>/.test(line);

export function parseMarkdown(source, depth = 0) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  if (depth > 12) return [{ type: 'paragraph', children: [{ type: 'text', text: lines.join('\n') }] }];
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const opening = fence(line);
    if (opening) {
      const code = [];
      const closing = new RegExp('^ {0,3}' + (opening[1][0] === '`' ? '`' : '~') + '{' + opening[1].length + ',}\\s*$');
      i++;
      while (i < lines.length && !closing.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ type: 'codeblock', language: opening[2], text: code.join('\n') }); continue;
    }
    const title = heading(line);
    if (title) { blocks.push({ type: 'heading', level: title[1].length, children: parseInline(title[2]) }); i++; continue; }
    if (ruler(line)) { blocks.push({ type: 'rule' }); i++; continue; }
    if (/^ {0,3}>/.test(line)) {
      const quoted = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) quoted.push(lines[i++].replace(/^ {0,3}> ?/, ''));
      blocks.push({ type: 'quote', children: parseMarkdown(quoted.join('\n'), depth + 1) }); continue;
    }
    const item = listItem(line);
    if (item) {
      const ordered = /^\d/.test(item[1]);
      const items = [];
      const start = ordered ? Number.parseInt(item[1], 10) : 1;
      while (i < lines.length) {
        const next = listItem(lines[i]);
        if (!next || /^\d/.test(next[1]) !== ordered) break;
        const task = next[2].match(/^\[([ xX])\]\s+(.*)$/);
        const content = [task ? task[2] : next[2]];
        i++;
        while (i < lines.length && /^ {2,}\S/.test(lines[i]) && !listItem(lines[i])) content.push(lines[i++].trim());
        items.push({ type: 'item', checked: task ? task[1].toLowerCase() === 'x' : null, children: parseInline(content.join('\n')) });
      }
      blocks.push({ type: 'list', ordered, start, items }); continue;
    }
    if (i + 1 < lines.length && line.includes('|') && separator(lines[i + 1])) {
      const headers = tableCells(line);
      const align = tableCells(lines[i + 1]).map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left');
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !startsBlock(lines[i])) rows.push(tableCells(lines[i++]));
      blocks.push({ type: 'table', headers, align, rows }); continue;
    }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) && !(i + 1 < lines.length && lines[i].includes('|') && separator(lines[i + 1]))) paragraph.push(lines[i++]);
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
  }
  return blocks;
}

export function renderMarkdown(node, source) {
  const doc = node.ownerDocument;
  const make = (tag, text) => { const element = doc.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
  function inlines(parent, children) {
    for (const child of children) {
      if (child.type === 'text') { parent.append(doc.createTextNode(child.text)); continue; }
      if (child.type === 'break') { parent.append(make('br')); continue; }
      if (child.type === 'image') {
        // Never fetch URLs embedded in messages automatically.
        const element = make(child.href ? 'a' : 'span', '[图片：' + (child.text || '查看链接') + ']');
        if (child.href) { element.href = child.href; element.target = '_blank'; element.rel = 'noopener noreferrer'; }
        element.className = 'markdown-image-link'; parent.append(element); continue;
      }
      if (child.type === 'code') { parent.append(make('code', child.text)); continue; }
      const element = make(child.type === 'link' ? (child.href ? 'a' : 'span') : child.type);
      if (child.type === 'link' && child.href) { element.href = child.href; element.target = '_blank'; element.rel = 'noopener noreferrer'; }
      inlines(element, child.children || []); parent.append(element);
    }
  }
  function blocks(parent, ast) {
    for (const block of ast) {
      if (block.type === 'rule') { parent.append(make('hr')); continue; }
      if (block.type === 'codeblock') {
        const wrap = make('div'); wrap.className = 'markdown-code';
        const toolbar = make('div'); toolbar.className = 'markdown-code-toolbar';
        toolbar.append(make('span', block.language || '代码'));
        const button = make('button', '复制'); button.type = 'button'; button.setAttribute('aria-label', '复制代码');
        button.addEventListener('click', async () => {
          try {
            const clipboard = doc.defaultView?.navigator?.clipboard;
            if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
            await clipboard.writeText(block.text); button.textContent = '已复制';
          } catch { button.textContent = '复制失败，请手动选择'; }
          doc.defaultView?.setTimeout(() => { button.textContent = '复制'; }, 2000);
        });
        toolbar.append(button);
        const pre = make('pre'); pre.append(make('code', block.text)); wrap.append(toolbar, pre); parent.append(wrap); continue;
      }
      if (block.type === 'quote') { const quote = make('blockquote'); blocks(quote, block.children); parent.append(quote); continue; }
      if (block.type === 'list') {
        const list = make(block.ordered ? 'ol' : 'ul');
        if (block.ordered && block.start !== 1) list.start = block.start;
        for (const item of block.items) {
          const li = make('li');
          if (item.checked !== null) { li.className = 'markdown-task'; const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.checked = item.checked; checkbox.disabled = true; li.append(checkbox); }
          inlines(li, item.children); list.append(li);
        }
        parent.append(list); continue;
      }
      if (block.type === 'table') {
        const scroll = make('div'); scroll.className = 'markdown-table-wrap'; const table = make('table');
        const head = make('thead'); const headerRow = make('tr');
        block.headers.forEach((cell, index) => { const th = make('th'); th.style.textAlign = block.align[index] || 'left'; inlines(th, parseInline(cell)); headerRow.append(th); });
        head.append(headerRow); const body = make('tbody');
        for (const row of block.rows) { const tr = make('tr'); block.headers.forEach((_, index) => { const td = make('td'); td.style.textAlign = block.align[index] || 'left'; inlines(td, parseInline(row[index] || '')); tr.append(td); }); body.append(tr); }
        table.append(head, body); scroll.append(table); parent.append(scroll); continue;
      }
      const element = make(block.type === 'heading' ? 'h' + block.level : 'p'); inlines(element, block.children); parent.append(element);
    }
  }
  node.replaceChildren(); node.classList.add('markdown-body'); blocks(node, parseMarkdown(source)); return node;
}
