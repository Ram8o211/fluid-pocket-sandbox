import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

// The game uses system fonts. Generated SVG images can keep Chromium's
// document-wide font readiness pending after the visible text has rendered.
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';

// All colony changes go through the same visible controls as a player.
// localStorage and offscreen canvases provide evidence without test-state injection.
const live = process.env.SITE_URL;
const base = live ? new URL(live).href : 'http://127.0.0.1:4177/fluid-pocket-sandbox/';
const server = live ? null : spawn(process.execPath, ['scripts/dev-server.mjs'], {
  stdio: 'pipe', env: { ...process.env, PORT: '4177', BASE_PATH: '/fluid-pocket-sandbox' }
});
const serverOutput = [], errors = [], failedResponses = [];
server?.stdout.on('data', data => serverOutput.push(String(data)));
server?.stderr.on('data', data => serverOutput.push(String(data)));
let browser, page;
const readState = () => page.evaluate(() => JSON.parse(localStorage.getItem('alchemists-shop-sandbox-save')));
const rabbit = (state, id) => state.experiments.rabbits.find(subject => subject.id === id);
const alive = state => state.experiments.rabbits.filter(subject => subject.stats.alive);
async function screenshot(name) {
  // Export the actual game canvases. Chromium compositor captures can hang
  // after virtual-clock jumps; canvas pixels preserve the trial evidence.
  const scenes = await page.locator('#rabbitPenCanvas, #creatureCanvas').evaluateAll(canvases =>
    canvases.map(canvas => ({ id: canvas.id, png: canvas.toDataURL() })));
  for (const scene of scenes) await writeFile(`test-results/${name}-${scene.id}.png`, Buffer.from(scene.png.split(',')[1], 'base64'));
}
async function closePanel() { await page.locator('[data-action="close"]').first().click(); }
async function selectRabbit(id) { await page.locator(`[data-subject="${id}"]`).click(); }
async function tick(milliseconds) { await page.clock.fastForward(milliseconds); await page.clock.runFor(50); await page.clock.resume(); }
async function administer(id, volume) {
  await selectRabbit(id);
  await page.locator('#trialDose').selectOption(String(volume));
  const button = page.locator(`[data-test="${id}"]`);
  if (await button.isDisabled()) await tick(6500);
  assert.equal(await button.isDisabled(), false, `living ${id} can receive a dose`);
  const before = await readState();
  await button.click(); await tick(1250);
  const after = await readState();
  assert.equal(after.experiments.records.length, before.experiments.records.length + 1, 'one action records one dose');
  assert.equal(rabbit(after, id).stats.doseCount, rabbit(before, id).stats.doseCount + 1, 'the selected rabbit retains its dose history');
  assert.ok(Math.abs(before.pendingBottle.volume - after.pendingBottle.volume - volume) < .001, 'the dose leaves the real sealed vial');
  return after;
}
async function cleanAndBottle(ingredientId, volume = 40) {
  await closePanel();
  await page.locator('#cleanBtn').click();
  const confirm = page.locator('[data-action="confirm-clean"]');
  if (await confirm.count()) await confirm.click();
  await page.locator(`[data-ingredient="${ingredientId}"]`).click();
  await page.locator(`[data-dose="${volume}"]`).click();
  await page.locator('#pourBtn').click(); await tick(600);
  if (ingredientId === 13) {
    // Innate ingredients are deliberately weak. Awaken the real cold rune,
    // then thaw the same potion before testing strong affection and overdose.
    await page.locator('#coolBtn').click();
    await page.locator('#thermalPower').press('End'); await closePanel();
    await page.clock.runFor(6000); await page.clock.resume();
    await page.locator('#heatBtn').click();
    await page.locator('#thermalPower').press('End'); await closePanel();
    await page.clock.runFor(4000); await page.clock.resume();
    await page.locator('#heatBtn').click();
    await page.locator('#thermalPower').press('Home'); await closePanel();
  }
  await page.locator('#bottleBtn').click();
  if (ingredientId === 13) assert.ok((await readState()).pendingBottle.love > .8, 'a real rune transition prepares a strong love potion');
  await page.locator('[data-action="experiments"]').first().click();
  return readState();
}
async function buy() {
  const before = await readState();
  await page.locator('[data-action="buy-rabbit"]').click();
  const after = await readState();
  const added = after.experiments.rabbits.find(subject => !before.experiments.rabbits.some(old => old.id === subject.id));
  assert.ok(added && added.stats.alive && added.age === 'adult', 'buying adds a distinct healthy adult');
  assert.equal(after.experiments.records.length, before.experiments.records.length, 'buying does not erase the notebook');
  return added;
}

try {
  await mkdir('test-results', { recursive: true });
  if (server) {
    let available = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { if ((await fetch(base)).ok) { available = true; break; } } catch { /* Wait for startup. */ }
      await sleep(100);
    }
    assert.ok(available, `dev server starts: ${serverOutput.join('')}`);
  }
  const extra = process.env.BROWSER_ARGS ? JSON.parse(process.env.BROWSER_ARGS) : [];
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', ...extra] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 }, deviceScaleFactor: 1 });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failedResponses.push(response.url()); });
  await page.goto(base); await page.waitForSelector('body[data-game-ready="true"]');
  await page.locator('#worldSeed').fill('persistent-rabbit-trials');
  await page.locator('#sandboxBtn').click(); await page.waitForSelector('body[data-game-state="brewing"]');
  await page.clock.install();
  const initial = await readState();
  assert.equal(initial.experiments.rabbits.length, 4, 'the pen starts with a finite colony');
  assert.ok(initial.experiments.rabbits.every(subject => subject.id.startsWith('rabbit-') && subject.age === 'adult'));
  await page.locator('[data-ingredient="12"]').click(); await page.locator('[data-dose="40"]').click();
  await page.locator('#pourBtn').click(); await tick(600); await page.locator('#bottleBtn').click();
  await page.locator('[data-action="experiments"]').first().click();
  assert.equal(await page.locator('#rabbitPenCanvas').isVisible(), true);
  assert.equal(await page.locator('[data-subject]').count(), 4, 'only individual rabbits are selectable');
  const firstId = initial.experiments.rabbits[0].id, secondId = initial.experiments.rabbits[1].id;
  await selectRabbit(firstId); await page.locator('[data-action="move-rabbit"]').click();
  assert.equal(rabbit(await readState(), firstId).location, 'cage', 'a rabbit can be isolated');
  const once = await administer(firstId, 5), twice = await administer(firstId, 5);
  assert.ok(rabbit(twice, firstId).stats.muscleMass > rabbit(once, firstId).stats.muscleMass, 'muscle growth accumulates');
  assert.ok(rabbit(twice, firstId).stats.scorch > rabbit(once, firstId).stats.scorch, 'burned fur accumulates');
  await screenshot('rabbit-isolated-repeat-dose');
  await selectRabbit(secondId);
  assert.equal(rabbit(await readState(), secondId).stats.doseCount, 0, 'switching selects an untreated rabbit');
  const strong = await administer(secondId, 10);
  for (const key of ['strength', 'fire']) assert.ok(Math.abs(rabbit(strong, firstId).exposure[key] - rabbit(strong, secondId).exposure[key]) < .001,
    `one large ${key} dose matches two smaller doses`);
  for (const key of ['muscleMass', 'scorch']) assert.ok(Math.abs(rabbit(strong, firstId).stats[key] - rabbit(strong, secondId).stats[key]) < .001,
    `equal total potency produces equal ${key}`);
  await selectRabbit(firstId); await page.locator('[data-action="move-rabbit"]').click();
  const returned = await readState();
  assert.equal(rabbit(returned, firstId).location, 'pen');
  assert.equal(rabbit(returned, firstId).stats.muscleMass, rabbit(twice, firstId).stats.muscleMass, 'returning retains changes');
  await screenshot('rabbit-returned-colony');
  await page.locator('[data-action="cull-rabbit"]').click();
  const culled = await readState();
  assert.equal(rabbit(culled, firstId).stats.alive, false, 'culling in the pen is immediate');
  assert.equal(await page.locator(`[data-test="${firstId}"]`).isDisabled(), true, 'dead rabbits cannot be dosed');
  const purchased = await buy();
  assert.equal(rabbit(await readState(), firstId).stats.alive, false, 'a purchase never revives the old rabbit');
  assert.notEqual(purchased.id, firstId);
  await page.locator('[data-action="cull-tool"]').click();
  assert.equal(await page.locator('[data-action="cull-tool"]').getAttribute('aria-pressed'), 'true');
  await selectRabbit(secondId);
  assert.equal(rabbit(await readState(), secondId).stats.alive, false, 'the active cull tool kills a pen rabbit with one tap');
  await page.locator('[data-action="cull-tool"]').click();
  // Discard the unused vial through its normal action, then make an affection potion.
  await closePanel(); await page.locator('#bottleBtn').click(); await page.locator('[data-action="discard-vial"]').click(); await page.locator('[data-action="confirm-discard"]').click();
  await page.locator('#experimentsBtn').click();
  await cleanAndBottle(13);
  const partners = alive(await readState());
  const male = partners.find(subject => subject.sex === 'male'), female = partners.find(subject => subject.sex === 'female');
  assert.ok(male && female, 'the pen retains compatible adults');
  await administer(male.id, 5); await administer(female.id, 5);
  for (let n = 0; n < 9; n++) await tick(5000);
  const nursery = await readState(), babies = nursery.experiments.rabbits.filter(subject => subject.age === 'baby' && subject.stats.alive);
  assert.ok(babies.length >= 2, 'affection and elapsed time produce a nursery');
  await screenshot('rabbit-nursery');
  // Keep one baby safe in the separate cage while testing another.
  await selectRabbit(babies[1].id); await page.locator('[data-action="move-rabbit"]').click();
  await closePanel(); await page.locator('#bottleBtn').click(); await page.locator('[data-action="discard-vial"]').click(); await page.locator('[data-action="confirm-discard"]').click();
  await page.locator('#experimentsBtn').click(); await cleanAndBottle(1);
  let fragile;
  for (let n = 0; n < 3; n++) fragile = await administer(babies[0].id, 5);
  assert.equal(rabbit(fragile, babies[0].id).stats.alive, false, 'a few neutral doses still overwhelm a baby');
  await tick(125000);
  const mature = await readState();
  assert.equal(rabbit(mature, babies[1].id).age, 'adult', 'a protected baby matures with time');
  assert.equal(rabbit(mature, babies[1].id).stats.alive, true);
  assert.equal(rabbit(mature, babies[1].id).location, 'cage');
  await screenshot('rabbit-baby-grown');
  // Check colony, dose history, deaths, and notebook across a real reload.
  await page.reload(); await page.locator('#sandboxBtn').click();
  await page.waitForSelector('body[data-game-state="inspection"]');
  const restored = await readState();
  for (const id of [firstId, secondId, babies[0].id, babies[1].id]) {
    assert.deepEqual(rabbit(restored, id).exposure, rabbit(mature, id).exposure, 'persistent exposure survives reload');
    assert.equal(rabbit(restored, id).stats.alive, rabbit(mature, id).stats.alive, 'death survives reload');
    assert.equal(rabbit(restored, id).location, rabbit(mature, id).location, 'enclosure survives reload');
  }
  assert.equal(restored.experiments.records.length, mature.experiments.records.length);
  await page.locator('[data-action="experiments"]').first().click();
  await closePanel(); await page.locator('#bottleBtn').click(); await page.locator('[data-action="discard-vial"]').click(); await page.locator('[data-action="confirm-discard"]').click();
  await page.locator('#experimentsBtn').click(); await cleanAndBottle(13);
  const overdose = await administer(male.id, 20);
  assert.equal(rabbit(overdose, male.id).dangerous, true, 'excess love turns a surviving adult dangerous');
  assert.match(await page.locator('#colonyAlerts').textContent(), /may attack/);
  await screenshot('rabbit-love-overdose-warning');
  await page.locator('[data-action="move-rabbit"]').click();
  const protectedPen = await readState(); await tick(10000);
  const isolatedDanger = await readState();
  for (const subject of protectedPen.experiments.rabbits.filter(candidate => candidate.stats.alive && candidate.location === 'pen')) {
    assert.equal(rabbit(isolatedDanger, subject.id).stats.health, subject.stats.health, 'isolation protects the pen from an aggressive rabbit');
  }
  await page.locator('[data-action="cull-tool"]').click(); await selectRabbit(male.id);
  assert.equal(rabbit(await readState(), male.id).stats.alive, false, 'the cull tool also removes the isolated danger immediately');
  await page.locator('[data-action="cull-tool"]').click();
  while (alive(await readState()).length < 12) await buy();
  assert.equal(await page.locator('[data-action="buy-rabbit"]').isDisabled(), true, 'the living colony has a hard capacity');
  for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 1280, height: 950 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'the colony fits the viewport');
    for (const selector of ['#rabbitPenCanvas', '#creatureCanvas', '[data-action="move-rabbit"]', '[data-action="cull-rabbit"]', '#trialDose']) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      assert.ok(await page.locator(selector).evaluate(element => { const bounds = element.getBoundingClientRect(); return bounds.top >= 0 && bounds.bottom <= innerHeight + 1; }), `${selector} remains reachable at ${viewport.width}px`);
    }
    await screenshot(`rabbit-colony-${viewport.width}`);
  }
  // Real touch dosing starts from a new potion in each phone orientation. The
  // footer is reachable even while the player is reading lower down the room.
  for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 852, height: 393 }]) {
    const phone = await browser.newContext({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const mobile = await phone.newPage();
    mobile.on('pageerror', error => errors.push(error.message));
    await mobile.goto(base); await mobile.waitForSelector('body[data-game-ready="true"]');
    await mobile.locator('#worldSeed').fill('mobile-rabbit-trials');
    await mobile.locator('#sandboxBtn').tap();
    await mobile.waitForSelector('body[data-game-state="brewing"]');
    await mobile.clock.install();
    await mobile.locator('[data-ingredient="12"]').tap();
    await mobile.locator('[data-dose="10"]').tap();
    await mobile.locator('#pourBtn').tap();
    await mobile.clock.runFor(600); await mobile.clock.resume();
    await mobile.locator('#bottleBtn').tap();
    await mobile.locator('[data-action="experiments"]').first().tap();
    assert.equal(await mobile.locator('#colonyOverview').evaluate(element => element.open), viewport.width >= 760, 'the pen folds away on narrow phones');
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'touch room has no horizontal page overflow');
    const mobileId = await mobile.locator('[data-test]').getAttribute('data-test');
    const doseButton = mobile.locator(`[data-test="${mobileId}"]`);
    for (const selector of ['#trialDose', '[data-test]']) {
      const bounds = await mobile.locator(selector).boundingBox();
      assert.ok(bounds.width >= 44 && bounds.height >= 44 && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height,
        `${selector} is a visible thumb target at ${viewport.width}×${viewport.height}`);
    }
    await mobile.locator('#trialDose').selectOption('2');
    await mobile.locator('#colonyOverview summary').tap();
    await mobile.locator('.rabbit-room .sheet-body').evaluate(element => { element.scrollTop = 150; });
    const before = await mobile.evaluate(() => {
      const body = document.querySelector('.rabbit-room .sheet-body');
      window.trialScrollBody = body; window.trialDoseButton = document.querySelector('[data-test]');
      return { scroll: body.scrollTop, page: scrollY, records: JSON.parse(localStorage.getItem('alchemists-shop-sandbox-save')).experiments.records.length };
    });
    assert.ok(before.scroll > 30, 'test begins below the panel start');
    await doseButton.tap(); await mobile.clock.runFor(320); await mobile.clock.resume();
    const after = await mobile.evaluate(() => ({
      scroll: document.querySelector('.rabbit-room .sheet-body').scrollTop, page: scrollY,
      sameBody: window.trialScrollBody === document.querySelector('.rabbit-room .sheet-body'),
      sameButton: window.trialDoseButton === document.querySelector('[data-test]'),
      state: JSON.parse(localStorage.getItem('alchemists-shop-sandbox-save'))
    }));
    assert.ok(after.sameBody && after.sameButton, 'a dose retains the live panel and dose control');
    assert.ok(Math.abs(after.scroll - before.scroll) <= 1, 'touch dosing preserves panel scroll');
    assert.equal(after.page, before.page, 'touch dosing does not jump the page');
    assert.equal(after.state.experiments.records.length, before.records + 1, 'a tap applies exactly one dose');
    assert.ok(Math.abs(after.state.pendingBottle.volume - 8) < .001, 'a real small vial loses the dose');
    await mobile.locator('[data-action="pause-trial"]').click();
    const response = await mobile.locator('#creatureCanvas').evaluate(canvas => canvas.toDataURL());
    await mobile.locator('[data-action="untreated"]').click();
    await mobile.clock.runFor(50); await mobile.clock.resume();
    assert.notEqual(await mobile.locator('#creatureCanvas').evaluate(canvas => canvas.toDataURL()), response, 'the first weak dose is already visible after 320ms');
    await mobile.locator('[data-action="untreated"]').click();
    await mobile.locator('.rabbit-room .sheet-body').evaluate(element => { element.scrollTop = 0; });
    const session = await phone.newCDPSession(mobile);
    const capture = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`test-results/rabbit-touch-${viewport.width}x${viewport.height}.png`, Buffer.from(capture.data, 'base64'));
    await session.detach(); await phone.close();
  }
  const visuals = await page.evaluate(async () => {
    const { createRabbitColony, assessRabbitEffects } = await import('./src/game/rabbits.mjs');
    const { EFFECT_PROPERTIES } = await import('./src/game/effects.mjs');
    const { TestingRenderer } = await import('./src/game/TestingRenderer.mjs');
    const levels = [0, .2, .8, 1.7, 3], cellWidth = 320, cellHeight = 195;
    const sheet = document.createElement('canvas'); sheet.width = levels.length * cellWidth; sheet.height = EFFECT_PROPERTIES.length * cellHeight;
    const sheetContext = sheet.getContext('2d'); sheetContext.fillStyle = '#101a21'; sheetContext.fillRect(0, 0, sheet.width, sheet.height);
    const signatures = [], progression = [];
    for (let row = 0; row < EFFECT_PROPERTIES.length; row++) {
      const key = EFFECT_PROPERTIES[row], rowSignatures = [];
      for (let col = 0; col < levels.length; col++) {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 350;
        const renderer = new TestingRenderer(canvas), subject = createRabbitColony(1000).rabbits[0];
        const sample = { stability: 100, color: '#90c6c8', ...Object.fromEntries(EFFECT_PROPERTIES.map(effect => [effect, effect === key ? 1 : 0])) };
        const report = { ...assessRabbitEffects(sample, subject, levels[col] * 5, 1000), at: 1000, id: `${key}-${col}`, sample };
        Object.assign(subject, report.afterRabbit); renderer.render(subject, report, 1000); renderer.render(subject, report, 3000);
        const pixels = canvas.getContext('2d').getImageData(0, 0, 640, 350).data;
        let signature = 2166136261;
        for (let i = 0; i < pixels.length; i += 4) signature = Math.imul(signature ^ pixels[i] ^ pixels[i + 1] ^ pixels[i + 2], 16777619) >>> 0;
        rowSignatures.push(signature);
        sheetContext.drawImage(canvas, col * cellWidth, row * cellHeight + 20, cellWidth, 175);
        sheetContext.fillStyle = '#f1e1c2'; sheetContext.font = '13px monospace'; sheetContext.fillText(`${key} · exposure ${levels[col]}`, col * cellWidth + 8, row * cellHeight + 15);
      }
      progression.push({ key, distinct: new Set(rowSignatures).size }); signatures.push(rowSignatures);
    }
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 350;
    const renderer = new TestingRenderer(canvas), subject = createRabbitColony(1000).rabbits[0];
    const sample = { transformation: 1, stability: 100 };
    const report = { ...assessRabbitEffects(sample, subject, 8, 1000), at: 1000, sample };
    Object.assign(subject, report.afterRabbit); renderer.render(subject, report, 1000); renderer.render(subject, report, 3000);
    const stable = canvas.toDataURL(); renderer.render(subject, report, 3000, true); renderer.render(subject, report, 3000, false);
    return { png: sheet.toDataURL(), progression, proceduralStable: stable === canvas.toDataURL() };
  });
  assert.equal(visuals.proceduralStable, true, 'a procedural mutation has a stable appearance when revisited');
  for (const item of visuals.progression) assert.ok(item.distinct >= 4, `${item.key} has visibly distinct dose stages`);
  await writeFile('test-results/rabbit-effects-contact-sheet.png', Buffer.from(visuals.png.split(',')[1], 'base64'));
  assert.deepEqual(errors, []); assert.deepEqual(failedResponses, []);
  console.log(`Rabbit browser acceptance OK: finite colony, persistent repeat doses, equivalent volumes, isolation/return, culling, purchases/capacity, love births, fragile babies/maturation, save reload, mobile controls, ${visuals.progression.map(item => `${item.key}:${item.distinct}`).join(' ')} graphic stages, no page errors.`);
} catch (error) {
  if (page) console.error('Rabbit trial failure context:', await page.locator('#sheetContent').innerText().catch(() => 'Panel unavailable'), 'Page errors:', errors);
  if (page) { await screenshot('rabbit-browser-failure').catch(() => {}); await writeFile('test-results/rabbit-browser-failure-save.json', JSON.stringify(await readState(), null, 2)).catch(() => {}); }
  if (serverOutput.length) console.error(serverOutput.join(''));
  throw error;
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
}
