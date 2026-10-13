// Optional standalone browser regression. Synthetic fixtures; no real login or sends.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {setup,chats,messages,origin}=require('../scripts/capture-previews.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];let requests=0,initialHistory=0;
  page.on('pageerror',e=>errors.push(e.message));
  const media='/api/media?key=synthetic-image';
  const rows=messages.map(row=>row.id==='demo-3'?{...row,attachments:[{kind:'image',url:media,original:media,name:'demo.png',width:360,height:220}]}:row);
  await setup(page,{handle:async(route,url)=>{
   if(url.pathname==='/api/media'){requests++;await route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(__dirname,'fixtures/sample.png'))});return true;}
   if(url.pathname==='/api/history'){if(!url.searchParams.has('after'))initialHistory++;await route.fulfill({json:{items:url.searchParams.has('after')?[]:rows,more:false,oldest:'demo-1',newest:'demo-5'}});return true;}
   return false;
  }});
  const decode=()=>page.locator('.message-image').evaluate(img=>new Promise((resolve,reject)=>{
   const end=Date.now()+10000;function check(){if(img.naturalWidth)return img.decode().then(resolve,reject);if(Date.now()>end)return reject(Error('Image did not load'));setTimeout(check,50);}check();
  }));
  await decode();const source=await page.locator('.message-image').getAttribute('src');assert(source.startsWith('blob:'));
  assert.equal(await page.locator('[data-message-id="demo-1"] .message-sender').textContent(),'演示联系人');
  await page.locator('#text').fill('保留网页版草稿');
  await page.locator('#messages').evaluate(node=>{node.scrollTop=50;});
  for(let i=0;i<3;i++){
   await page.locator('button[data-id="demo-helper"]').click();await decode();
   await page.locator('button[data-id="demo-team"]').click();await decode();
   assert.equal(await page.locator('.message-image').getAttribute('src'),source);
   assert.equal(await page.locator('#text').inputValue(),'保留网页版草稿');
  }
  assert.equal(requests,1);assert.equal(initialHistory,2);
  await page.locator('.message-image').click();await page.locator('#full-image').evaluate(img=>img.decode());
  assert.equal(await page.locator('#full-image').getAttribute('src'),source);assert.equal(requests,1);
  assert.deepEqual(errors,[]);

  const login=await browser.newPage();
  const files={'/':'web/index.html','/app.js':'web/app.js','/style.css':'web/style.css','/api/ui/chat-utils':'web/chat-utils.mjs','/api/ui/composer-utils':'web/composer-utils.mjs','/api/ui/markdown':'web/markdown.mjs','/api/ui/media-cache':'web/media-cache.mjs'};
  await login.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
   const file=files[url.pathname];if(file)return route.fulfill({body:fs.readFileSync(path.join(__dirname,'..',file)),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'});
   if(url.pathname==='/api/status')return route.fulfill({json:{authenticated:false}});
   if(url.pathname==='/api/login/start')return route.fulfill({json:{image:'/api/login/qr-image'}});
   if(url.pathname==='/api/ui/emojis')return route.fulfill({json:{}});
   return route.fulfill({status:404,contentType:'application/json',body:'{}'});
  });
  await login.goto(origin);await login.locator('#refresh').click();
  await login.locator('#login-status').filter({hasText:'二维码图片加载失败'}).waitFor();
  assert(await login.locator('#qr-placeholder').isVisible());assert(!(await login.locator('#qr').isVisible()));
  console.log('Standalone browser checks passed: image fetched once across chat switches and preview, names, draft preservation and QR failure recovery.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
