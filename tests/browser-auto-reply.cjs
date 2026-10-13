// Optional browser check in an isolated Harness. No real account/model/messages.
const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const target=process.env.DSH_TEST_URL;if(!target||!['127.0.0.1','localhost'].includes(new URL(target).hostname))throw Error('Local isolated DSH_TEST_URL required');
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
 try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let config={enabled:false,recipients:[],mentionOnly:true,prompt:'',recipientPrompts:{},pollIntervalMs:4000,replyTimeoutMs:180000,maxConcurrent:2,allowedTools:[]},saved,missing=true;
 const chats=[{id:'person',name:'测试联系人',isGroup:false,canSend:true},{id:'group',name:'测试群聊',isGroup:true,canSend:true}];
 await page.route('**/plugins/yzj/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname.split('/api/')[1];if(path.startsWith('ui/'))return route.continue();let data={};
  if(path==='auto-reply'){if(missing)return route.fulfill({status:404,json:{error:'Not found'}});if(route.request().method()==='POST'){saved=route.request().postDataJSON();config=saved.config;}data={accountId:'test-account',config};}
  else if(path==='status')data={authenticated:true};else if(path==='me')data={id:'test-account',name:'测试用户'};
  else if(['sync','conversations'].includes(path))data={items:chats,unread:0,syncedAt:Date.now()};else if(path==='events')return route.fulfill({contentType:'text/event-stream',body:'data: {"status":"connected","kind":"status"}\n\n'});
  else if(path==='history')data={items:[],more:false};else if(path==='read-state')data={counts:{}};else throw Error('Unexpected test API '+path);
  await route.fulfill({json:data});
 });
 await page.goto(target);const entry=page.getByText(/^(云之家|Yunzhijia)$/);await entry.waitFor();
 try{const n=page.getByText('继续',{exact:true}).or(page.getByText('Continue',{exact:true}));await n.waitFor({timeout:5000});await n.click();}catch{}
 try{const n=page.getByText('稍后配置',{exact:true}).or(page.getByText('Configure later',{exact:true}));await n.waitFor({timeout:2000});await n.click();}catch{}
 await entry.click();const frame=page.frameLocator('iframe[title="云之家聊天"]');await frame.locator('#auto-reply-nav').click();await frame.locator('#auto-status').filter({hasText:'请完整重启 Harness'}).waitFor();assert(await frame.locator('#auto-save').isDisabled());missing=false;await frame.locator('#auto-reload').click();await frame.locator('[data-recipient="group"]').waitFor();await frame.locator('#auto-search').fill('别名关键词');await frame.locator('#auto-search').press('Enter');await frame.locator('[data-recipient="group"]').waitFor({state:'visible'});
 await frame.locator('#auto-enabled').check();await frame.locator('[data-recipient="person"]').check();await frame.locator('[data-recipient="group"]').check();
 await frame.locator('#auto-prompt').fill('用简洁友好的中文回复');await frame.getByLabel('测试群聊的回复提示词',{exact:true}).fill('只回答项目进度相关的问题');
 await frame.locator('#auto-save').click();await frame.locator('#auto-status').filter({hasText:'已保存并开启'}).waitFor();
 assert.deepEqual(saved.config.recipients,['person','group']);assert.equal(saved.config.mentionOnly,true);assert.equal(saved.config.prompt,'用简洁友好的中文回复');assert.equal(saved.config.recipientPrompts.group,'只回答项目进度相关的问题');
 await frame.locator('#auto-reload').click();await frame.locator('#auto-status').filter({hasText:'自动回复已开启'}).waitFor();assert(await frame.locator('#auto-enabled').isChecked());assert.equal(await frame.locator('#auto-prompt').inputValue(),config.prompt);
 await frame.locator('#auto-enabled').uncheck();await frame.locator('#auto-save').click();await frame.locator('#auto-status').filter({hasText:'自动回复已关闭'}).waitFor();assert.equal(saved.config.enabled,false);
 await frame.locator('#auto-reply-back').click();assert(await frame.locator('#chat-main').isVisible());await page.setViewportSize({width:950,height:900});assert(await frame.locator('#auto-reply-nav').isVisible());await frame.locator('#auto-reply-nav').click();await frame.locator('#auto-status').filter({hasText:'自动回复已关闭'}).waitFor();assert(await frame.locator('#auto-save').isVisible());assert.deepEqual(errors,[]);
 console.log('Harness settings browser check passed: recipient/group selection, global/per-chat prompts, save/reload, disable and return to chat.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message.replace(/https?:\/\/\S+/g,'[URL omitted]'));process.exitCode=1;});
