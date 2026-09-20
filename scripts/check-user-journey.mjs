// Browser regression on an isolated local database. Never creates production users or calls models.
// CAMPUS_TEST_URL=http://127.0.0.1:3120 AGENTNET_PLAYWRIGHT_MODULE=<optional module URL> node scripts/check-user-journey.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base=process.env.CAMPUS_TEST_URL??'http://127.0.0.1:3120';
assert(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname),'Local preview only');
const {chromium}=await import(process.env.AGENTNET_PLAYWRIGHT_MODULE??'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
await mkdir('.campus-local/qa',{recursive:true});
try{
 for(const [label,width,height] of [['desktop',1440,900],['mobile',390,844]]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  if(process.env.CAMPUS_TEST_LOGIN==='email'){
   const {emailCookie}=await import('./email-http-fixture.mjs'),cookie=await emailCookie(base);
   await context.addCookies([{name:'campus_session',value:cookie.split('=')[1],url:base,httpOnly:true,sameSite:'Lax'}]);
  }
  const boot=page.waitForResponse(r=>r.url()===base+'/api/world');
  await page.goto(base+'/#library',{waitUntil:'domcontentloaded'});await boot;
  await page.getByRole('button',{name:'打开我的校园伙伴'}).click();
  await page.getByLabel('伙伴的昵称').fill('体验验证'+label);
  await page.getByRole('button',{name:/创建(角色|伙伴)，进入校园/}).click();
  if(process.env.CAMPUS_TEST_LOGIN!=='email')await page.getByRole('button',{name:'我已保存，收起密钥'}).click();
  await page.getByRole('tab',{name:'连接与设置'}).waitFor();
  assert((await page.getByRole('tab',{name:'和他聊聊'}).boundingBox()).y<height/2,'Daily tasks above the fold');

  await page.getByText('HTTP 一次体验：复制角色接入说明',{exact:true}).click();
  await page.getByRole('button',{name:'生成接入说明',exact:true}).click();
  await page.getByRole('button',{name:'复制给我的助手',exact:true}).waitFor();
  // Clipboard denial exposes an actually usable manual fallback; no secret is logged.
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Permission denied');}}}));
  await page.getByRole('button',{name:'复制给我的助手',exact:true}).click();
  await page.getByLabel('完整接入说明',{exact:true}).waitFor();
  const instructions=await page.getByLabel('完整接入说明',{exact:true}).inputValue();
  const token=instructions.match(/Authorization: Bearer ([a-f0-9]{64})/)[1];
  await page.getByRole('tab',{name:'和他聊聊'}).click();
  await page.getByLabel('给角色的私信').fill('未发送草稿');
  await page.getByRole('tab',{name:'校园经历'}).click();
  await page.getByRole('tab',{name:'和他聊聊'}).click();
  assert.equal(await page.getByLabel('给角色的私信').inputValue(),'未发送草稿');
  await page.getByLabel('给角色的私信').fill('今天想在校园结识朋友');
  await page.getByRole('button',{name:'发送私信'}).click();
  await page.getByRole('status').filter({hasText:'消息已保存。伙伴恢复思考且助手在线后'}).waitFor();
  await page.screenshot({path:`.campus-local/qa/journey-chat-${label}.png`});
  await page.getByRole('tab',{name:'连接与设置'}).click();
  assert.equal(await page.getByLabel('完整接入说明',{exact:true}).inputValue(),instructions,'Tab switch retains one-time credential');
  await page.route('**/api/world',route=>route.abort('failed'));
  await page.getByRole('button',{name:'检查连接状态',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'无法判断助手状态'}).waitFor();
  assert.equal(await page.getByText(/还没收到助手的连接/).count(),0,'Network failure must not diagnose agent offline');
  await page.unroute('**/api/world');
  await page.getByRole('button',{name:'检查连接状态',exact:true}).click();
  const tool=async(name,args)=>{const r=await context.request.post(base+'/api/campus/tools/'+name,{headers:{Authorization:'Bearer '+token},data:args});assert.equal(r.status(),200);return r.json();};
  await tool('campus_observe',{clientName:'Local browser fixture',runForSeconds:600});
  await page.getByRole('button',{name:'检查连接状态',exact:true}).click();
  await page.locator('.companion-now').getByRole('button',{name:'暂停思考'}).click();
  await page.locator('.campus-agent-connection').getByRole('button',{name:'恢复思考',exact:true}).waitFor();
  await page.screenshot({path:`.campus-local/qa/journey-paused-${label}.png`});
  await page.locator('.campus-agent-connection').getByRole('button',{name:'恢复思考',exact:true}).click();
  // Exhaust budget while the driver still has a live heartbeat.
  const response=await context.request.post(base+'/api/world',{headers:{Origin:base},data:{op:'budget',dailyLimit:0}});assert.equal(response.status(),200);
  await page.locator('.campus-agent-connection').getByRole('button',{name:'调整活动体力'}).waitFor();
  await page.locator('.campus-agent-connection').getByRole('button',{name:'调整活动体力'}).click();
  assert.equal(await page.locator('#agent-budget').getAttribute('open'),'');
  await page.getByLabel('自定义每天可活动次数（0–144）').fill('24');
  await page.getByRole('button',{name:'保存体力',exact:true}).click();
  await page.getByText('活动体力已保存。',{exact:true}).waitFor();
  await page.getByRole('tab',{name:'校园相遇'}).click();
  await page.getByRole('heading',{name:'一起做的事'}).waitFor();
  await page.getByRole('tab',{name:'校园经历'}).click();
  await page.getByLabel('找回以前的经历').fill('不可能命中的测试词');
  await page.getByRole('button',{name:'查找',exact:true}).click();
  await page.getByText('还没有匹配记录，试试其他关键词。',{exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.companion-sheet').waitFor({state:'hidden'});
  assert.equal(new URL(page.url()).hash,'#library','Closing sheet retains map selection');
  await page.getByRole('button',{name:'打开我的校园伙伴'}).click();
  await page.getByRole('tab',{name:'连接与设置'}).click();
  // A fresh page no longer has the one-time token; replacement must be deliberate.
  const reloaded=page.waitForResponse(r=>r.url()===base+'/api/world');await page.reload({waitUntil:'domcontentloaded'});await reloaded;
  await page.getByRole('button',{name:'打开我的校园伙伴'}).click();
  await page.getByRole('tab',{name:'连接与设置'}).click();
  await page.getByText('使用其他助手 / 手动设置',{exact:true}).click();
  await page.getByRole('button',{name:'生成新的连接信息',exact:true}).click();
  await page.getByRole('button',{name:'保留现有连接',exact:true}).click();
  await tool('campus_status',{}); // Cancel must preserve existing authorization.
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS',label,'creation, tabs, draft, offline message, clipboard denial, network recovery, pause, budget, history, escape, cancel credential replacement');
  await context.close();
 }
}finally{await browser.close();}
