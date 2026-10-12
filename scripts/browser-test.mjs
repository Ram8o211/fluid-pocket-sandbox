import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { Phase } from '../src/simulation/Phase.mjs';

// Both local and live verification drive visible controls. A throw fails CI.
// Save reads are assertions and deterministic test guidance, never state writes.
const live = process.env.SITE_URL;
const base = live ? new URL(live).href : 'http://127.0.0.1:4176/fluid-pocket-sandbox/';
const server = live ? null : spawn(process.execPath, ['scripts/dev-server.mjs'], { stdio: 'ignore', env: { ...process.env, PORT: '4176', BASE_PATH: '/fluid-pocket-sandbox' } });
let browser;
const errors = [], failedResponses = [];
const timeout = 15000;
async function readSave(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('alchemists-shop-save'))); }
async function clickDose(page, amount) {
  await page.locator(`[data-dose="${amount}"]`).click();
}
async function pourRecipe(page, recipe) {
  for (const portion of recipe.portions) {
    await page.locator(`[data-ingredient="${portion.ingredientId}"]`).click();
    // The first two orders use 20 ml increments. Subsequent generation and
    // difficult thermal witnesses are covered by physics integration tests.
    assert.equal(portion.ml % 20, 0);
    await clickDose(page, 20);
    for (let ml = 0; ml < portion.ml; ml += 20) await page.locator('#pourBtn').click();
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
  assert.equal(initial.world.ingredients.filter(i => i.form === 'powder').length, 2);
  assert.match(await page.locator('[data-ingredient="10"]').textContent(), /Powder · 240 ml/);
  await pourRecipe(page, initial.order.witness); await page.waitForTimeout(550);
  assert.match(await page.locator('#volume').textContent(), /60 \/ 60/);
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
  assert.match(await page.locator('#sheetContent').textContent(), /60 ml|60\.0 ml/);
  assert.match(await page.locator('#sheetContent').textContent(), /°A/);
  const activeSave = await readSave(page);
  assert.equal(activeSave.brew.count, 240); assert.equal(activeSave.brew.particleMl, .25);
  assert.match(await page.locator('#labStatus').textContent(), /SEALED/);
  assert.ok(activeSave.brew.history.stirred > 0); assert.ok(activeSave.brew.history.heatEnergy > 0); assert.ok(activeSave.brew.history.coldEnergy > 0);
  await page.locator('[data-action="save-inspection"]').click(); await page.locator('#discoveryName').fill('First travelling tonic');
  assert.equal(await page.locator('#discoveryName').inputValue(),'First travelling tonic');
  await page.locator('[data-action="record-discovery"]').click();
  assert.match(await page.locator('#sheetContent').textContent(), /First travelling tonic/);
  await page.locator('[data-action="close"]').click();
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/mobile-workshop.png', fullPage: true });
  await bottleAndSell(page); const firstSale = await readSave(page);
  assert.equal(firstSale.completed, 1); assert.ok(firstSale.coins > initial.coins); assert.ok(firstSale.lastSale.quality >= 90); assert.equal(firstSale.pendingBottle, null);
  assert.equal(firstSale.discoveries.length, 1); assert.ok(firstSale.inventory[1] < initial.inventory[1]);
  await page.screenshot({ path: 'test-results/customer-sale.png', fullPage: true });
  await page.locator('[data-action="next"]').click(); await page.waitForSelector('body[data-game-state="brewing"]', { timeout });
  await page.locator('#upgradesBtn').click(); await page.locator('[data-upgrade="0"]').click(); await page.locator('[data-action="close"]').click();
  const second = await readSave(page); assert.ok(second.equipment.densimeter);
  await pourRecipe(page, second.order.witness); await page.waitForTimeout(550); await bottleAndSell(page);
  const twoSales = await readSave(page); assert.equal(twoSales.completed, 2); assert.ok(twoSales.lastSale.quality >= 95);
  await page.locator('[data-action="next"]').click(); await page.waitForSelector('body[data-game-state="brewing"]', { timeout });
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
  await page.locator('#measureBtn').click(); assert.match(await page.locator('#sheetContent').textContent(), /Density/); await page.locator('[data-action="close"]').click();
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
  await page.locator('#heatBtn').click();
  await page.waitForFunction(() => /ML STEAM/.test(document.querySelector('#labStatus').textContent), null, { timeout });
  assert.equal(await page.locator('#bottleBtn').isDisabled(), true);
  assert.match(await page.locator('#bottleBtn').textContent(), /Wait for condensation/);
  assert.match(await page.locator('#labHint').textContent(), /Steam is trapped/);
  // Continue heating until the actual persisted vapour reaches the lid. This
  // catches a dense cloud that has lost its lift despite still being labelled gas.
  await page.waitForFunction(gasPhase => {
    const particles = JSON.parse(localStorage.getItem('alchemists-shop-save'))?.brew?.particles;
    return particles?.phase.some((phase, i) => phase === gasPhase && particles.y[i] > .8 && particles.localGasDensity[i] > 0);
  }, Phase.GAS, { timeout });
  await page.screenshot({ path: 'test-results/retained-steam.png', fullPage: true });
  await page.locator('#coolBtn').click();
  await page.waitForFunction(() => !/ML STEAM/.test(document.querySelector('#labStatus').textContent), null, { timeout });
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
  await page.locator('#crushBtn').click();
  assert.equal(await page.locator('#crushBtn').getAttribute('aria-pressed'), 'true');
  const frozen = await readSave(page), target = frozen.brew.particles.phase.findIndex(p => p === Phase.SOLID);
  const canvasBox = await page.locator('#labCanvas').boundingBox();
  await page.mouse.click(canvasBox.x + (192 + frozen.brew.particles.x[target] * 40) / 384 * canvasBox.width, canvasBox.y + (158 - frozen.brew.particles.y[target] * 40) / 232 * canvasBox.height);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('alchemists-shop-save'))?.brew?.particles?.solidSubdivision.some(v => v === 1), null, { timeout });
  await page.screenshot({ path: 'test-results/pestle-powder.png', fullPage: true });
  // Both starter powders are usable without grinding a frozen liquid first.
  await page.locator('#cleanBtn').click();await page.locator('[data-action="confirm-clean"]').click();
  await page.locator('[data-ingredient="10"]').click();await clickDose(page,20);
  assert.match(await page.locator('#pourBtn').textContent(),/Add 20 ml/);
  await page.locator('#pourBtn').click();await page.waitForTimeout(2200);
  await page.locator('#menuBtn').click();
  const dryPowder=await readSave(page);
  assert.equal(dryPowder.inventory[10],220);assert.equal(dryPowder.brew.count,80);
  assert.ok(dryPowder.brew.particles.phase.every(p=>p===Phase.SOLID));
  assert.ok(dryPowder.brew.particles.powderContent.every(p=>p===1));
  assert.ok(dryPowder.brew.particles.solidSubdivision.every(p=>p>=.55));
  await page.reload();await page.locator('#continueBtn').click();
  assert.equal((await readSave(page)).inventory[10],220,'Reload cannot grant consumed powder again');
  await page.locator('#settingsBtn').click();await page.locator('#graphicsSetting').selectOption('eco');await page.locator('[data-action="close"]').click();
  await page.screenshot({path:'test-results/default-powder-eco.png',fullPage:true});
  await page.locator('#settingsBtn').click();await page.locator('#graphicsSetting').selectOption('balanced');await page.locator('[data-action="close"]').click();
  await page.screenshot({path:'test-results/default-powder.png',fullPage:true});
  await page.locator('#inventoryBtn').click();assert.match(await page.locator('#sheetContent').textContent(),/powder/);
  await page.locator('[data-restock="10"]').click();await page.locator('[data-action="close"]').click();
  assert.equal((await readSave(page)).inventory[10],280);
  await page.locator('#cleanBtn').click();await page.locator('[data-action="confirm-clean"]').click();
  await page.locator('[data-ingredient="5"]').click();await clickDose(page,40);await page.locator('#pourBtn').click();await page.waitForTimeout(1200);
  await page.locator('[data-ingredient="1"]').click();await page.locator('#pourBtn').click();await page.waitForTimeout(2600);
  await page.screenshot({path:'test-results/density-layer-contact.png',fullPage:true});
  await page.goto(new URL('sandbox.html?mode=2D', base).href);
  await page.waitForFunction(() => document.querySelector('#materialSelect')?.options.length > 0, null, { timeout });
  assert.equal(await page.locator('#scene2d').isVisible(), true); assert.equal(await page.locator('#scene').isVisible(), false);
  assert.equal(await page.getByText('Startup failed', { exact: false }).count(), 0);
  assert.ok((await page.locator('#materialSelect').textContent()).length > 5);
  await page.screenshot({ path: 'test-results/original-sandbox.png', fullPage: true });
  assert.deepEqual(failedResponses, [], 'Missing deployment assets'); assert.deepEqual(errors, [], 'Browser initialization/runtime errors');
  console.log(`Browser acceptance OK (${live ? 'LIVE Pages' : 'project-path build'}): two orders, real pour/stir/heat/frost, liquid settling, retained steam and condensation, pestle, default dry powder, both graphics presets, powder refill and save/restore, touch, mobile/desktop and original sandbox.`);
} finally { if (browser) await browser.close(); if (server) server.kill('SIGTERM'); }
