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
const readSandbox=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('alchemists-shop-sandbox-save')));
async function closePanel(){await page.locator('[data-action="close"]').first().click();}
async function screenshot(name){await page.screenshot({path:`test-results/${name}.png`});}
async function room(id){await page.locator(id).click();}
async function dose(amount){await page.locator(`[data-dose="${amount}"]`).click();}
async function pourRecipe(recipe){
  for(const portion of recipe.portions){await page.locator(`[data-ingredient="${portion.ingredientId}"]`).click();let remaining=portion.ml;while(remaining){const amount=[40,20,10,5].find(v=>v<=remaining);assert.ok(amount);await dose(amount);await page.locator(portion.crushed?'#grindBtn':'#pourBtn').click();remaining-=amount;}}
  if(recipe.stir){const box=await page.locator('#stirBtn').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(recipe.ticks*25+200);await page.mouse.up();}
}
async function compileCurrent(name,sandbox=false){
  const state=await (sandbox?readSandbox():readSave()),report=state.experiments.records[0];
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
  await page.waitForTimeout(1300);
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
  assert.equal(await page.evaluate(()=>typeof b2World),'function','official LiquidFun must be loaded by the browser');
  for(const viewport of [{width:320,height:568},{width:393,height:852}]){await page.setViewportSize(viewport);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.ok(await page.locator('#sandboxBtn').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight));}
  await page.setViewportSize({width:393,height:852});await page.locator('#worldSeed').fill('mobile-magical-garden');await page.locator('#newWorldBtn').click();await page.waitForSelector('body[data-game-state="brewing"]');
  assert.equal(await page.locator('body').getAttribute('data-physics-engine'),'liquidfun',
    'real LiquidFun must drive the potion cauldron, not the legacy fluid solver');
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
  // Sandbox-only ledger stays in the dispenser area, with no modal or pot overlay.
  assert.equal(await page.locator('#sandboxInspector').isVisible(),false);
  const cauldronBefore=await page.locator('#labCanvas').boundingBox();
  await page.locator('#sandboxPropertiesBtn').click();
  assert.equal(await page.locator('#sandboxInspector').isVisible(),true);
  assert.equal(await page.locator('#ingredientRack').isVisible(),false);
  assert.match(await page.locator('#sandboxInspectorBody').textContent(),/Strength.*Love.*Death.*Transformation/s);
  assert.match(await page.locator('#sandboxInspectorBody').textContent(),/Melt.*Boil.*Ignite/s);
  // The expanded ledger is in normal document flow. The contained workshop
  // scrolls to it on phones without covering or shrinking the cauldron to a sliver.
  const cauldronAfter=await page.locator('#labCanvas').boundingBox();
  assert.ok(cauldronBefore.height>60&&cauldronAfter.height>85,'the cauldron remains usable with the expanded inspector');
  const layout=await page.evaluate(()=>{
    const lab=document.querySelector('.laboratory').getBoundingClientRect();
    const inspector=document.querySelector('#sandboxInspector').getBoundingClientRect();
    const body=document.querySelector('#sandboxInspectorBody');
    return {labBottom:lab.bottom,inspectorTop:inspector.top,inspectorHeight:inspector.height,
      bodyHeight:body.clientHeight,workbenchOverflow:getComputedStyle(document.querySelector('#shop')).overflowY};
  });
  assert.ok(layout.inspectorTop>=layout.labBottom-1,'inspector must follow, not overlay, the cauldron');
  assert.ok(layout.inspectorHeight>=290&&layout.bodyHeight>=190,'inspector must have enough reading space on mobile');
  assert.equal(layout.workbenchOverflow,'auto','expanded workshop must scroll rather than clip the inspector');
  assert.match(await page.locator('#sandboxInspectorBody').textContent(),/Arcane supertransformation.*Critical trigger.*Awakened effects.*Magic decays above/s);
  // The entire ledger must remain readable on short and normal mobile screens.
  for(const viewport of [{width:320,height:568},{width:393,height:852}]){
    await page.setViewportSize(viewport);
    await page.locator('#sandboxInspector').scrollIntoViewIfNeeded();
    const readable=await page.evaluate(()=>{
      const pane=document.querySelector('#sandboxInspector'),body=document.querySelector('#sandboxInspectorBody');
      const effectGrid=document.querySelector('.sandbox-effect-grid');
      return {height:pane.getBoundingClientRect().height,bodyHeight:body.clientHeight,
        columns:getComputedStyle(effectGrid).gridTemplateColumns.trim().split(/\s+/).length,
        horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1};
    });
    assert.ok(readable.height>=310&&readable.bodyHeight>=230,`inspector fits reading at ${viewport.width}×${viewport.height}: ${JSON.stringify(readable)}`);
    assert.equal(readable.columns,2,'mobile property values need two readable columns');
    assert.equal(readable.horizontalOverflow,false,'inspector must not overflow mobile width');
  }
  await page.setViewportSize({width:393,height:852});
  await page.locator('#labCanvas').scrollIntoViewIfNeeded();
  assert.ok(await page.locator('#labCanvas').evaluate(e=>{const r=e.getBoundingClientRect();return r.height>85&&r.top>=-1&&r.bottom<=innerHeight+1;}),'cauldron can be scrolled fully into view');
  await page.locator('#sandboxInspectIngredient').selectOption('13');
  assert.ok((await page.locator('#selectedName').textContent()).length>0);
  assert.match(await page.locator('#sandboxInspectorBody').textContent(),/Below -700.0°A/);
  assert.match(await page.locator('#sandboxInspectorBody').textContent(),/Mix opposing runes/i);
  await page.locator('#sandboxMixtureTab').click();
  assert.match(await page.locator('#sandboxInspectorBody').textContent(),/cauldron is empty/i);
  await page.locator('#sandboxPropertiesBtn').click();
  assert.equal(await page.locator('#ingredientRack').isVisible(),true);
  await page.locator('[data-ingredient="13"]').click();await dose(20);await page.locator('#pourBtn').click();await page.waitForTimeout(500);
  await page.locator('#sandboxPropertiesBtn').click();
  await page.locator('#sandboxMixtureTab').click();
  assert.match(await page.locator('#sandboxInspectorBody').textContent(),/Pot mixture 1/);
  assert.match(await page.locator('#sandboxInspectorBody').textContent(),/Melt.*Boil.*Ignite/s);
  await page.locator('#sandboxPropertiesBtn').click();
  await page.locator('#bottleBtn').click();const sealed=await readSandbox();assert.equal(sealed.brew.count,0);assert.ok(sealed.pendingBottle.contents);
  await page.locator('[data-action="experiments"]').first().click();await page.locator('[data-subject="rabbit"]').click();await page.locator('[data-test="rabbit"]').click();await page.waitForTimeout(1400);
  const tested=await readSandbox();assert.ok(Math.abs(tested.pendingBottle.volume-15)<.001);assert.equal(tested.experiments.records.length,1);
  assert.equal(await page.locator('[data-action="return-vial"]').count(),1);
  await page.locator('[data-action="pause-trial"]').click();await page.waitForTimeout(70);
  const frozen=await page.locator('#creatureCanvas').evaluate(e=>e.toDataURL());await page.waitForTimeout(240);
  assert.equal(await page.locator('#creatureCanvas').evaluate(e=>e.toDataURL()),frozen,'pause must freeze the actual animation');
  await screenshot('magical-liquid-trial');
  await page.locator('[data-action="replay-trial"]').click();await page.waitForTimeout(1400);
  assert.equal((await readSandbox()).pendingBottle.volume,tested.pendingBottle.volume);assert.equal((await readSandbox()).experiments.records.length,1,'replay never applies another dose');
  await compileCurrent('Moonlight attempt',true);
  await page.reload();await page.locator('#sandboxBtn').click();await page.waitForSelector('body[data-game-state="inspection"]');await page.waitForSelector('[data-action="return-vial"]');
  assert.ok((await readSandbox()).pendingBottle.contents,'reload keeps transferable contents');
  await page.locator('[data-action="experiments"]').first().click();
  for(const viewport of [{width:320,height:568},{width:393,height:852}]){
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    for(const selector of ['#creatureCanvas','[data-action="pause-trial"]','[data-action="potion-id"]','[data-action="return-vial"]']){
      await page.locator(selector).scrollIntoViewIfNeeded();assert.ok(await page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1;}),`${selector} fits ${viewport.width}×${viewport.height}`);
    }
    await screenshot(`creature-trials-${viewport.width}`);
  }
  await page.locator('[data-action="return-vial"]').click();await page.waitForSelector('body[data-game-state="brewing"]');
  const returned=await readSandbox();assert.equal(returned.pendingBottle,null);assert.equal(returned.negotiation,null);assert.notEqual(returned.brew.batchId,sealed.pendingBottle.batchId);
  const returnedMass=returned.brew.particles.mass.reduce((a,b)=>a+b,0);assert.ok(Math.abs(returnedMass+tested.experiments.records[0].sample.mass-sealed.pendingBottle.mass)<.001);
  await room('#measureBtn');assert.match(await page.locator('#sheetContent').textContent(),/needs a creature trial/);await closePanel();
  await page.locator('[data-ingredient="1"]').click();await dose(5);await page.locator('#pourBtn').click();await page.waitForTimeout(400);
  await room('#experimentsBtn');await page.locator('[data-reset-subject="rabbit"]').click();assert.equal(await page.locator('[data-action="replay-trial"]').isDisabled(),true,'a fresh familiar must not display its old response');
  await page.locator('[data-test="rabbit"]').click();await page.waitForTimeout(1300);await screenshot('adjusted-potion-trial');await compileCurrent('Adjusted moonlight',true);
  const sandbox=await readSandbox();assert.equal(sandbox.completed,0);assert.equal(sandbox.coins,0);assert.equal(sandbox.experiments.records.length,2);assert.equal(sandbox.potionIds.length,2);assert.equal((await readSave()).completed,2);
  // Render isolated, real dose assessments offscreen. Pixel differences verify
  // that every channel has a visible response without modifying game state.
  const visuals=await page.evaluate(async()=>{
    const {TestingRenderer}=await import('./src/game/TestingRenderer.mjs'),{assessEffects,EFFECT_PROPERTIES}=await import('./src/game/effects.mjs'),{createExperimentState}=await import('./src/game/experiments.mjs');
    const canvas=document.createElement('canvas');canvas.width=384;canvas.height=248;const renderer=new TestingRenderer(canvas),results=[];
    const images=['healthy','transformed','poisoned','frozen','dead'].map(state=>renderer.sprite('rabbit',state));
    await Promise.all(images.map(image=>image.complete?Promise.resolve():new Promise(resolve=>image.onload=resolve)));
    for(const key of [...EFFECT_PROPERTIES,'mixed']){
      const subject=createExperimentState().subjects.rabbit,sample={stability:100,color:'#90c6c8',...Object.fromEntries(EFFECT_PROPERTIES.map(k=>[k,key==='mixed'?.025:k===key?.2:0]))};
      const report={...assessEffects(sample,subject,5),id:key,sample};subject.stats=report.after;
      renderer.render(subject,report,1000);renderer.render(subject,report,2500,true);
      const baseline=canvas.getContext('2d').getImageData(0,0,384,248).data;
      renderer.render(subject,report,2500,false);const pixels=canvas.getContext('2d').getImageData(0,0,384,248).data;let changed=0;
      for(let y=0;y<248;y++)for(let x=85;x<384;x++){const i=(y*384+x)*4;if(Math.abs(pixels[i]-baseline[i])+Math.abs(pixels[i+1]-baseline[i+1])+Math.abs(pixels[i+2]-baseline[i+2])>50)changed++;}
      results.push({key,changed,png:canvas.toDataURL()});
    }
    const durations=[];for(let n=0;n<120;n++){const start=performance.now();renderer.render(renderer.subject,renderer.report,3000+n*34);durations.push(performance.now()-start);}
    durations.sort((a,b)=>a-b);return{results,median:durations[60],p95:durations[114]};
  });
  for(const visual of visuals.results){assert.ok(visual.changed>500,`${visual.key} must change a substantial visible area (${visual.changed} pixels)`);await writeFile(`test-results/visual-${visual.key}.png`,Buffer.from(visual.png.split(',')[1],'base64'));}
  console.log(`Creature visuals: ${visuals.results.map(v=>`${v.key} ${v.changed}px`).join(', ')}; render median ${visuals.median.toFixed(2)}ms, p95 ${visuals.p95.toFixed(2)}ms.`);
  await page.goto(new URL('sandbox.html?mode=2D',base).href);await page.waitForFunction(()=>document.querySelector('#materialSelect')?.options.length>0);assert.equal(await page.locator('#scene2d').isVisible(),true);
  assert.deepEqual(errors,[]);assert.deepEqual(failedResponses,[]);
  console.log(`Browser acceptance OK (${live?'LIVE Pages':'project path'}): two negotiated magical commissions, eight visible creature responses, replay/pause, tested vial return/reload/adjustment/retest, manual IDs, bounded garden, mobile 320×568 through desktop, separate sandbox, no automatic assays or page errors.`);
}catch(error){if(page){await screenshot('browser-failure').catch(()=>{});await writeFile('test-results/browser-failure-save.json',JSON.stringify(await readSave())).catch(()=>{});}throw error;}
finally{if(browser)await browser.close();if(server)server.kill('SIGTERM');}
