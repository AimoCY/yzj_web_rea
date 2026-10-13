/* Capture the real UI with synthetic data only. No running service or account needed.
 * Install Playwright separately, then run: node scripts/capture-previews.cjs
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'docs/images');
const origin = 'http://127.0.0.1:18767';
const time = '2026-10-13 10:30:00';
const picture = 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="320" viewBox="0 0 600 320"><defs><linearGradient id="g"><stop stop-color="#dcecff"/><stop offset="1" stop-color="#effaf5"/></linearGradient></defs><rect width="600" height="320" rx="20" fill="url(#g)"/><circle cx="480" cy="75" r="38" fill="#ffd98f"/><path d="M0 260L150 140L275 230L380 155L600 320H0Z" fill="#a0badc"/><path d="M0 310L230 220L340 275L460 200L600 275V320H0Z" fill="#6d96c5"/><text x="32" y="50" font-family="sans-serif" font-size="22" fill="#355778">IMAGE PREVIEW</text><text x="32" y="82" font-family="sans-serif" font-size="13" fill="#547495">Synthetic demo asset</text></svg>`).toString('base64');
const chats = [
 {id:'demo-team',name:'演示项目群',isGroup:true,pinned:true,unread:3,preview:'图片收到，可以查看原图。',sender:'演示联系人',lastTime:time},
 {id:'demo-helper',name:'文件传输助手',groupType:3,preview:'[图片]',lastTime:time},
 {id:'demo-person',name:'演示联系人',unread:2,preview:'支持拖拽、粘贴和多图发送。',lastTime:time},
 {id:'demo-design',name:'演示设计群',isGroup:true,muted:true,preview:'新版界面已准备好。',sender:'演示成员',lastTime:time},
 {id:'demo-notice',name:'演示通知',canSend:false,preview:'这是一条虚构通知。',lastTime:time}
].map(x=>({groupId:x.id,avatar:'',canSend:true,unread:0,...x}));
const messages = [
 {id:'demo-1',type:2,sender:'演示联系人',time:'2026-10-13 10:20:00',content:'这里是独立网页版的聊天演示，所有账号与消息均为虚构。'},
 {id:'demo-2',type:2,own:true,sender:'演示用户',time:'2026-10-13 10:21:00',content:'文字、图片和历史记录可以在同一个界面查看。',unreadCount:0},
 {id:'demo-3',type:8,sender:'演示联系人',time:'2026-10-13 10:25:00',content:'[图片]',attachments:[{kind:'image',url:picture,original:picture,name:'demo-image.svg',width:600,height:320}]},
 {id:'demo-4',type:2,own:true,time:'2026-10-13 10:26:00',content:'图片收到，可以查看原图。',unreadCount:0},
 {id:'demo-5',type:2,sender:'演示联系人',time,content:'支持拖拽、粘贴和多图发送，也可以逐页读取历史消息。'}
];
const staticFiles={'/':'web/index.html','/app.js':'web/app.js','/style.css':'web/style.css','/api/ui/chat-utils':'web/chat-utils.mjs','/api/ui/markdown':'web/markdown.mjs','/api/ui/composer-utils':'web/composer-utils.mjs'};
async function setup(page, options={}) {
 await page.addInitScript(() => {
  // Replace the realtime transport, so screenshots never contact upstream services.
  window.EventSource = class {
   constructor(){setTimeout(()=>this.onmessage?.({data:JSON.stringify({status:'connected',kind:'status'})}),100);}
   close(){}
  };
 });
 await page.route('**/*', async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin)return route.abort();
  const file=staticFiles[url.pathname];
  if(file)return route.fulfill({body:fs.readFileSync(path.join(root,file)),contentType:file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'});
  if(options.handle&&await options.handle(route,url))return;
  let data;
  switch(url.pathname){
   case '/api/status':data={authenticated:true};break;
   case '/api/me':data={name:'演示用户',avatar:''};break;
   case '/api/sync':data={items:chats,unread:5,syncedAt:'2026-10-13T10:30:00+08:00'};break;
   case '/api/history':data={items:url.searchParams.has('after')?[]:messages,more:false,oldest:'demo-1',newest:'demo-5'};break;
   case '/api/members':data={items:[{id:'demo-member',name:'演示成员',avatar:''},{id:'other',name:'其他成员',avatar:''}]};break;
   case '/api/read-state':data={counts:{'demo-2':0,'demo-4':0}};break;
   case '/api/ui/emojis':data={};break;
   default:return route.fulfill({status:404,body:'{"error":"Preview request blocked"}',contentType:'application/json'});
  }
  return route.fulfill({json:data});
 });
 await page.goto(origin);
 await page.locator('.conversation').first().waitFor();
 await page.locator('.conversation').first().click();
 await page.locator('[data-message-id="demo-5"]').waitFor();
 await page.addStyleTag({content:`
  /* Irreversible opaque redaction in the rendered PNG, even for synthetic identities. */
  .conversation-name,.message-sender,#chat-name{color:transparent!important;background:#bac5d5!important;border-radius:4px;user-select:none}
  #chat-name{width:150px}.message-sender{width:72px}.conversation-name{max-width:112px}
  .avatar{color:transparent!important;background:repeating-linear-gradient(45deg,#ced8e6 0 5px,#e5eaf2 5px 10px)!important}
  .demo-watermark{position:fixed;z-index:1000;right:18px;top:12px;font-size:11px;color:#61758d;background:#f0f5fa;border:1px solid #dce5ef;padding:5px 10px;border-radius:20px;pointer-events:none}
 `});
 await page.evaluate(()=>{const label=document.createElement('div');label.className='demo-watermark';label.textContent='脱敏演示 · 虚构数据';document.body.append(label);});
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(img=>img.decode().catch(()=>{})));});
}
async function capturePreviews(){
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
 try{
  const desktop=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
  await setup(desktop);
  await desktop.screenshot({path:path.join(out,'chat-desktop.png')});
  const fixture=fs.readFileSync(path.join(root,'tests/fixtures/sample.png'));
  await desktop.locator('#files').setInputFiles([
   {name:'demo-landscape.png',mimeType:'image/png',buffer:fixture},
   {name:'demo-preview.png',mimeType:'image/png',buffer:fixture}
  ]);
  await desktop.locator('.preview').nth(1).waitFor();
  await desktop.locator('#text').fill('两张演示图片已加入队列，点击发送后逐张上传。');
  await desktop.screenshot({path:path.join(out,'image-queue.png')});
  const mobile=await browser.newPage({viewport:{width:430,height:932},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await setup(mobile);
  await mobile.screenshot({path:path.join(out,'chat-mobile.png')});
  console.log('Created 3 redacted screenshots using synthetic data. No account or network service used.');
 }finally{await browser.close();}
}
module.exports={setup,origin,chats,messages};
if(require.main===module)capturePreviews().catch(error=>{console.error(error);process.exitCode=1;});
