// Optional browser integration checks: all requests use synthetic fixtures.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {setup,messages}=require('../scripts/capture-previews.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],posts=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   navigator.mediaDevices.getDisplayMedia=async()=>{
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;const ctx=canvas.getContext('2d');ctx.fillStyle='#6c98dc';ctx.fillRect(0,0,640,400);ctx.fillStyle='white';ctx.fillText('Synthetic screenshot',30,30);
    const stream=canvas.captureStream(10);for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{window.captureStopped=true;stop();};}return stream;
   };
  });
  await setup(page,{handle:async(route,url)=>{
   if(url.pathname.startsWith('/api/messages/')){
    posts.push({path:url.pathname,body:route.request().postData()});
    await route.fulfill({json:{success:true,msgId:'mock-sent',groupId:'demo-team'}});return true;
   }
   if(url.pathname==='/api/history'&&!url.searchParams.has('after')){
    await route.fulfill({json:{items:[...messages,{id:'markdown-demo',type:2,time:'2026-10-13 10:31:00',sender:'演示成员',content:'# Markdown 文档\n\n**重点**\n\n| 功能 | 状态 |\n| --- | --- |\n| 文件 | 就绪 |\n\n```js\nconst ok = true;\n```\n\n<script>window.leaked=true</script>\n![remote](https://invalid.example/track)'},{id:'markdown-file',type:8,time:'2026-10-13 10:32:00',attachments:[{kind:'file',name:'demo.md',size:80,url:'/api/media?key=demo-md',download:'/api/media?key=demo-md'}]}],more:false,oldest:'demo-1',newest:'markdown-file'}});return true;
   }
   if(url.pathname==='/api/document'){await route.fulfill({json:{name:'demo.md',text:'# 附件文档\n\n- 预览成功'}});return true;}
   return false;
  }});
  assert.equal(await page.locator('[data-message-id="markdown-demo"] h1').textContent(),'Markdown 文档');
  assert.equal(await page.locator('[data-message-id="markdown-demo"] table').count(),1);
  assert.equal(await page.locator('[data-message-id="markdown-demo"] script').count(),0);
  assert.equal(await page.locator('[data-message-id="markdown-demo"] img').count(),0);
  assert.equal(await page.evaluate(()=>window.leaked),undefined);
  await page.locator('.document-preview-button').click();await page.locator('#document-content h1').waitFor();assert.equal(await page.locator('#document-content h1').textContent(),'附件文档');await page.locator('#document-close').click();
  await page.locator('#mention-button').click();await page.locator('.mention-option').first().waitFor();await page.locator('#text').press('Enter');
  assert.equal(await page.locator('#text').inputValue(),'@演示成员 ');
  await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#send-status').textContent==='已发送');
  const mentionPost=JSON.parse(posts.find(x=>x.path==='/api/messages/text').body);assert.deepEqual(mentionPost.mentions,[{id:'demo-member',start:0,end:5}]);
  await page.locator('#attachments').setInputFiles({name:'demo.md',mimeType:'text/markdown',buffer:Buffer.from('# Test file')});await page.locator('.queue-file-icon').waitFor();await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#send-status').textContent==='已发送');assert(posts.some(x=>x.path==='/api/messages/file'&&x.body.includes('# Test file')));
  await page.locator('#text').fill('## 草稿预览\n\n- 项目一');await page.locator('#markdown-toggle').click();assert.equal(await page.locator('#markdown-preview h2').textContent(),'草稿预览');
  await page.locator('#capture-screen').click();await page.locator('#screenshot-dialog').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>window.captureStopped),true);
  const box=await page.locator('#screenshot-canvas').boundingBox();await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();await page.mouse.move(box.x+110,box.y+90);await page.mouse.up();assert.equal(await page.locator('#screenshot-size').textContent(),'100 × 80');await page.locator('#screenshot-add').click();await page.locator('.preview img').waitFor();
  const dimensions=await page.locator('.preview img').evaluate(img=>({w:img.naturalWidth,h:img.naturalHeight}));assert.deepEqual(dimensions,{w:100,h:80});
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: @ member payload, file send, screenshot crop/track cleanup, Markdown message/draft/document and HTML safety. No real messages sent.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
