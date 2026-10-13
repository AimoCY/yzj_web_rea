// Optional Playwright check against an isolated Harness; all chat data is synthetic.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const target=process.env.DSH_TEST_URL;if(!target)throw Error('Set DSH_TEST_URL to an isolated Harness login URL');
 if(!['127.0.0.1','localhost'].includes(new URL(target).hostname))throw Error('Local Harness required');
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let documents=0,fullSyncs=0,initialHistory=0,imageRequests=0;
  page.on('request',r=>{if(new URL(r.url()).pathname==='/plugins/yzj/')documents++;});
  const conversation={id:'demo',name:'测试会话',isGroup:false,canSend:true,unread:0,lastTime:'2026-10-13 10:00:00',content:'测试消息'};
  const other={...conversation,id:'other',name:'另一个测试会话'};
  const messages=Array.from({length:45},(_,i)=>({id:'m'+i,type:2,content:'测试消息 '+i,sender:'测试联系人',time:'2026-10-13 10:00:00',param:{}}));
  messages[44].attachments=[{kind:'image',name:'测试图片',url:'/plugins/yzj/api/media?key=synthetic',width:32,height:32}];
  await page.route('**/plugins/yzj/api/**',async route=>{
   const url=new URL(route.request().url()),path=url.pathname.split('/api/')[1];
   if(path==='media'){imageRequests++;return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKUlEQVR4nO3NQQkAAAgEsItkRJtrCh/CYP+lek5FIBAIBAKBQCAQfAkW9G68WxRbPK8AAAAASUVORK5CYII=','base64')});}
   if(path.startsWith('ui/'))return route.continue();
   let data={};
   if(path==='status')data={authenticated:true};
   else if(path==='me')data={id:'self',name:'测试用户'};
   else if(path==='sync'){if(url.searchParams.has('full'))fullSyncs++;data={items:[conversation,other],unread:0,syncedAt:Date.now()};}
   else if(path==='history'){if(!url.searchParams.has('after'))initialHistory++;data={items:messages,more:false,oldest:'m0',newest:'m44'};}
   else if(path==='read-state')data={counts:{}};
   else if(path==='members')data={items:[]};
   else if(path==='events')return route.fulfill({contentType:'text/event-stream',body:'data: {"status":"connected","kind":"status"}\n\n'});
   else throw Error('Unexpected API '+path);
   await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(target);
  const entry=page.getByText(/^(云之家|Yunzhijia)$/);await entry.waitFor();
  try{const notice=page.getByText('继续',{exact:true}).or(page.getByText('Continue',{exact:true}));await notice.waitFor({timeout:5000});await notice.click();}catch{}
  try{const defer=page.getByText('稍后配置',{exact:true}).or(page.getByText('Configure later',{exact:true}));await defer.waitFor({timeout:2000});await defer.click();}catch{}
  assert.equal(documents,0,'iframe is lazy until first visit');await entry.click();
  const frame=page.frameLocator('iframe[title="云之家聊天"]');
  await frame.locator('button[data-id="demo"]').click();await frame.locator('.message-row').last().waitFor();
  await frame.locator('.message-image').evaluate(img=>new Promise((resolve,reject)=>{const end=Date.now()+10000;function check(){if(img.naturalWidth)return img.decode().then(resolve,reject);if(Date.now()>end)return reject(Error('image did not load '+JSON.stringify({src:img.getAttribute('src'),rect:img.getBoundingClientRect().toJSON(),complete:img.complete,unavailable:img.className})));setTimeout(check,50);}check();}));
  const imageSource=await frame.locator('.message-image').getAttribute('src');assert(imageSource.startsWith('blob:'));
  await frame.locator('button[data-id="other"]').click();await frame.locator('.message-image').evaluate(img=>new Promise((resolve,reject)=>{const end=Date.now()+10000;function check(){if(img.naturalWidth)return img.decode().then(resolve,reject);if(Date.now()>end)return reject(Error('image did not load '+JSON.stringify({src:img.getAttribute('src'),rect:img.getBoundingClientRect().toJSON(),complete:img.complete,unavailable:img.className})));setTimeout(check,50);}check();}));
  await frame.locator('button[data-id="demo"]').click();await frame.locator('.message-image').evaluate(img=>new Promise((resolve,reject)=>{const end=Date.now()+10000;function check(){if(img.naturalWidth)return img.decode().then(resolve,reject);if(Date.now()>end)return reject(Error('image did not load '+JSON.stringify({src:img.getAttribute('src'),rect:img.getBoundingClientRect().toJSON(),complete:img.complete,unavailable:img.className})));setTimeout(check,50);}check();}));
  assert.equal(await frame.locator('.message-image').getAttribute('src'),imageSource);assert.equal(imageRequests,1);
  await frame.locator('#text').fill('保留未发送的草稿');
  await frame.locator('#attachments').setInputFiles({name:'draft.txt',mimeType:'text/plain',buffer:Buffer.from('draft attachment')});
  await frame.locator('#messages').evaluate(node=>{node.scrollTop=150;window.__menuMarker={};});
  const position=await frame.locator('#messages').evaluate(node=>node.scrollTop);
  await frame.locator('body').evaluate(()=>window.__menuDocument=crypto.randomUUID());
  const marker=await frame.locator('body').evaluate(()=>window.__menuDocument);
  for(let i=0;i<3;i++){
   await page.getByText(/^(插件|Plugins)$/,{exact:true}).click();
   await page.locator('iframe[title="云之家聊天"]').waitFor({state:'hidden'});
   await entry.click();await page.locator('iframe[title="云之家聊天"]').waitFor({state:'visible'});
   assert.equal(await frame.locator('#text').inputValue(),'保留未发送的草稿');
   assert.equal(await frame.locator('.message-row').count(),45);
   assert.equal(await frame.locator('body').evaluate(()=>window.__menuDocument),marker);
   assert.equal(await frame.locator('#messages').evaluate(node=>node.scrollTop),position);
   assert.match(await frame.locator('#previews').textContent(),/draft.txt/);
  }
  await page.getByText(/^(插件|Plugins)$/,{exact:true}).click();
  messages.push({id:'m45',type:2,content:'切走期间收到的新消息',sender:'测试联系人',time:'2026-10-13 10:01:00',param:{}});
  await entry.click();await frame.getByText('切走期间收到的新消息',{exact:true}).waitFor();
  await page.setViewportSize({width:1250,height:900});
  const bounds=await page.locator('iframe[title="云之家聊天"]').boundingBox();assert(bounds.width>0&&bounds.x+bounds.width<=1251);
  assert.equal(documents,1);assert.equal(fullSyncs,1);assert.equal(initialHistory,2);assert.equal(imageRequests,1);assert.deepEqual(errors,[]);
  console.log('Harness menu navigation preserves iframe, conversation, history, scroll, draft and attachment; image fetched once across chat switches.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message.replace(/https?:\/\/\S+/g,'[URL omitted]'));process.exitCode=1;});
