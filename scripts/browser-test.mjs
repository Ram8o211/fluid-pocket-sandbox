import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

// Exercise user-visible controls. Saved state is read solely for assertions
// and reproducible recipe guidance; the browser never writes test state.
const live=process.env.SITE_URL,base=live?new URL(live).href:'http://127.0.0.1:4176/fluid-pocket-sandbox/';
const server=live?null:spawn(process.execPath,['scripts/dev-server.mjs'],{stdio:'ignore',env:{...process.env,PORT:'4176',BASE_PATH:'/fluid-pocket-sandbox'}});
const errors=[],failedResponses=[];let browser,page;
const readSave=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('alchemists-shop-save')));
async function closePanel(){await page.locator('[data-action="close"]').first().click();}
async function screenshot(name){await page.screenshot({path:`test-results/${name}.png`});}
async function room(id){await page.locator(id).click();}
async function dose(amount){await page.locator(`[data-dose="${amount}"]`).click();}
async function pourRecipe(recipe){
  for(const portion of recipe.portions){await page.locator(`[data-ingredient="${portion.ingredientId}"]`).click();let remaining=portion.ml;while(remaining){const amount=[40,20,10,5].find(v=>v<=remaining);assert.ok(amount);await dose(amount);await page.locator(portion.crushed?'#grindBtn':'#pourBtn').click();remaining-=amount;}}
  if(recipe.stir){const box=await page.locator('#stirBtn').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(recipe.ticks*25+200);await page.mouse.up();}
}
async function compileCurrent(name){
  const state=await readSave(),report=state.experiments.records[0];
  await page.locator('[data-action="potion-id"]').click();
  await page.locator('#potionName').fill(name);
  for(const key of ['strength','love','death','transformation','fire','freeze','acidity','poison']){
    const input=page.locator(`[data-estimate="${key}"]`);
    await input.scrollIntoViewIfNeeded();
    const value=Math.round(report.sample[key]*100);
    await input.press('Home'); for(let n=0;n<value;n++)await input.press('ArrowRight');
  }
  await screenshot('potion-id');await page.locator('[data-action="compile-id"]').click();
}
async function brewAndSell(state,subject){
  await pourRecipe(state.order.witness);await room('#experimentsBtn');
  await page.locator(`[data-subject="${subject}"]`).click();
  await page.locator(`[data-test="${subject}"]`).click();
  assert.equal(await page.locator('.effect-reading').count(),0,'creature trials must not reveal automatic effect values');
  assert.doesNotMatch(await page.locator('#sheetContent').textContent(),/Discovered effects|stronger and more|Fire aura|Health.*→/);
  await screenshot('creature-response');
  await page.locator('[data-action="untreated"]').click();assert.equal(await page.locator('[data-action="untreated"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-action="untreated"]').click();
  await compileCurrent('Travelling tonic');
  assert.equal((await readSave()).potionIds.length,state.potionIds.length+1);
  await page.locator('#bottleBtn').click();
  assert.equal(await page.locator('[data-action="sell"]').isDisabled(),false,'bottling preserves the observed and identified batch');
  assert.doesNotMatch(await page.locator('#sheetContent').textContent(),/observed match|quality|Density|Acidity/);
  await page.locator('[data-action="sell"]').click();
  const offer=(await readSave()).negotiation.offer;
  await page.locator('#sellerPrice').fill(String(state.order.budget*2));await page.locator('[data-action="counter-offer"]').click();
  assert.ok((await readSave()).negotiation.offer>offer);
  await screenshot('bargaining');await page.locator('[data-action="accept-offer"]').click();
  const sold=await readSave();assert.equal(sold.completed,state.completed+1);assert.ok(sold.deliveries.length>0);assert.equal(sold.pendingBottle,null);
  await screenshot('negotiated-delivery');await page.locator('[data-action="next"]').click();
  await page.waitForSelector('body[data-game-state="brewing"]');
}
try{
  await mkdir('test-results',{recursive:true});
  if(server){for(let i=0;i<30;i++){try{if((await fetch(base)).ok)break;}catch{}await sleep(100);}}
  // BROWSER_ARGS supports the provided CPU-only browser in constrained local
  // runners. CI uses Playwright's standard installed Chromium.
  const extra=process.env.BROWSER_ARGS?JSON.parse(process.env.BROWSER_ARGS):[];
  browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-angle=swiftshader',...extra]});
  const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failedResponses.push(r.url());});
  await page.goto(base);await page.waitForSelector('body[data-game-ready="true"]');
  for(const viewport of [{width:320,height:568},{width:393,height:852}]){await page.setViewportSize(viewport);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.ok(await page.locator('#sandboxBtn').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight));}
  await page.setViewportSize({width:393,height:852});await page.locator('#worldSeed').fill('mobile-magical-garden');await page.locator('#newWorldBtn').click();await page.waitForSelector('body[data-game-state="brewing"]');
  const initial=await readSave();assert.equal(initial.coins,80);assert.equal(initial.world.ingredients.filter(i=>i.form==='liquid').length,4);assert.equal(initial.inventory[2],20);
  for(const viewport of [{width:320,height:568},{width:360,height:640},{width:393,height:852},{width:1280,height:900}]){
    await page.setViewportSize(viewport);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'viewport must not overflow horizontally');
    for(const id of ['#heatBtn','#stirBtn','#pourBtn','#bottleBtn','#natureBtn'])assert.ok(await page.locator(id).evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1;}),`${id} must fit on ${viewport.width}×${viewport.height}`);
    assert.ok(await page.locator('#labCanvas').evaluate(e=>e.getBoundingClientRect().height>60));
  }
  await page.setViewportSize({width:393,height:852});await screenshot('mobile-workshop');
  await room('#customerDetailsBtn');assert.match(await page.locator('#sheetContent').textContent(),/Desired enchantment/);assert.doesNotMatch(await page.locator('#sheetContent').textContent(),/Density|Texture|Acidity/);await closePanel();
  await room('#inventoryBtn');assert.match(await page.locator('#sheetContent').textContent(),/Strength/);assert.doesNotMatch(await page.locator('#sheetContent').textContent(),/Density|Viscosity|Chemical/);await screenshot('known-ingredients');await closePanel();
  await brewAndSell(initial,'rabbit');
  const beforeSecond=await readSave();if(beforeSecond.brew.count){await room('#cleanBtn');await page.locator('[data-action="confirm-clean"]').click();}
  // Replenish only water via the garden's visible well.
  await room('#natureBtn');await page.locator('[data-gather="spring"]').click();await page.locator('[data-gather="spring"]').click();await closePanel();
  const second=await readSave();await brewAndSell(second,'beetle');
  await room('#natureBtn');await page.locator('[data-garden-node="grove-2"]').click();
  const stockBefore=(await readSave()).inventory[2];await page.locator('[data-gather="grove-2"]').click();assert.equal(await page.locator('#harvestMarker').count(),1);await screenshot('timed-harvest');
  // Hit the moving marker in the green band without mutating its state.
  await page.waitForFunction(()=>{const marker=document.querySelector('#harvestMarker').getBoundingClientRect(),band=document.querySelector('.harvest-target').getBoundingClientRect();return marker.left>band.left+8&&marker.left<band.right-8;},{},{polling:'raf'});
  await page.locator('[data-action="harvest"]').click();const harvested=await readSave();assert.ok(harvested.inventory[2]>stockBefore&&harvested.inventory[2]<=stockBefore+10);assert.ok(harvested.foraging.stamina<100);
  await screenshot('personal-garden');await closePanel();
  await room('#complaintsBtn');assert.match(await page.locator('#sheetContent').textContent(),/Receipts/);await closePanel();
  await page.reload();await page.locator('#continueBtn').click();await page.waitForSelector('body[data-game-state="brewing"]');const resumed=await readSave();assert.equal(resumed.completed,2);assert.deepEqual(resumed.potionIds,harvested.potionIds);assert.deepEqual(resumed.deliveries,harvested.deliveries);
  await room('#menuBtn');await page.locator('#sandboxBtn').click();await page.waitForSelector('body[data-game-state="brewing"]');assert.equal(await page.locator('#sandboxNotice').isVisible(),true);
  await page.locator('[data-ingredient="13"]').click();await dose(20);await page.locator('#pourBtn').click();await page.waitForTimeout(500);await room('#experimentsBtn');await page.locator('[data-test="rabbit"]').click();await screenshot('magical-liquid-trial');await closePanel();
  const sandbox=await page.evaluate(()=>JSON.parse(localStorage.getItem('alchemists-shop-sandbox-save')));assert.equal(sandbox.completed,0);assert.equal(sandbox.coins,0);assert.equal(sandbox.experiments.records.length,1);assert.equal((await readSave()).completed,2);
  await page.goto(new URL('sandbox.html?mode=2D',base).href);await page.waitForFunction(()=>document.querySelector('#materialSelect')?.options.length>0);assert.equal(await page.locator('#scene2d').isVisible(),true);
  assert.deepEqual(errors,[]);assert.deepEqual(failedResponses,[]);
  console.log(`Browser acceptance OK (${live?'LIVE Pages':'project path'}): two negotiated magical commissions, visual creature trials, manual IDs, bounded garden harvests, mobile 320×568 through desktop, save/reload, magical liquids, separate sandbox, no automatic assays, no page errors.`);
}catch(error){if(page){await screenshot('browser-failure').catch(()=>{});await writeFile('test-results/browser-failure-save.json',JSON.stringify(await readSave())).catch(()=>{});}throw error;}
finally{if(browser)await browser.close();if(server)server.kill('SIGTERM');}
