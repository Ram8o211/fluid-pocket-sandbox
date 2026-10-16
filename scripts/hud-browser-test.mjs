import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const base = process.env.SITE_URL || 'http://127.0.0.1:4183/fluid-pocket-sandbox/';
const server = process.env.SITE_URL ? null : spawn(process.execPath, ['scripts/dev-server.mjs'], {
  env: { ...process.env, PORT: '4183', BASE_PATH: '/fluid-pocket-sandbox' }, stdio: 'ignore'
});
const errors = [], missing = [];
let browser;
try {
  await mkdir('test-results', { recursive: true });
  if (server) for (let n = 0; n < 40; n++) {
    try { if ((await fetch(base)).ok) break; } catch { /* Server is starting. */ }
    await sleep(100);
  }
  const extra = process.env.BROWSER_ARGS ? JSON.parse(process.env.BROWSER_ARGS) : [];
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', ...extra] });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) missing.push(response.url()); });
  await page.goto(base);
  await page.waitForSelector('body[data-game-ready=true]');
  await page.locator('#worldSeed').fill('hud-reference');
  await page.locator('#newWorldBtn').click();
  await page.waitForSelector('body[data-game-state=brewing]');
  // Include first-run help and the welcome notice: neither may push controls off a phone.
  for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 393, height: 852 }, { width: 430, height: 932 }, { width: 1280, height: 950 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal page overflow');
    for (const id of ['heatBtn', 'coolBtn', 'stirBtn', 'crushBtn', 'cleanBtn', 'pourBtn', 'bottleBtn', 'natureBtn']) {
      const box = await page.locator(`#${id}`).boundingBox();
      assert.ok(box.height >= 44 && box.y >= 0 && box.y + box.height <= viewport.height + 1,
        `${id} stays reachable at ${viewport.width}×${viewport.height}: ${JSON.stringify(box)}`);
    }
    assert.ok((await page.locator('#labCanvas').boundingBox()).height >= 65, 'live cauldron keeps its touch area');
  }
  // Check that short phones fold only the ingredient cards and that choosing a
  // card returns focus to the cauldron without disabling the brewing toolbar.
  await page.setViewportSize({ width: 320, height: 568 });
  const rackToggle = page.locator('#ingredientRackToggle');
  assert.ok(await rackToggle.isVisible(), 'short phones expose the ingredient picker');
  assert.equal(await page.locator('#ingredientRack').isVisible(), false, 'cards begin folded for a larger cauldron');
  await rackToggle.click();
  assert.equal(await rackToggle.getAttribute('aria-expanded'), 'true');
  assert.ok(await page.locator('#ingredientRack').isVisible(), 'all ingredients remain selectable');
  await page.locator('[data-ingredient="1"]').click();
  assert.equal(await rackToggle.getAttribute('aria-expanded'), 'false', 'ingredient selection returns focus to the cauldron');
  assert.ok(await page.locator('#pourBtn').isVisible(), 'pouring is still accessible');
  await page.setViewportSize({ width: 393, height: 852 });
  const stage = await page.locator('.laboratory').boundingBox();
  const request = await page.locator('#orderPanel').boundingBox();
  assert.ok(stage.height > request.height * 1.5, 'the brewing area dominates a standard phone');
  await page.locator('#skipTutorial').click();
  await page.waitForTimeout(3400);
  for (const viewport of [{ width: 393, height: 852 }, { width: 320, height: 568 }, { width: 1280, height: 950 }]) {
    await page.setViewportSize(viewport);
    const session = await page.context().newCDPSession(page);
    const { data } = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`test-results/hud-${viewport.width}.png`, Buffer.from(data, 'base64'));
    await session.detach();
  }
  await page.setViewportSize({ width: 393, height: 852 });
  assert.ok(await page.locator('#heatBtn').evaluate(el => getComputedStyle(el).borderImageSource.includes('frame-tool.png')));
  assert.ok(await page.locator('#bottleBtn').isDisabled(), 'empty pot has a disabled bottle action');
  assert.ok(await page.locator('#bottleBtn').evaluate(el => getComputedStyle(el).borderImageSource.includes('frame-disabled.png')));
  for (const amount of [5, 10, 20, 40]) {
    await page.locator(`[data-dose="${amount}"]`).click();
    assert.equal(await page.locator(`[data-dose="${amount}"]`).getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#pourBtn').textContent(), new RegExp(`Pour ${amount} ml`));
  }
  await page.locator('[data-ingredient="2"]').click();
  assert.equal(await page.locator('[data-ingredient="2"]').getAttribute('aria-pressed'), 'true');
  assert.ok(await page.locator('[data-ingredient="2"]').evaluate(el => getComputedStyle(el).borderImageSource.includes('frame-selected.png')));
  assert.ok(await page.locator('#grindBtn').isVisible(), 'raw ingredients still offer grinding');
  await page.locator('[data-ingredient="1"]').click();
  await page.locator('[data-dose="20"]').click();
  // A touch inside the real canvas pours at that coordinate; dragging later
  // must still use the spoon instead of pouring an unwanted second dose.
  const cauldron = page.locator('#labCanvas');
  const touchArea = await cauldron.boundingBox();
  await cauldron.tap({ position: { x: touchArea.width * .55, y: touchArea.height * .54 } });
  await page.waitForTimeout(250);
  assert.ok(await page.locator('#bottleBtn').isEnabled(), 'tapping the cauldron pours liquid');
  assert.match(await page.locator('#volume').textContent(), /20 \/ 60 ml/);
  await page.mouse.move(touchArea.x + touchArea.width * .48, touchArea.y + touchArea.height * .58);
  await page.mouse.down();
  await page.mouse.move(touchArea.x + touchArea.width * .56, touchArea.y + touchArea.height * .58, { steps: 5 });
  await page.mouse.up();
  assert.match(await page.locator('#volume').textContent(), /20 \/ 60 ml/, 'dragging stirs without adding a dose');
  await page.locator('[data-dose="5"]').click();
  await page.locator('#pourBtn').click();
  assert.match(await page.locator('#volume').textContent(), /25 \/ 60 ml/, 'automatic button pouring still works');
  // Use real touch dispatch (not synthetic DOM handlers): holding a stationary
  // finger must repeat, stop on lift, track movement, and pause outside the pot.
  const touchSession = await page.context().newCDPSession(page);
  const touchX = touchArea.x + touchArea.width * .55, touchY = touchArea.y + touchArea.height * .54;
  const finger = async (type, x = touchX, y = touchY) => touchSession.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }]
  });
  const poured = () => page.evaluate(() => JSON.parse(localStorage.getItem('alchemists-shop-save')).brew.portions.reduce((sum, p) => sum + p.ml, 0));
  await finger('touchStart');
  await page.waitForTimeout(1050);
  assert.ok(await poured() >= 40, 'stationary touch repeats at least three 5 ml doses');
  await finger('touchMove', touchArea.x + touchArea.width * .65, touchY);
  await page.waitForTimeout(270);
  await finger('touchMove', touchArea.x + 2, touchArea.y + 2);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const outside = await poured();
  await page.waitForTimeout(520);
  assert.equal(await poured(), outside, 'captured finger outside the vessel pauses pouring');
  await finger('touchMove');
  await page.waitForTimeout(300);
  assert.ok(await poured() > outside, 'moving the held finger back into the vessel resumes pouring');
  await finger('touchEnd');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const released = await poured();
  await page.waitForTimeout(600);
  assert.equal(await poured(), released, 'lifting the finger stops without a bonus release dose');
  await finger('touchStart'); await page.waitForTimeout(500); await finger('touchCancel');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const cancelled = await poured();
  await page.waitForTimeout(500);
  assert.equal(await poured(), cancelled, 'touch cancellation stops repeated pouring');
  await touchSession.detach();
  await page.locator('#crushBtn').click();
  assert.equal(await page.locator('#crushBtn').getAttribute('aria-pressed'), 'true');
  const stir = await page.locator('#stirBtn').boundingBox();
  await page.mouse.move(stir.x + stir.width / 2, stir.y + stir.height / 2);
  await page.mouse.down();
  assert.equal(await page.locator('#stirBtn').getAttribute('aria-pressed'), 'true');
  await page.mouse.up();
  // The starting shop cycles thermal power directly; the upgraded furnace
  // offers a power sheet (covered by the existing sandbox acceptance suite).
  await page.locator('#heatBtn').click();
  assert.match(await page.locator('#heatBtn').textContent(), /35%/);
  assert.ok(await page.locator('#heatBtn').evaluate(el => getComputedStyle(el).borderImageSource.includes('frame-selected.png')));
  await page.locator('#coolBtn').click();
  assert.match(await page.locator('#coolBtn').textContent(), /35%/);
  const close = async () => page.locator('[data-action="close"]').first().click();
  for (const id of ['settingsBtn', 'customerDetailsBtn', 'natureBtn', 'experimentsBtn', 'measureBtn', 'inventoryBtn', 'bookBtn', 'upgradesBtn', 'complaintsBtn']) {
    await page.locator(`#${id}`).click();
    assert.ok(await page.locator('#sheet').evaluate(el => el.open), `${id} opens its real panel`);
    await close();
  }
  await page.locator('#cleanBtn').click();
  await page.locator('[data-action="confirm-clean"]').click();
  assert.ok(await page.locator('#bottleBtn').isDisabled(), 'cleaning resets the bottle state');
  // Cleaning rerenders the HUD. Even cached image elements need a decoding turn;
  // wait for the actual load condition rather than racing the browser in CI.
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#shop .hud-icon'))
    .every(img => img.complete && img.naturalWidth > 0));
  const textures = await page.locator('#shop .hud-icon').evaluateAll(icons => icons.map(img => ({
    src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0, rendering: getComputedStyle(img).imageRendering
  })));
  assert.ok(textures.every(texture => texture.loaded && texture.rendering === 'pixelated'),
    `all supplied icons load with crisp rendering: ${JSON.stringify(textures)}`);
  await page.locator('#experimentsBtn').click();
  await page.evaluate(async () => { await (await import('./src/game/RabbitAssets.mjs')).loadRabbitArtwork(); });
  assert.match(await page.locator('#trialDose').evaluate(el => getComputedStyle(el).borderImageSource), /dose_dropdown\.png/);
  for (const viewport of [{ width: 393, height: 852 }, { width: 320, height: 568 }, { width: 1280, height: 950 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.locator('.rabbit-room .sheet-body').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'trial panels fit without horizontal clipping');
    const dose = await page.locator('[data-test]').boundingBox();
    assert.ok(dose.height >= 44 && dose.y >= 0 && dose.y + dose.height <= viewport.height, 'the dose action stays visible');
    const session = await page.context().newCDPSession(page);
    const { data } = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`test-results/trials-redesign-${viewport.width}.png`, Buffer.from(data, 'base64'));
    await session.detach();
  }
  // A first visit installs the complete import graph and the new art. Reopening
  // the saved shop offline must not depend on a second online cache warm-up.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await page.context().setOffline(true);
  await page.reload(); await page.waitForSelector('body[data-game-ready=true]');
  await page.locator('#continueBtn').click(); await page.waitForSelector('body[data-game-state=brewing]');
  await page.locator('#experimentsBtn').click();
  const offlineArtwork = await page.evaluate(async () => {
    const art = await import('./src/game/RabbitAssets.mjs'); await art.loadRabbitArtwork(); return art.rabbitArtworkVersion();
  });
  assert.equal(offlineArtwork, 35, 'the first offline saved-shop reload loads the room, coats and every reference-matched effect layer');
  assert.deepEqual(errors, []);
  assert.deepEqual(missing, []);
  console.log('HUD OK: five viewport sizes, live controls, all rooms, responsive trial artwork, offline saved-shop reload, no missing textures or browser errors.');
} finally { await browser?.close(); server?.kill('SIGTERM'); }
