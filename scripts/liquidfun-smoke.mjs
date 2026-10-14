import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const base='http://127.0.0.1:4187/fluid-pocket-sandbox/';
const server=spawn(process.execPath,['scripts/dev-server.mjs'],{stdio:'ignore',env:{...process.env,PORT:'4187',BASE_PATH:'/fluid-pocket-sandbox'}});
let browser;
try {
  for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await sleep(100);}
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage();
  const errors=[],consoleErrors=[];
  page.on('pageerror',e=>errors.push(e.stack||e.message));
  page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text());});
  page.on('requestfailed',r=>consoleErrors.push('REQUEST '+r.url()+': '+r.failure()?.errorText));
  await page.goto(base);
  try {await page.waitForSelector('body[data-game-ready="true"]',{timeout:13000});}
  catch(e){
    const state=await page.evaluate(()=>({body:document.body?.dataset,html:document.body?.innerText?.slice(0,600),
      runtime:typeof window.b2World,worker:typeof window.Module,script:!!document.querySelector('script[src*="liquidfun"]')}));
    console.error('LIQUIDFUN STARTUP DEBUG',JSON.stringify({state,errors,consoleErrors}));
    throw e;
  }
  assert.equal(await page.evaluate(()=>typeof b2World),'function','Google LiquidFun must be present');
  await page.locator('#worldSeed').fill('liquidfun-smoke');
  await page.locator('#newWorldBtn').click();
  await page.waitForSelector('body[data-game-state="brewing"]',{timeout:10000});
  assert.equal(await page.locator('body').getAttribute('data-physics-engine'),'liquidfun');
  await page.locator('[data-ingredient="1"]').click();
  await page.locator('[data-dose="5"]').click();
  await page.locator('#pourBtn').click();
  await page.waitForTimeout(250);
  const physical=await page.evaluate(()=>({
    particleCount:window.world?.particleSystems?.[0]?.GetParticleCount(),
    body:document.body.dataset,errors:document.querySelector('.startup')?.textContent
  }));
  assert.ok(physical.particleCount>0,JSON.stringify(physical));
  assert.deepEqual(errors,[],'no uncaught browser exceptions: '+errors.join('; '));
  console.log('LiquidFun runtime initialized, particles stepped in native C++ engine, cauldron ready',physical);
}finally {
  await browser?.close();
  server.kill();
}
