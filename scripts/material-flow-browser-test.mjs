import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.SITE_URL || 'http://127.0.0.1:4197/fluid-pocket-sandbox/';
const server = process.env.SITE_URL ? null : spawn(process.execPath, ['scripts/dev-server.mjs'], {
  stdio: 'ignore', env: { ...process.env, PORT: '4197', BASE_PATH: '/fluid-pocket-sandbox' }
});
let browser;
try {
  if (server) for (let n = 0; n < 60; n++) { try { if ((await fetch(base)).ok) break; } catch {} await sleep(100); }
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', ...JSON.parse(process.env.BROWSER_ARGS || '[]')] });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  const errors = [], missing = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400) missing.push(r.url()); });
  await mkdir('test-results', { recursive: true });
  await page.goto(base); await page.waitForSelector('body[data-game-ready=true]');
  await page.locator('#worldSeed').fill('material-flow-browser'); await page.locator('#newWorldBtn').click();
  await page.waitForSelector('body[data-game-state=brewing]'); await page.locator('#skipTutorial').click();
  for (const size of [{ width: 320, height: 568 }, { width: 393, height: 852 }]) {
    await page.setViewportSize(size);
    const box = await page.locator('#pourToolBtn').boundingBox();
    assert.ok(box.width >= 40 && box.height >= 44 && box.x >= 0 && box.x + box.width <= size.width, 'stream tool stays reachable on small phones');
  }
  await page.locator('#pourToolBtn').click();
  assert.equal(await page.locator('#pourToolBtn').getAttribute('aria-pressed'), 'true');
  const coords = await page.evaluate(async () => {
    const { LaboratoryRenderer } = await import('./src/game/LaboratoryRenderer.mjs');
    const view = Object.create(LaboratoryRenderer.prototype); view.canvas = document.querySelector('#labCanvas');
    return { left: view.projectWorldToScreen(-.85, .65), right: view.projectWorldToScreen(.85, .65), outside: view.projectWorldToScreen(3.8, .65) };
  });
  const cdp = await page.context().newCDPSession(page);
  const finger = (type, point = coords.left) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: ['touchEnd', 'touchCancel'].includes(type) ? [] : [{ ...point, id: 1 }]
  });
  const snapshot = () => page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
    return JSON.parse(localStorage.getItem('alchemists-shop-save'));
  });
  const volume = save => save.brew.portions.reduce((sum, p) => sum + p.ml, 0);
  const inventory = (await snapshot()).inventory[1];
  await finger('touchStart'); await page.waitForTimeout(350);
  const first = volume(await snapshot()); assert.ok(first >= 1 && first < 10, 'Pour starts immediately with a small stream, not a 20 ml dose');
  for (let n = 1; n <= 8; n++) {
    await finger('touchMove', { x: coords.left.x + (coords.right.x - coords.left.x) * n / 8, y: coords.left.y });
    await page.waitForTimeout(80);
  }
  const moving = await snapshot(); assert.ok(volume(moving) > first + 2, 'moving the finger keeps the stream running');
  assert.ok(moving.brew.particles.x.some((x, i) => x > .25 && moving.brew.particles.y[i] > 0), 'fresh stream follows the finger to the right');
  const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('test-results/material-flow-touch.png', Buffer.from(capture.data, 'base64'));
  await finger('touchMove', coords.outside); await page.waitForTimeout(100);
  const outside = volume(await snapshot()); await page.waitForTimeout(250);
  assert.equal(volume(await snapshot()), outside, 'outside movement pauses without storing pour credit');
  await finger('touchMove', coords.right); await page.waitForTimeout(250);
  assert.ok(volume(await snapshot()) > outside, 'the stream resumes on re-entry');
  await finger('touchEnd'); const released = await snapshot(); await page.waitForTimeout(300);
  assert.equal(volume(await snapshot()), volume(released), 'release has no bonus dose or continued emission');
  assert.equal(released.inventory[1] + volume(released), inventory, 'stream inventory equals actual emitted quantity');
  await finger('touchStart'); await page.waitForTimeout(250); await finger('touchCancel');
  const cancelled = volume(await snapshot()); await page.waitForTimeout(250);
  assert.equal(volume(await snapshot()), cancelled, 'touch cancellation stops the stream');
  await cdp.detach();
  await page.reload(); await page.waitForSelector('body[data-game-ready=true]'); await page.locator('#continueBtn').click();
  await page.waitForSelector('body[data-game-state=brewing]'); assert.equal(volume(await snapshot()), cancelled);

  const visual = await page.evaluate(async () => {
    const { BrewingSession } = await import('./src/game/brewing.mjs');
    const { LaboratoryRenderer } = await import('./src/game/LaboratoryRenderer.mjs');
    const { generateWorld } = await import('./src/game/world.mjs');
    const { Phase } = await import('./src/simulation/Phase.mjs');
    const { intactIngredientPieces } = await import('./src/game/IngredientPieces.mjs');
    const { paintMaterialParticles } = await import('./src/game/MaterialRaster.mjs');
    const { solidIngredientCanvas } = await import('./src/game/art.mjs');
    const b = new BrewingSession(generateWorld('material-visual').ingredients, { cauldron: 2 });
    const canvas = document.createElement('canvas'), renderer = new LaboratoryRenderer(canvas, b);
    const captures = {}, check = (ok, message) => { if (!ok) throw Error(message); };
    const capture = name => { renderer.render(); captures[name] = canvas.toDataURL(); };
    try {
      b.pour(1, 160, { 1: 200 }); for (let n = 0; n < 240; n++) b.step();
      b.lastPour = null; renderer.graphics.effectsScale = 0; capture('liquid');
      b.setThermal(0, 1); for (let n = 0; n < 440; n++) b.step(); capture('frost-front');
      for (let n = 0; n < 500; n++) b.step();
      const ps = b.engine.ps;
      check(ps.phaseCounts()[Phase.SOLID] === ps.count, 'Frost must complete in the native browser');
      check(new Set(ps.solidBodyId.subarray(0, ps.count)).size === 1, 'the cold front retains one frozen block');
      capture('frozen');
      const left = Array.from({ length: ps.count }, (_, i) => i).sort((i, j) => ps.x[i] - ps.x[j])[Math.floor(ps.count * .15)];
      const hit = b.crush({ x: ps.x[left], y: ps.y[left] });
      check(hit > 0 && hit < ps.count, 'pestle crushes only the touched frozen region');
      renderer.render(); capture('crushed-ice');
      check(ps.frozenRadius.subarray(0, ps.count).filter(r => r === 0).length === hit, 'crushed ice uses grain rendering');
      b.clean();
      const ingredient = b.ingredients.find(i => i.crushable && i.appearance?.shape === 'crystal') || b.ingredients.find(i => i.crushable);
      b.pour(ingredient.id, 30, { [ingredient.id]: 50 }, { point: { x: 0, y: -.1 } });
      b.lastPour = null;
      const rawIds = new Map([[ingredient.id, ingredient]]), pieces = intactIngredientPieces(ps, rawIds);
      // Regression: both backends leave uncrushed whole solids for ONE sprite
      // per piece, rather than painting underlying per-parcel grain dots.
      const targetSprite = solidIngredientCanvas(ingredient), drawImage = renderer.ctx.drawImage;
      let wholeSpriteDraws = 0;
      renderer.ctx.drawImage = function (...args) {
        if (args[0] === targetSprite) wholeSpriteDraws++;
        return drawImage.apply(this, args);
      };
      try { capture('raw'); } finally { renderer.ctx.drawImage = drawImage; }
      check(wholeSpriteDraws === pieces.size,
        'intact button-poured objects must use exactly one full-size material sprite each');
      if (renderer.fluidGPU.available)
        check(renderer.fluidGPU.groups[2].count === 0, 'GPU must not draw whole raw material as grain circles');
      const raster = new Uint8ClampedArray(160 * 120 * 4);
      paintMaterialParticles(ps, { w: 160, h: 120, cx: 80, cy: 60, scale: 40 },
        raster, renderer.materialColor, renderer.colorScratch, rawIds);
      check(raster.every(v => v === 0), 'canvas fallback must not render intact ingredients as grains');
      const piece = [...pieces.values()].find(p => p.indices.length >= 4);
      const initialSize = piece.size, index = piece.indices[0], original = ps.solidBodyId[index];
      const touched = b.crush({ x: ps.x[index] - .1, y: ps.y[index] });
      capture('raw-crushed'); check(touched > 0, 'raw texture receives real pestle damage');
      for (let n = 0; n < 6; n++) { b.pour(ingredient.id, 10, { [ingredient.id]: 20 }, { point: { x: 0, y: -.1 } }); for (let tick = 0; tick < 10; tick++) b.step(); }
      const remaining = [...intactIngredientPieces(ps, rawIds).values()];
      check(remaining.every(p => p.size < .57 && p.indices.length <= 8), 'tower sprites stay bounded');
      for (let i = 0; i < ps.count; i++) if (ps.solidBodyId[i] === original) check(ps.solidArtSize[i] === initialSize, 'existing artwork cannot enlarge');
      b.lastPour = null; capture('raw-tower');
      b.clean(); b.pour(1, 160, { 1: 200 }); for (let n = 0; n < 240; n++) b.step();
      for (let i = 0; i < ps.count; i++) { ps.setPhase(i, Phase.GAS); ps.temperature[i] = .95; }
      b.engine.rules.thermalDiffusionRate = 0; b.engine.env.ambientThermalExchange = 0;
      for (let n = 0; n < 240; n++) b.engine.step(.025);
      b.lastPour = null; capture('vapour');
      const heights = ps.y.subarray(0, ps.count);
      check(Math.max(...heights) - Math.min(...heights) > .35, 'vapour occupies several layers below the lid');
      renderer.fluidGPU.available = false; capture('vapour-fallback');
      return { captures, icePowder: hit, rawDamage: touched, boundedPieces: remaining.length, backend: 'webgl2 and canvas' };
    } finally { renderer.dispose(); b.dispose(); }
  });
  for (const [name, png] of Object.entries(visual.captures)) await writeFile(`test-results/material-${name}.png`, Buffer.from(png.split(',')[1], 'base64'));
  delete visual.captures;
  assert.deepEqual(errors, []); assert.deepEqual(missing, []);
  console.log('Material flow browser OK: real moving touch, outside/re-entry/release/cancel, inventory and reload; native frost, crushed powder, bounded local artwork and volumetric vapour.', JSON.stringify(visual));
} finally { await browser?.close(); server?.kill(); }
