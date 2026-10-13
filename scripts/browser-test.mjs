import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { Phase } from '../src/simulation/Phase.mjs';
import { SANDBOX_SAVE_KEY } from '../src/game/persistence.mjs';

// Both local and live verification drive visible controls. A throw fails CI.
// Save reads are assertions and deterministic test guidance, never state writes.
const live = process.env.SITE_URL;
const base = live ? new URL(live).href : 'http://127.0.0.1:4176/fluid-pocket-sandbox/';
const server = live ? null : spawn(process.execPath, ['scripts/dev-server.mjs'], { stdio: 'ignore', env: { ...process.env, PORT: '4176', BASE_PATH: '/fluid-pocket-sandbox' } });
let browser, failurePage;
const errors = [], failedResponses = [];
const timeout = 15000;
const phaseTimeout = 30000;
async function readSave(page, key = 'alchemists-shop-save') { return page.evaluate(saveKey => JSON.parse(localStorage.getItem(saveKey)), key); }
async function clickDose(page, amount) {
  await page.locator(`[data-dose="${amount}"]`).click();
}
async function pourRecipe(page, recipe) {
  for (const portion of recipe.portions) {
    await page.locator(`[data-ingredient="${portion.ingredientId}"]`).click();
    let remaining = portion.ml;
    while (remaining) {
      const amount = [40, 20, 10, 5].find(ml => ml <= remaining);
      assert.ok(amount, 'Witness must be achievable with visible metered doses');
      await clickDose(page, amount);
      await page.locator(portion.crushed ? '#grindBtn' : '#pourBtn').click();
      remaining -= amount;
    }
  }
  if (recipe.stir) {
    const rect = await page.locator('#stirBtn').boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(recipe.ticks * 25 + 150);
    await page.mouse.up();
  }
}
async function bottleAndSell(page) {
  await page.locator('#bottleBtn').click();
  await page.locator('[data-action="sell"]').waitFor({ timeout });
  assert.match(await page.locator('.score').textContent(), /\d+/);
  await page.locator('[data-action="sell"]').click();
  await page.locator('[data-action="next"]').waitFor({ timeout });
}
try {
  if (server) {
    for (let i = 0; i < 30; i++) { try { if ((await fetch(base)).ok) break; } catch { /* Server startup. */ } await sleep(100); }
  }
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'allow' });
  const page = await context.newPage();
  failurePage=page;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) failedResponses.push(response.url()); });
  await page.goto(base); await page.waitForSelector('body[data-game-ready="true"]', { timeout });
  assert.equal(await page.title(), "The Alchemist's Shop");
  const styled = await page.locator('#newWorldBtn').evaluate(element => getComputedStyle(element).backgroundColor);
  assert.notEqual(styled, 'rgba(0, 0, 0, 0)');
  await page.locator('#worldSeed').fill('mobile-acceptance');
  assert.equal(await page.locator('#worldSeed').inputValue(),'mobile-acceptance');
  await page.locator('#newWorldBtn').click();
  await page.waitForSelector('body[data-game-state="brewing"]', { timeout });
  const initial = await readSave(page); assert.equal(initial.coins, 80); assert.equal(initial.world.ingredients.filter(i => i.starter).length, 8);
  assert.equal(initial.world.ingredients.filter(i => i.form === 'liquid').length, 1);
  assert.ok(initial.world.ingredients.some(i => i.form === 'plant'));
  assert.ok(initial.world.ingredients.some(i => i.form === 'stone'));
  assert.match(await page.locator('[data-ingredient="10"]').textContent(), /Chalk|Stone/i);
  await pourRecipe(page, initial.order.witness); await page.waitForTimeout(550);
  assert.ok(Number((await page.locator('#volume').textContent()).split('/')[0]) >= initial.order.volume);
  // Hold-assisted stirring and a real circular spoon gesture.
  const stir = await page.locator('#stirBtn').boundingBox();
  await page.mouse.move(stir.x + stir.width / 2, stir.y + stir.height / 2); await page.mouse.down(); await page.waitForTimeout(450); await page.mouse.up();
  const bowl = await page.locator('#labCanvas').boundingBox();
  const cx = bowl.x + bowl.width / 2, cy = bowl.y + bowl.height * .72;
  await page.mouse.move(cx + 25, cy); await page.mouse.down();
  for (let i = 1; i <= 18; i++) await page.mouse.move(cx + Math.cos(i / 18 * Math.PI * 2) * 25, cy + Math.sin(i / 18 * Math.PI * 2) * 17, { steps: 2 });
  await page.mouse.up();
  await page.locator('#heatBtn').click(); await page.waitForTimeout(400);
  for (let i = 0; i < 3; i++) await page.locator('#heatBtn').click();
  await page.locator('#coolBtn').click(); await page.waitForTimeout(250);
  for (let i = 0; i < 3; i++) await page.locator('#coolBtn').click();
  await page.locator('#measureBtn').click();
  assert.match(await page.locator('#sheetContent').textContent(), /ml in the cauldron/);
  assert.match(await page.locator('#sheetContent').textContent(), /Mixture effects unknown/);
  assert.equal(await page.locator('.effect-reading strong').first().textContent(), '?');
  assert.match(await page.locator('#sheetContent').textContent(), /°A/);
  const activeSave = await readSave(page);
  assert.equal(activeSave.brew.count, initial.order.witness.portions.reduce((sum,p) => sum+p.ml,0)*4); assert.equal(activeSave.brew.particleMl, .25);
  assert.match(await page.locator('#labStatus').textContent(), /SEALED/);
  assert.ok(activeSave.brew.history.stirred > 0); assert.ok(activeSave.brew.history.heatEnergy > 0); assert.ok(activeSave.brew.history.coldEnergy > 0);
  assert.ok(initial.order.requirements.some(r => r.property === 'strength' && r.target > 0));
  await page.locator('[data-action="experiments"]').click();
  await page.locator('[data-test="rabbit"]').click();
  assert.match(await page.locator('#experimentReport').textContent(), /Discovered effects/);
  assert.notEqual(await page.locator('#experimentReport .effect-reading strong').first().textContent(), '?');
  const firstTest = await readSave(page);
  assert.equal(firstTest.experiments.records.length, 1);
  assert.ok(firstTest.experiments.records[0].sample.strength > .01);
  await page.locator('#experimentReport [data-observation]').click(); await page.locator('#discoveryName').fill('First travelling tonic');
  assert.equal(await page.locator('#discoveryName').inputValue(),'First travelling tonic');
  await page.locator('[data-action="record-discovery"]').click();
  assert.match(await page.locator('#sheetContent').textContent(), /First travelling tonic/);
  await page.locator('[data-action="close"]').first().click();
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/mobile-workshop.png', fullPage: true });
  await bottleAndSell(page); const firstSale = await readSave(page);
  assert.equal(firstSale.completed, 1); assert.ok(firstSale.coins > initial.coins); assert.ok(firstSale.lastSale.quality >= 90); assert.equal(firstSale.pendingBottle, null);
  assert.equal(firstSale.discoveries.length, 1); assert.equal(firstSale.discoveries[0].tested, true); assert.ok(firstSale.inventory[1] < initial.inventory[1]);
  await page.screenshot({ path: 'test-results/customer-sale.png', fullPage: true });
  await page.locator('[data-action="next"]').click(); await page.waitForSelector('body[data-game-state="brewing"]', { timeout });
  await page.locator('#upgradesBtn').click(); await page.locator('[data-upgrade="0"]').click(); await page.locator('[data-action="close"]').first().click();
  const second = await readSave(page); assert.ok(second.equipment.densimeter);
  if ((await readSave(page)).brew.count) { await page.locator('#cleanBtn').click(); await page.locator('[data-action="confirm-clean"]').click(); }
  await pourRecipe(page, second.order.witness); await page.waitForTimeout(550);
  await page.locator('#experimentsBtn').click(); await page.locator('[data-test="beetle"]').click();
  await page.locator('[data-action="close"]').first().click(); await bottleAndSell(page);
  const twoSales = await readSave(page); assert.equal(twoSales.completed, 2); assert.ok(twoSales.lastSale.quality >= 95);
  await page.locator('[data-action="next"]').click(); await page.waitForSelector('body[data-game-state="brewing"]', { timeout });
  // Extraction recipes can leave a small excess after the customer's vial.
  if ((await readSave(page)).brew.count) { await page.locator('#cleanBtn').click(); await page.locator('[data-action="confirm-clean"]').click(); }
  await page.locator('[data-ingredient="1"]').click(); await clickDose(page, 20);
  await page.locator('#pourBtn').click(); const beforeReload = await readSave(page); assert.equal(beforeReload.brew.count, 80);
  await page.reload(); await page.locator('#continueBtn').click(); await page.waitForSelector('body[data-game-state="brewing"]', { timeout });
  const afterReload = await readSave(page); assert.equal(afterReload.completed, 2); assert.equal(afterReload.brew.count, 80); assert.deepEqual(afterReload.inventory, beforeReload.inventory); assert.ok(afterReload.equipment.densimeter);
  // Mobile overflow and main controls at narrow widths; desktop shares the game.
  for (const viewport of [{ width: 320, height: 740 }, { width: 393, height: 852 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal viewport overflow');
    assert.ok(await page.locator('#bottleBtn').isVisible());
  }
  await page.setViewportSize({ width: 393, height: 852 });
  // Genuine TouchEvents delivered through Chromium's mobile input path.
  const touch = await context.newCDPSession(page), rect = await page.locator('#labCanvas').boundingBox();
  const tx = rect.x + rect.width / 2, ty = rect.y + rect.height * .72;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tx + 28, y: ty - 18 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.locator('#measureBtn').click(); assert.match(await page.locator('#sheetContent').textContent(), /Density/); await page.locator('[data-action="close"]').first().click();
  // Stop applying impulses and let gravity collect the small batch. Persist via
  // the visible menu so this assertion reads the actual simulated resting state.
  await page.waitForTimeout(2200); await page.locator('#menuBtn').click();
  const settledSave = await readSave(page);
  const settledY = settledSave.brew.particles.y.slice().sort((a, b) => a - b);
  assert.ok(settledY.reduce((sum, y) => sum + y, 0) / settledY.length < -.75, 'Liquid should pool at the bottom');
  assert.ok(settledY[Math.floor(settledY.length * .95)] < -.55, 'Idle liquid must not hang in mid-air');
  await page.locator('#continueBtn').click(); await page.waitForSelector('body[data-game-state="brewing"]', { timeout });
  const resumed = await readSave(page);
  const resumedY = resumed.brew.particles.y.slice().sort((a, b) => a - b);
  assert.ok(resumedY[Math.floor(resumedY.length * .95)] < -.55, 'Continue should preserve the settled physical state');
  await page.screenshot({ path: 'test-results/settled-liquid.png', fullPage: true });
  // A real small batch boils through visible controls. The lid keeps its mass,
  // warns the player, and blocks bottling until cooling completes the phase loop.
  const massBeforeBoiling = beforeReload.brew.particles.mass.reduce((sum, mass) => sum + mass, 0);
  // Plain water has a higher boiling point and lower volatility than the old
  // extracts. Use the visible full flame for this bounded boiling check.
  for (let i = 0; i < 3; i++) await page.locator('#heatBtn').click();
  await page.waitForFunction(() => /ML STEAM/.test(document.querySelector('#labStatus').textContent), null, { timeout: phaseTimeout });
  assert.equal(await page.locator('#bottleBtn').isDisabled(), true);
  assert.match(await page.locator('#bottleBtn').textContent(), /Wait for condensation/);
  assert.match(await page.locator('#labHint').textContent(), /Steam is trapped/);
  // Continue heating until the actual persisted vapour reaches the lid. This
  // catches a dense cloud that has lost its lift despite still being labelled gas.
  // Observe the current state through Inspect. The eight-second autosave can
  // miss a brief boiling window in a fine batch before prolonged heat burns it.
  let lifted=false;const liftDeadline=Date.now()+phaseTimeout;
  while(!lifted&&Date.now()<liftDeadline){
    await page.waitForTimeout(200);await page.locator('#measureBtn').click();
    const particles=(await readSave(page)).brew.particles;
    lifted=particles.phase.some((phase,i)=>phase===Phase.GAS&&particles.y[i]>.8&&particles.localGasDensity[i]>0);
    await page.locator('[data-action="close"]').first().click();
  }
  assert.ok(lifted,'hot vapour must rise to the lid');
  await page.screenshot({ path: 'test-results/retained-steam.png', fullPage: true });
  await page.locator('#coolBtn').click();
  await page.waitForFunction(() => !/ML STEAM/.test(document.querySelector('#labStatus').textContent), null, { timeout:phaseTimeout });
  for (let i = 0; i < 3; i++) await page.locator('#coolBtn').click();
  const condensed = await readSave(page);
  assert.equal(condensed.brew.history.evaporated, 0); assert.ok(condensed.brew.history.condensed > 0);
  assert.ok(Math.abs(condensed.brew.particles.mass.reduce((sum, mass) => sum + mass, 0) - massBeforeBoiling) < .001);
  assert.deepEqual(condensed.inventory, beforeReload.inventory);
  assert.doesNotMatch(await page.locator('#bottleBtn').textContent(), /Wait for condensation/);
  await page.screenshot({ path: 'test-results/condensed-brew.png', fullPage: true });
  // Freeze a real batch, then crush a touched portion using the visible pestle.
  for (let i = 0; i < 3; i++) await page.locator('#coolBtn').click();
  await page.waitForFunction(solid => JSON.parse(localStorage.getItem('alchemists-shop-save'))?.brew?.particles?.phase.some(p => p === solid), Phase.SOLID, { timeout: 20000 });
  // A real spoon stroke must move a touched frozen parcel as well as fluids.
  // Capture its rounded bowl while held; read only saves made by visible UI.
  await page.locator('#measureBtn').click(); const beforeSolidStroke = await readSave(page);
  await page.locator('[data-action="close"]').first().click();
  const solidTarget = beforeSolidStroke.brew.particles.phase.findIndex(p => p === Phase.SOLID);
  const spoonBox = await page.locator('#labCanvas').boundingBox();
  const spoonX = spoonBox.x + (192 + beforeSolidStroke.brew.particles.x[solidTarget] * 40) / 384 * spoonBox.width;
  const spoonY = spoonBox.y + (158 - beforeSolidStroke.brew.particles.y[solidTarget] * 40) / 232 * spoonBox.height;
  await page.mouse.move(spoonX, spoonY); await page.mouse.down();
  await page.mouse.move(spoonX + 14, spoonY - 14, { steps: 5 }); await page.waitForTimeout(80);
  await page.screenshot({ path: 'test-results/direct-spoon.png', fullPage: true }); await page.mouse.up();
  await page.locator('#measureBtn').click(); const afterSolidStroke = await readSave(page);
  assert.ok(afterSolidStroke.brew.history.stirred > beforeSolidStroke.brew.history.stirred, 'pointer contact must stir intact frozen material');
  assert.ok(Math.hypot(afterSolidStroke.brew.particles.x[solidTarget] - beforeSolidStroke.brew.particles.x[solidTarget],
    afterSolidStroke.brew.particles.y[solidTarget] - beforeSolidStroke.brew.particles.y[solidTarget]) > .01, 'a touched solid must follow the spoon');
  await page.locator('[data-action="close"]').first().click();
  await page.locator('#crushBtn').click();
  assert.equal(await page.locator('#crushBtn').getAttribute('aria-pressed'), 'true');
  // The block is still moving after the spoon stroke. Reacquire an actual
  // central solid through Inspect for each jab rather than clicking a stale
  // saved edge parcel and waiting eight seconds for an unrelated autosave.
  let crushedFrozen = false;
  for (let jab = 0; jab < 3 && !crushedFrozen; jab++) {
    await page.locator('#measureBtn').click(); const frozen = await readSave(page);
    const solids = frozen.brew.particles.phase.map((phase, i) => phase === Phase.SOLID ? i : -1).filter(i => i >= 0);
    assert.ok(solids.length > 0, 'the frozen batch must contain solid material');
    solids.sort((a, b) => frozen.brew.particles.x[a] - frozen.brew.particles.x[b]);
    const target = solids[Math.floor(solids.length / 2)];
    await page.locator('[data-action="close"]').first().click();
    const canvasBox = await page.locator('#labCanvas').boundingBox();
    const x = canvasBox.x + (192 + frozen.brew.particles.x[target] * 40) / 384 * canvasBox.width;
    const y = canvasBox.y + (158 - frozen.brew.particles.y[target] * 40) / 232 * canvasBox.height;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 8, y, { steps: 4 }); await page.mouse.up();
    await page.locator('#measureBtn').click();
    crushedFrozen = (await readSave(page)).brew.particles.solidSubdivision.some(v => v === 1);
    await page.locator('[data-action="close"]').first().click();
  }
  assert.ok(crushedFrozen, 'the visible pestle must crush touched frozen material');
  await page.screenshot({ path: 'test-results/pestle-powder.png', fullPage: true });
  // Raw stone stays coherent until the player grinds it. Ground stock is a
  // conserved dry powder, and neither reload nor a graphics preset refunds it.
  await page.locator('#cleanBtn').click();await page.locator('[data-action="confirm-clean"]').click();
  await page.locator('[data-ingredient="10"]').click();await clickDose(page,20);
  assert.match(await page.locator('#pourBtn').textContent(),/Add 20/);
  const stoneStock = (await readSave(page)).inventory[10];
  await page.locator('#grindBtn').click();await page.waitForTimeout(2200);
  await page.locator('#menuBtn').click();
  const dryPowder=await readSave(page);
  assert.equal(dryPowder.inventory[10],stoneStock-20);assert.equal(dryPowder.brew.count,80);
  assert.ok(dryPowder.brew.particles.phase.every(p=>p===Phase.SOLID));
  assert.ok(dryPowder.brew.particles.powderContent.every(p=>p===1));
  assert.ok(dryPowder.brew.particles.solidSubdivision.every(p=>p>=.55));
  await page.reload();await page.locator('#continueBtn').click();
  assert.equal((await readSave(page)).inventory[10],stoneStock-20,'Reload cannot grant consumed ingredients again');
  await page.locator('#settingsBtn').click();await page.locator('#graphicsSetting').selectOption('eco');await page.locator('[data-action="close"]').first().click();
  await page.screenshot({path:'test-results/ground-stone-eco.png',fullPage:true});
  await page.locator('#settingsBtn').click();await page.locator('#graphicsSetting').selectOption('balanced');await page.locator('[data-action="close"]').first().click();
  await page.screenshot({path:'test-results/ground-stone.png',fullPage:true});
  // Solvent resting against sand does not make dough. Only spoon work can
  // hydrate grains into a thick liquid suspension; that phase survives reload.
  await page.locator('[data-ingredient="1"]').click();await page.locator('#pourBtn').click();await page.waitForTimeout(2500);
  await page.locator('#measureBtn').click();const untouched=await readSave(page);
  assert.equal(untouched.brew.particles.phase.filter(p=>p===Phase.SOLID).length,80);
  assert.ok(untouched.brew.particles.powderContent.filter(p=>p>0).every(p=>p===1),'flow alone cannot knead powder');
  await page.locator('[data-action="close"]').first().click();
  if(await page.locator('#crushBtn').getAttribute('aria-pressed')==='true')await page.locator('#crushBtn').click();
  let kneaded;const kneadDeadline=Date.now()+phaseTimeout;
  do {
    const spoon=await page.locator('#stirBtn').boundingBox();
    await page.mouse.move(spoon.x+spoon.width/2,spoon.y+spoon.height/2);await page.mouse.down();await page.waitForTimeout(1800);await page.mouse.up();
    await page.locator('#measureBtn').click();kneaded=await readSave(page);
    await page.locator('[data-action="close"]').first().click();
  } while(kneaded.brew.particles.phase.filter(p=>p===Phase.LIQUID).length<=80&&Date.now()<kneadDeadline);
  assert.ok(kneaded.brew.particles.phase.filter(p=>p===Phase.LIQUID).length>80,'stirring must form true liquid dough');
  assert.ok(kneaded.brew.particles.powderContent.some((p,i)=>p>.27&&p<.935&&kneaded.brew.particles.phase[i]===Phase.LIQUID));
  await page.screenshot({path:'test-results/kneaded-dough.png',fullPage:true});
  await page.reload();await page.locator('#continueBtn').click();
  const doughReload=await readSave(page);assert.ok(doughReload.brew.particles.phase.filter(p=>p===Phase.LIQUID).length>80);
  assert.equal(doughReload.brew.particles.solventMeltingTemperature.length,doughReload.brew.count);
  await page.locator('#inventoryBtn').click();assert.match(await page.locator('#sheetContent').textContent(),/stone/i);
  await page.locator('[data-restock="10"]').click();await page.locator('[data-action="close"]').first().click();
  assert.equal((await readSave(page)).inventory[10],stoneStock+40);
  await page.locator('#cleanBtn').click();await page.locator('[data-action="confirm-clean"]').click();
  await page.locator('[data-ingredient="5"]').click();await clickDose(page,20);await page.locator('#pourBtn').click();await page.waitForTimeout(1200);
  const whole = await readSave(page); assert.ok(whole.brew.particles.phase.every(p => p === Phase.SOLID));
  assert.ok(whole.brew.particles.powderContent.every(p => p === 0));
  await page.screenshot({path:'test-results/whole-raw-ingredient.png',fullPage:true});
  await page.locator('[data-ingredient="1"]').click();await clickDose(page,40);await page.locator('#pourBtn').click();
  const beforeRoomTest = await readSave(page);
  await page.locator('#experimentsBtn').click();
  await page.locator('[data-test="rabbit"]').click();
  assert.ok((await page.locator('#experimentReport').textContent()).length > 20);
  const tested = await readSave(page); assert.equal(tested.experiments.records.length, beforeRoomTest.experiments.records.length + 1); assert.equal(tested.experiments.records[0].volume,5);
  assert.equal(tested.experiments.subjects.rabbit.trials,beforeRoomTest.experiments.subjects.rabbit.trials + 1);
  await page.locator('[data-reset-subject="rabbit"]').click();
  assert.equal((await readSave(page)).experiments.subjects.rabbit.trials,0);
  await page.screenshot({path:'test-results/experiments-room.png',fullPage:true});
  await page.locator('[data-action="close"]').first().click();
  await page.locator('#natureBtn').click();
  assert.ok(await page.locator('[data-gather]').count()>0);
  const gatherButton=page.locator('[data-gather="grove-2"]').last(),nodeId=await gatherButton.getAttribute('data-gather');
  const stockBeforeGather=Object.values((await readSave(page)).inventory).reduce((sum,value)=>sum+value,0);
  await gatherButton.click();
  const gathered=await readSave(page); assert.ok(Object.values(gathered.inventory).reduce((sum,value)=>sum+value,0)>stockBeforeGather);
  const gatherAll=page.locator(`[data-gather-all="${nodeId}"]`);
  if (await gatherAll.count()) { await gatherAll.click(); assert.equal(await page.locator(`[data-gather="${nodeId}"]`).last().isDisabled(),true); }
  await page.screenshot({path:'test-results/nature-gathering.png',fullPage:true});
  await page.locator('[data-action="close"]').first().click();
  await page.locator('#menuBtn').click();
  const shopBeforeSandbox=await readSave(page);
  await page.locator('#sandboxBtn').click(); await page.waitForSelector('body[data-game-state="brewing"]',{timeout});
  const sandboxStart=await readSave(page,SANDBOX_SAVE_KEY);assert.ok(sandboxStart);
  await page.locator('[data-ingredient="2"]').click();await clickDose(page,10);await page.locator('#grindBtn').click();
  await page.locator('[data-ingredient="1"]').click();await clickDose(page,40);await page.locator('#pourBtn').click();await page.locator('#pourBtn').click();
  await clickDose(page,10);await page.locator('#pourBtn').click();
  const sandboxStir=await page.locator('#stirBtn').boundingBox();await page.mouse.move(sandboxStir.x+sandboxStir.width/2,sandboxStir.y+sandboxStir.height/2);await page.mouse.down();await page.waitForTimeout(6500);await page.mouse.up();
  await page.locator('#experimentsBtn').click();await page.locator('[data-test="seedling"]').click();
  const sandboxTested=await readSave(page,SANDBOX_SAVE_KEY);assert.equal(sandboxTested.experiments.records.length,1);
  assert.ok(sandboxTested.experiments.records[0].effects.strength>0,'Extracted plant fields must reach the tested liquid');
  assert.ok(sandboxTested.experiments.subjects.seedling.stats.strength> sandboxStart.experiments.subjects.seedling.stats.strength);
  assert.deepEqual(sandboxTested.inventory,sandboxStart.inventory,'Sandbox ingredients never consume stock');
  assert.deepEqual(await readSave(page),shopBeforeSandbox,'Sandbox must preserve campaign progress');
  await page.screenshot({path:'test-results/infinite-sandbox.png',fullPage:true});
  await page.locator('[data-action="close"]').first().click();
  await page.goto(new URL('sandbox.html?mode=2D', base).href);
  await page.waitForFunction(() => document.querySelector('#materialSelect')?.options.length > 0, null, { timeout });
  assert.equal(await page.locator('#scene2d').isVisible(), true); assert.equal(await page.locator('#scene').isVisible(), false);
  assert.equal(await page.getByText('Startup failed', { exact: false }).count(), 0);
  assert.ok((await page.locator('#materialSelect').textContent()).length > 5);
  await page.screenshot({ path: 'test-results/original-sandbox.png', fullPage: true });
  // The discovery loop also applies to sealed vials, saved hypotheses, reloads,
  // and newly prepared batches. Exercise it through visible controls alone.
  const discoveryContext = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  const discoveryPage = await discoveryContext.newPage(); failurePage = discoveryPage;
  discoveryPage.on('pageerror', error => errors.push(error.message));
  discoveryPage.on('response', response => { if (response.status() >= 400) failedResponses.push(response.url()); });
  await discoveryPage.goto(base); await discoveryPage.waitForSelector('body[data-game-ready="true"]', { timeout });
  await discoveryPage.locator('#worldSeed').fill('discovery-acceptance');
  await discoveryPage.locator('#newWorldBtn').click(); await discoveryPage.waitForSelector('body[data-game-state="brewing"]', { timeout });
  const discoveryStart = await readSave(discoveryPage);
  await discoveryPage.locator('#inventoryBtn').click();
  await discoveryPage.locator('.plain-ingredient-effects summary').nth(1).click();
  assert.match(await discoveryPage.locator('.plain-ingredient-effects').nth(1).textContent(), /86%/);
  await discoveryPage.locator('[data-action="close"]').first().click();
  await pourRecipe(discoveryPage, discoveryStart.order.witness);
  await discoveryPage.locator('#bottleBtn').click();
  assert.match(await discoveryPage.locator('.score').textContent(), /unknown match/);
  assert.doesNotMatch(await discoveryPage.locator('#sheetContent').textContent(), /Expected offer:/);
  assert.match(await discoveryPage.locator('[data-action="sell"]').textContent(), /Test before serving/);
  assert.equal(await discoveryPage.locator('[data-action="sell"]').isDisabled(), true);
  await discoveryPage.locator('[data-action="save-inspection"]').click();
  await discoveryPage.locator('#discoveryName').fill('Untested hypothesis'); await discoveryPage.locator('[data-action="record-discovery"]').click();
  assert.equal((await readSave(discoveryPage)).discoveries[0].tested, false);
  await discoveryPage.locator('[data-action="close"]').first().click(); await discoveryPage.locator('#bottleBtn').click();
  await discoveryPage.locator('[data-action="experiments"]').click(); await discoveryPage.locator('[data-test="rabbit"]').click();
  assert.match(await discoveryPage.locator('#experimentReport').textContent(), /Discovered effects/);
  await discoveryPage.screenshot({ path: 'test-results/discovered-potion-effects.png', fullPage: true });
  await discoveryPage.locator('[data-action="review-vial"]').click();
  assert.match(await discoveryPage.locator('.score').textContent(), /\d+.*observed match/);
  assert.match(await discoveryPage.locator('#sheetContent').textContent(), /Expected offer:/);
  const knownVial = await readSave(discoveryPage); assert.ok(Math.abs(knownVial.pendingBottle.volume - 55) < .001);
  await discoveryPage.locator('[data-action="save-inspection"]').click(); await discoveryPage.locator('#discoveryName').fill('Learned strength');
  await discoveryPage.locator('[data-action="record-discovery"]').click();
  assert.equal((await readSave(discoveryPage)).discoveries[0].tested, true);
  await discoveryPage.locator('[data-recipe="1"]').click();
  assert.match(await discoveryPage.locator('#sheetContent').textContent(), /Mixture effects unknown/);
  await discoveryPage.reload(); await discoveryPage.locator('#continueBtn').click();
  await discoveryPage.waitForSelector('[data-action="sell"]', { timeout });
  assert.match(await discoveryPage.locator('#sheetContent').textContent(), /Expected offer:/);
  assert.equal((await readSave(discoveryPage)).experiments.records.length, 1);
  await discoveryPage.locator('[data-action="discard-vial"]').click(); await discoveryPage.locator('[data-action="confirm-discard"]').click();
  await discoveryPage.locator('#cleanBtn').click(); await discoveryPage.locator('[data-action="confirm-clean"]').click();
  await pourRecipe(discoveryPage, discoveryStart.order.witness); await discoveryPage.locator('#bottleBtn').click();
  assert.match(await discoveryPage.locator('.score').textContent(), /unknown match/, 'a learned recipe does not automatically test a new batch');
  await discoveryContext.close();
  assert.deepEqual(failedResponses, [], 'Missing deployment assets'); assert.deepEqual(errors, [], 'Browser initialization/runtime errors');
  console.log(`Browser acceptance OK (${live ? 'LIVE Pages' : 'project-path build'}): two effect orders, unknown mixture and offer gates, sealed-vial discoveries, saved hypotheses, new-batch retesting, raw ingredient grinding, real stir/heat/frost, settling, retained steam, pestle, stirring-only liquid dough, fine pixels, stock/save conservation, experiment dosing and reset, nature depletion, separate infinite sandbox, touch, responsive layouts and original sandbox.`);
} catch(error) {
  try {await mkdir('test-results',{recursive:true});await failurePage.screenshot({path:'test-results/browser-failure.png',fullPage:true});await writeFile('test-results/browser-failure-save.json',JSON.stringify(await readSave(failurePage)));if(await failurePage.locator('#sheet').evaluate(e=>e.open))await failurePage.locator('[data-action="close"]').first().click();if(await failurePage.locator('#menuBtn').isVisible())await failurePage.locator('#menuBtn').click();await writeFile('test-results/browser-failure-save.json',JSON.stringify(await readSave(failurePage)));} catch { /* Preserve the original assertion. */ }
  throw error;
} finally { if (browser) await browser.close(); if (server) server.kill('SIGTERM'); }
