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
  await page.setViewportSize({ width: 393, height: 852 });
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
  await page.locator('#pourBtn').click();
  await page.waitForTimeout(250);
  assert.ok(await page.locator('#bottleBtn').isEnabled(), 'real liquid enables bottling');
  assert.match(await page.locator('#volume').textContent(), /20 \/ 60 ml/);
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
  const textures = await page.locator('#shop .hud-icon').evaluateAll(icons => icons.map(img => ({
    loaded: img.complete && img.naturalWidth > 0, rendering: getComputedStyle(img).imageRendering
  })));
  assert.ok(textures.every(texture => texture.loaded && texture.rendering === 'pixelated'), 'all supplied icons load with crisp rendering');
  assert.deepEqual(errors, []);
  assert.deepEqual(missing, []);
  console.log('HUD OK: five viewport sizes, live quantities/selection/disabled states, brewing tools, all seven rooms, no missing textures or browser errors.');
} finally { await browser?.close(); server?.kill('SIGTERM'); }
