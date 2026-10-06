// Optional: npm ci && npx playwright install --with-deps chromium && npm run test:browser
const {chromium}=require('playwright'),fs=require('fs'),assert=require('node:assert/strict'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const source=fs.readFileSync(path.join(ROOT,'tsukiyo-phone-2.5.0.js'),'utf8');
 const js=source.slice(0,source.lastIndexOf('TsukiyoPhoneBundle.start('));
 for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
  const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#e9e8e1"></body></html>'}));
  await page.goto('https://phone.test/');await page.addScriptTag({content:js+'\nwindow.app=TsukiyoPhoneBundle.start({mode:"demo",source:window});'});
  await page.waitForFunction(()=>window.app.engine.state==='ready');
  await page.evaluate(()=>{const e=app.engine;e.arc.stop();e.scheduler.stop();e.memoryBook.stop();clearInterval(e.timer);app.ui.open('visualRules');});
  await page.waitForTimeout(500);
  await page.getByRole('button',{name:'新增条目',exact:true}).click();
  await page.getByLabel('标题',{exact:true}).fill('浏览器编辑测试');
  await page.locator('#modals textarea[name="text"]').fill('BROWSER_CUSTOM_RULE：服装颜色以最新正文为准。');
  await page.getByLabel('参与视觉分析（受6000字符总预算限制）',{exact:true}).check();
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.waitForFunction(()=>app.engine.repo.data.studio.rules.some(r=>r.title==='浏览器编辑测试'));
  await page.locator('details.card').first().locator('summary').click();
  await page.locator('details.card').first().getByRole('button',{name:'编辑',exact:true}).click();
  await page.locator('#modals textarea[name="text"]').fill('BROWSER_EDITED_BUILTIN：保留原有外观，明确发生才更新。');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.waitForFunction(()=>app.engine.repo.data.studio.rules.some(r=>r.text.startsWith('BROWSER_EDITED_BUILTIN')));
  await page.evaluate(async()=>{app.engine.router.call=async(module,req)=>{window.lastVisual=req;return '{"characters":[]}';};await app.engine.visual.sync();});
  assert.ok(await page.evaluate(()=>lastVisual.system.includes('BROWSER_CUSTOM_RULE')));
  await page.evaluate(()=>app.ui.open('studio'));await page.waitForTimeout(500);
  for(const tab of ['众生侧写','世界状态','亲历记忆','输入与日志','事件导演'])await page.getByRole('button',{name:tab,exact:true}).click();
  await page.getByRole('button',{name:'手写事件',exact:true}).click();
  await page.getByLabel('标题',{exact:true}).fill('灯市的小插曲');
  await page.getByLabel('阶段钩子：每行一个（1—6行）',{exact:true}).fill('一盏花灯的丝带被风吹落到脚边。\n卖花灯的人走近，等待回应。');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.waitForTimeout(150);
  await page.waitForFunction(()=>app.engine.repo.data.studio.pool.length===1);
  const overflow=await page.evaluate(()=>{const m=app.ui.shadow.getElementById('main');return m.scrollWidth-m.clientWidth;});assert.ok(overflow<3,`${name}: overflow ${overflow}`);
  await page.screenshot({path:path.join(ROOT,`verification/v25-${name}.png`),fullPage:true});
  assert.deepEqual(errors,[]);console.log(`BROWSER_${name.toUpperCase()}_OK: new/edit rules -> save -> AVS prompt; five workbench tabs; manual event form; no page errors; no horizontal overflow`);
  await page.evaluate(()=>app.dispose());await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
