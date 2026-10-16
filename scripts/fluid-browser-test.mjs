import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.SITE_URL || 'http://127.0.0.1:4193/fluid-pocket-sandbox/';
const server = process.env.SITE_URL ? null : spawn(process.execPath, ['scripts/dev-server.mjs'], {
  stdio: 'ignore', env: { ...process.env, PORT: '4193', BASE_PATH: '/fluid-pocket-sandbox' }
});
let browser;
try {
  if (server) for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await sleep(100);
  }
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined,
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader', ...JSON.parse(process.env.BROWSER_ARGS || '[]')] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.goto(base); await page.waitForSelector('body[data-game-ready="true"]');
  await page.locator('#worldSeed').fill('mobile-magical-garden');
  await page.locator('#newWorldBtn').click();
  await page.waitForSelector('body[data-game-state="brewing"]');
  const result = await page.evaluate(async () => {
    const { FluidSurfaceGPU } = await import('./src/game/FluidSurfaceGPU.mjs');
    const { LaboratoryRenderer } = await import('./src/game/LaboratoryRenderer.mjs');
    const { ParticleSystem } = await import('./src/simulation/ParticleSystem.mjs');
    const { BrewingSession } = await import('./src/game/brewing.mjs');
    const { generateWorld } = await import('./src/game/world.mjs');
    const { Phase } = await import('./src/simulation/Phase.mjs');
    const { effectiveParticleRadius } = await import('./src/simulation/FluidSolver.mjs');
    const { sanitizeMaterial } = await import('./src/materials/MaterialDefinition.mjs');
    const { paintMaterialParticles } = await import('./src/game/MaterialRaster.mjs');
    const { particleMagicAuras } = await import('./src/game/magicLight.mjs');
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const color = (ps, i, out) => { out.r = ps.r[i] * 255; out.g = ps.g[i] * 255; out.b = ps.b[i] * 255; };
    const scratch = { r: 0, g: 0, b: 0 }, t = { w: 384, h: 232, cx: 192, cy: 158, scale: 40 };
    const material = sanitizeMaterial({ id: 1, color: '#40a0c0', density: 1, particleRadius: .105 });
    const gpu = FluidSurfaceGPU.create(document);
    check(gpu?.available, 'WebGL2 half-float rendering must run in the acceptance browser');
    const gl = gpu.gl;
    // Readbacks are confined to acceptance tests, never used by gameplay.
    const pixels = () => {
      const data = new Uint8Array(gpu.width * gpu.height * 4);
      gl.readPixels(0, 0, gpu.width, gpu.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return data;
    };
    const pixel = (data, x, y, scale = 40) => {
      const n = (Math.floor(gpu.height / 2 + y * scale) * gpu.width + Math.floor(gpu.width / 2 + x * scale)) * 4;
      return Array.from(data.subarray(n, n + 4));
    };
    const ps = new ParticleSystem(128); ps.packingScale = .6; ps.volumePacking = true;
    // Actual compact LiquidFun parcel spacing, with subpixel centres.
    const spacing = .039 * Math.sqrt(2) * 1.5;
    for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++)
      ps.add({ x: x * spacing + (y % 2 ? spacing / 2 : 0), y: y * spacing * .866, z: 0, mass: .5 }, material, Phase.LIQUID);
    const before = Array.from(ps.r);
    gpu.render(ps, t, color, scratch, [], 0);
    const pool = pixels();
    for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++)
      check(pixel(pool, x / 40, y / 40)[3] === 255, 'GPU liquid has an interior pinhole');
    check(gpu.stats.drawCalls === 2, 'a liquid pool should take only two draw calls');
    check(gpu.stats.uploadedBytes === ps.count * 48, 'upload only active instance records');
    check(before.every((v, i) => v === ps.r[i]), 'surface reconstruction must not alter diffusion');
    ps.count = 0;
    ps.add({ x: -.5, y: 0, z: 0, mass: .5 }, material, Phase.LIQUID);
    ps.add({ x: .5, y: 0, z: 0, mass: .5 }, sanitizeMaterial({ ...material, id: 2, color: '#c04040' }), Phase.LIQUID);
    gpu.render(ps, t, color, scratch, [], 0);
    const separate = pixels();
    check(pixel(separate, 0, 0)[3] === 0, 'remote droplets must remain disconnected');
    const blue = pixel(separate, -.5, 0), red = pixel(separate, .5, 0);
    check(blue[2] > blue[0] * 2 && red[0] > red[2] * 2, 'unmixed droplets must retain their own colour');
    // Use the real native particle/body gap, including half-drained parcels
    // and eco resolution. Raw art cannot remove the underlying solid surface.
    for (const resolution of [20, 40]) for (const amount of [.25, .5]) for (const subdivision of [.1, 1]) {
      ps.count = 0; ps.nativeLiquidRadius = .039 * Math.sqrt(amount / .25);
      ps.add({ x: 0, y: 0, z: 0, mass: amount }, material, Phase.SOLID);
      ps.solidSubdivision[0] = subdivision;
      const separation = effectiveParticleRadius(ps, 0, true) + ps.nativeLiquidRadius * 2;
      ps.add({ x: separation, y: 0, z: 0, mass: amount }, material, Phase.LIQUID);
      gpu.render(ps, t, color, scratch, [], 0, resolution, new Map([[1, material]]));
      const touching = pixels();
      for (let x = 0; x <= separation; x += 1 / resolution)
        check(pixel(touching, x, 0, resolution)[3] >= 220, 'GPU liquid/solid contact has a visible empty seam');
    }
    // Every phase fades continuously through the exact discrete handoff.
    ps.count = 0; ps.nativeLiquidRadius = .039 * Math.sqrt(.5 / .25);
    ps.add({ x: 0, y: 0, z: 0, mass: .5 }, material, Phase.LIQUID);
    for (const [from, to, temperature] of [[Phase.LIQUID, Phase.GAS, 1], [Phase.GAS, Phase.LIQUID, .5],
      [Phase.LIQUID, Phase.SOLID, .05], [Phase.SOLID, Phase.LIQUID, .5]]) {
      ps.setPhase(0, from); ps.temperature[0] = temperature;
      ps.meltingTemperature[0] = .2; ps.boilingTemperature[0] = .7; ps.phaseHysteresis[0] = .01;
      ps.phaseTarget[0] = to;
      let previous, final;
      for (let frame = 0; frame <= 40; frame++) {
        ps.phaseProgress[0] = frame / 40;
        gpu.render(ps, t, color, scratch, [], 0);
        const current = pixels();
        if (previous) {
          let opacityDelta = 0;
          for (let n = 3; n < current.length; n += 4) opacityDelta += Math.abs(current[n] - previous[n]);
          check(opacityDelta < 2200, 'phase appearance changed abruptly between adjacent frames');
        }
        previous = current; final = current;
      }
      // The real connected-freeze handoff records the original native water
      // footprint before switching phase. Simulate that atomic metadata handoff
      // here too; otherwise this synthetic setPhase() creates an artificial
      // grain that is never produced by the actual brewing pipeline.
      if (from === Phase.LIQUID && to === Phase.SOLID) ps.frozenRadius[0] = ps.nativeLiquidRadius;
      ps.setPhase(0, to);
      if (from === Phase.SOLID && to === Phase.LIQUID) ps.frozenRadius[0] = 0;
      gpu.render(ps, t, color, scratch, [], 0);
      const handoff = pixels();
      check(handoff.every((v, n) => Math.abs(v - final[n]) <= 1), 'phase handoff left an opacity or texture pop');
    }
    // Reconstruct light from actual concentrations, with no weak-magic cutoff.
    ps.setPhase(0, Phase.LIQUID); ps.temperature[0] = .5;
    gpu.render(ps, t, color, scratch, [], 0); const unlit = pixel(pixels(), 0, 0);
    ps.poison[0] = .1; gpu.render(ps, t, color, scratch, particleMagicAuras(ps)); const weak = pixel(pixels(), 0, 0);
    ps.poison[0] = .2; gpu.render(ps, t, color, scratch, particleMagicAuras(ps)); const strong = pixel(pixels(), 0, 0);
    for (let k = 0; k < 3; k++) check(Math.abs((strong[k] - unlit[k]) - 2 * (weak[k] - unlit[k])) <= 2,
      'GPU glow must scale with actual power');
    ps.count = 0;
    ps.add({ x: -.5, y: 0, z: 0, mass: .5 }, material, Phase.GAS);
    ps.add({ x: .5, y: 0, z: 0, mass: .5 }, material, Phase.SOLID);
    ps.phase[0] = Phase.GAS; ps.phase[1] = Phase.SOLID; ps.solidSubdivision[1] = 1; ps.powderContent[1] = 1;
    ps.poison.fill(.7, 0, ps.count);
    gpu.render(ps, t, color, scratch, particleMagicAuras(ps), 1);
    const phases = pixels(), steam = pixel(phases, -.5, 0), grain = pixel(phases, .5, 0);
    check(steam[3] > 0 && steam[3] < 160, 'vapour must be translucent');
    check(grain[3] > 240, 'powder must remain a visible grain');
    check(gpu.stats.glowingParticles === 2, 'each enchanted phase must receive its own light');
    ps.count = 0; gpu.render(ps, t, color, scratch, [], 0);
    check(pixels().every(v => v === 0), 'phase changes/removal must not leave GPU trails');
    check(gl.getError() === gl.NO_ERROR, 'GPU rendering produced a WebGL error');

    const brew = new BrewingSession(generateWorld('gpu-fluid-acceptance').ingredients, { cauldron: 2 });
    let renderer;
    try {
      brew.pour(1, 440, { 1: 500 });
      for (let tick = 0; tick < 260; tick++) brew.step();
      const canvas = document.createElement('canvas'); canvas.id = 'fluidAcceptanceCanvas';
      document.body.append(canvas); renderer = new LaboratoryRenderer(canvas, brew);
      renderer.render();
      check(renderer.materialBackend === 'webgl2', 'laboratory must select the GPU path');
      const auras = particleMagicAuras(brew.engine.ps), timings = { gpu: [], canvas: [] };
      const cpuTransform = renderer.transform();
      const cpuPixels = new Uint8ClampedArray(cpuTransform.w * cpuTransform.h * 4);
      for (let frame = 0; frame < 100; frame++) {
        let start = performance.now();
        renderer.drawFluid(renderer.ctx, renderer.transform());
        timings.gpu.push(performance.now() - start);
        start = performance.now();
        paintMaterialParticles(brew.engine.ps, cpuTransform, cpuPixels, color, scratch);
        timings.canvas.push(performance.now() - start);
      }
      // Float field allocations stay bounded at native pixel-art resolution on
      // a 2x phone display; no display-sized CPU surface buffer is allocated.
      check(renderer.fluidGPU.width === 192 && renderer.fluidGPU.height === 100, 'DPR must not multiply field work');
      check(!renderer.matterPixels, 'GPU gameplay must not allocate the CPU pixel surface');
      const stats = { ...renderer.fluidGPU.stats };
      for (let i = 0; i < brew.engine.ps.count; i += 3) {
        brew.engine.ps.setPhase(i, Phase.GAS); brew.engine.ps.temperature[i] = .9;
        brew.engine.ps.boilingTemperature[i] = .5;
        brew.engine.ps.y[i] = .55 + (i % 7) * .065; brew.engine.ps.x[i] *= .8;
      }
      renderer.render();
      check(renderer.fluidGPU.stats.drawCalls === 4, 'mixed fluid/vapour should take four draw calls');
      check(brew.stir({ x: 0, y: .7 }, { x: 4, y: 0 }, .025, { x: -1, y: .7 }) > 0, 'spoon must touch the steam');
      check(brew.engine.ps.vx.some((v, i) => brew.engine.ps.phase[i] === Phase.GAS && v > .1), 'steam must move with a spoon stroke');
      // Deliberately exercise loss, canvas fallback, restoration and disposal.
      const lose = renderer.fluidGPU.gl.getExtension('WEBGL_lose_context');
      const eventWithin = name => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(name + ' timed out')), 10000);
        renderer.fluidGPU.canvas.addEventListener(name, event => { clearTimeout(timeout); resolve(event); }, { once: true });
      });
      const lost = eventWithin('webglcontextlost');
      lose.loseContext(); await lost; renderer.drawFluid(renderer.ctx, renderer.transform());
      check(renderer.materialBackend === 'canvas', 'context loss must use the playable canvas fallback');
      // Let the loss event finish dispatching/cancelling before restoring it.
      await new Promise(resolve => setTimeout(resolve, 50));
      const restored = eventWithin('webglcontextrestored');
      lose.restoreContext(); await restored; renderer.render();
      check(renderer.materialBackend === 'webgl2', 'restored context must resume GPU rendering');
      const fallback = FluidSurfaceGPU.create({ createElement: () => ({ getContext: () => null }) });
      check(fallback === null, 'devices without WebGL2 must select the fallback');
      const quantiles = values => { values.sort((a, b) => a - b); return { median: values[50], p95: values[95] }; };
      const answer = { stats, gpuSubmissionMs: quantiles(timings.gpu), cpuSurfaceMs: quantiles(timings.canvas),
        gpuAvailable: true, contextRecovery: true, particles: brew.engine.ps.count, auraCount: auras.length };
      // Let the actual mechanics close holes left by the deliberately removed
      // liquid parcels before capturing the liquid/vapour scene.
      brew.engine.env.ambientThermalExchange = 0; brew.engine.rules.thermalDiffusionRate = 0;
      for (let tick = 0; tick < 200; tick++) brew.engine.step(.025);
      renderer.render();
      answer.image = canvas.toDataURL('image/png');
      brew.clean(); brew.pour(1, 90, { 1: 100 });
      for (let tick = 0; tick < 220; tick++) brew.step();
      brew.pour(4, 12, { 4: 20 }); brew.pour(3, 10, { 3: 20 }, { crushed: true });
      for (let tick = 0; tick < 240; tick++) brew.step();
      renderer.render(); answer.contactImage = canvas.toDataURL('image/png');
      return answer;
    } finally { renderer?.dispose(); brew.dispose(); gpu.dispose(); }
  });
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/fluid-gpu.png', Buffer.from(result.image.split(',')[1], 'base64'));
  await writeFile('test-results/fluid-contact.png', Buffer.from(result.contactImage.split(',')[1], 'base64'));
  delete result.image;
  delete result.contactImage;
  await writeFile('test-results/fluid-gpu-metrics.json', JSON.stringify(result, null, 2));
  assert.deepEqual(errors, [], 'no browser exceptions');
  console.log('GPU liquid continuity, local colours, steam, grain texture, per-parcel magic, DPR budget, context recovery and fallback OK', JSON.stringify(result));
} finally { await browser?.close(); server?.kill(); }
