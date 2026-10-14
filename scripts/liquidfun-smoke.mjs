import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const base=process.env.SITE_URL || 'http://127.0.0.1:4187/fluid-pocket-sandbox/';
const server=process.env.SITE_URL ? null : spawn(process.execPath,['scripts/dev-server.mjs'],{stdio:'ignore',env:{...process.env,PORT:'4187',BASE_PATH:'/fluid-pocket-sandbox'}});
let browser;
try {
  if(server)for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await sleep(100);}
  browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage',...JSON.parse(process.env.BROWSER_ARGS||'[]')]});
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
  if(await page.locator('[data-action="confirm-new"]').isVisible().catch(()=>false))
    await page.locator('[data-action="confirm-new"]').click();
  try{await page.waitForSelector('body[data-game-state="brewing"]',{timeout:10000});}
  catch(e){
    const details=await page.evaluate(()=>({body:document.body?.dataset,html:document.body?.innerText?.slice(-850),toast:document.querySelector('#toast')?.textContent,sheet:document.querySelector('#sheet')?.open}));
    console.error('LIQUIDFUN BREW INIT DEBUG',JSON.stringify({details,errors,consoleErrors}));
    throw e;
  }
  assert.equal(await page.locator('body').getAttribute('data-physics-engine'),'liquidfun');
  await page.locator('[data-ingredient="1"]').click();
  await page.locator('[data-dose="5"]').click();
  await page.locator('#pourBtn').click();
  await page.waitForTimeout(250);
  const physical=await page.evaluate(()=>({
    particleCount:window.Module._b2ParticleSystem_GetParticleCount(window.world.particleSystems[0].ptr),
    body:document.body.dataset,errors:document.querySelector('.startup')?.textContent
  }));
  assert.equal(physical.particleCount,20,'a 5ml pour must retain all 20 native parcels');
  const stress=await page.evaluate(async()=>{
    const {BrewingSession}=await import('./src/game/brewing.mjs');
    const {generateWorld}=await import('./src/game/world.mjs');
    const {Phase}=await import('./src/simulation/Phase.mjs');
    const results=[];
    for(let cycle=0;cycle<4;cycle++){
      const brew=new BrewingSession(generateWorld('liquidfun-browser-stress').ingredients,{cauldron:2});
      try {
        brew.pour(1,440,{1:500});
        const ps=brew.engine.ps,backend=brew.engine.liquidFun,times=[];
        const count=()=>Module._b2ParticleSystem_GetParticleCount(backend.system.ptr);
        for(let tick=0;tick<240;tick++){
          const start=performance.now();
          if(tick<100)brew.assistStir();
          brew.step();times.push(performance.now()-start);
          if(count()!==ps.count)throw new Error(`Native parcel loss: ${count()} vs ${ps.count}`);
        }
        // Freezing removes native liquid membership; melting restores it.
        for(let i=0;i<ps.count;i+=3){ps.setPhase(i,Phase.SOLID);ps.solidSubdivision[i]=1;ps.temperature[i]=0;}
        brew.step();const frozenCount=count();
        for(let i=0;i<ps.count;i++){ps.setPhase(i,Phase.LIQUID);ps.temperature[i]=.33;}
        brew.step();const meltedCount=count();
        brew.bottle(100);brew.step();const bottledCount=count(),bottledVolume=brew.occupiedVolume;
        const bottledRadius=backend.system.radius;
        const snapshot=brew.snapshot();brew.clean();brew.restore(snapshot);brew.step();
        if(count()!==ps.count)throw new Error('Restoring a bottle changed native membership');
        for(let i=0;i<ps.count;i++)if(!Number.isFinite(ps.x[i]+ps.y[i]+ps.vx[i]+ps.vy[i]))throw new Error('Nonfinite particle');
        times.sort((a,b)=>a-b);
        results.push({cycle,frozenCount,meltedCount,bottledCount,bottledVolume,bottledRadius,median:times[120],p95:times[228]});
      }finally{brew.dispose();}
    }
    return results;
  });
  for(const result of stress){
    assert.equal(result.frozenCount,1173);assert.equal(result.meltedCount,1760);assert.equal(result.bottledCount,1760);
    assert.ok(Math.abs(result.bottledVolume-340)<.01);assert.ok(result.bottledRadius<.035);
  }
  assert.deepEqual(errors,[],'no uncaught browser exceptions: '+errors.join('; '));
  console.log('LiquidFun native parcel integrity, full-pot stirring/freezing/melting/bottling/reload and repeated disposal OK',JSON.stringify({physical,stress}));
}finally {
  await browser?.close();
  server?.kill();
}
