// Optional online check in an isolated Harness profile. Generates a QR only;
// never scans it, sends messages, or saves the QR/authentication URL.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const target=process.env.DSH_TEST_URL;if(!target)throw Error('Set DSH_TEST_URL to the isolated Harness login URL');
 const url=new URL(target);if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Only a local test Harness is allowed');
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(target);
  const entry=page.getByText(/^(云之家|Yunzhijia)$/);await entry.waitFor();
  try{const notice=page.getByText('继续',{exact:true}).or(page.getByText('Continue',{exact:true}));await notice.waitFor({timeout:10000});await notice.click();}catch{}
  try{const defer=page.getByText('稍后配置',{exact:true}).or(page.getByText('Configure later',{exact:true}));await defer.waitFor({timeout:3000});await defer.click();}catch{}
  await entry.click();
  const frame=page.frameLocator('iframe[title="云之家聊天"]');
  await frame.getByRole('button',{name:'获取登录二维码',exact:true}).click();
  await frame.locator('#qr').evaluate(img=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('QR did not decode')),25000);
   function check(){if(img.complete&&img.naturalWidth>0){clearTimeout(timer);resolve();}else setTimeout(check,100);}
   check();
  }));
  const dimensions=await frame.locator('#qr').evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight}));
  assert(dimensions.width>0&&dimensions.height>0);assert.deepEqual(errors,[]);
  console.log('Harness QR image decoded successfully:',dimensions.width+'x'+dimensions.height);
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message.replace(/https?:\/\/\S+/g,'[URL omitted]'));process.exitCode=1;});
