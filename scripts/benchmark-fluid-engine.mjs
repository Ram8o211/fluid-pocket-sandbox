import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import assert from 'node:assert/strict';
import { BrewingSession } from '../src/game/brewing.mjs';
import { generateWorld } from '../src/game/world.mjs';
import { Phase } from '../src/simulation/Phase.mjs';

// Run the real vendored engine in the same realm as its game adapter. A VM
// context adds cross-context overhead that is absent in the browser.
const native = !process.argv.includes('--fallback');
if (native) {
  globalThis.print = () => {}; globalThis.printErr = () => {};
  runInThisContext(readFileSync(new URL('../public/vendor/liquidfun.js', import.meta.url), 'utf8'));
}
const world = generateWorld('fluid-engine-benchmark');
const results = [];
const selected = process.argv.find(arg => arg.startsWith('--case='))?.slice(7);
for (const form of ['Water', 'Infusion', 'Sand', 'Dough', 'Ice', 'Vapour', 'Pouring'].filter(form => !selected || form === selected)) {
  for (const volume of [120, 440]) {
    const brew = new BrewingSession(world.ingredients, { cauldron: 2 });
    try {
      const inventory = { 1: 1000, 2: 1000, 10: 1000, 11: 1000 };
      if (form === 'Infusion') {
        brew.pour(2, Math.round(volume * .12), inventory, { crushed: true });
        brew.pour(1, volume - Math.round(volume * .12), inventory);
      } else if (form === 'Sand' || form === 'Dough') {
        brew.pour(10, volume / 2, inventory, { crushed: true });
        brew.pour(form === 'Sand' ? 11 : 1, volume / 2, inventory);
      } else brew.pour(1, form === 'Pouring' ? volume - 100 : volume, inventory);
      if (form === 'Ice' || form === 'Vapour') {
        for (let i = 0; i < 200; i++) brew.step();
        const ps = brew.engine.ps;
        brew.engine.env.ambientThermalExchange = 0;
        brew.engine.rules.thermalDiffusionRate = 0;
        for (let i = 0; i < ps.count; i++) {
          ps.meltingTemperature[i] = .2; ps.boilingTemperature[i] = .7;
          ps.phaseHysteresis[i] = .01; ps.volatility[i] = .7;
          ps.temperature[i] = form === 'Ice' ? .05 : 1;
        }
        for (let i = 0; i < 500; i++) brew.engine.step(.025);
        assert.equal(ps.phaseCounts()[form === 'Ice' ? Phase.SOLID : Phase.GAS], ps.count);
      }
      const stirring = form === 'Infusion' || form === 'Dough';
      let measuring = false, pouredMl = 0;
      const tick = i => {
        if (stirring) brew.assistStir();
        if (form === 'Pouring' && measuring) pouredMl += brew.pour(1, .5, inventory,
          { continuous: true, point: { x: Math.sin(i * .12) * 1.6, y: .95 } });
        brew.step();
        if (i % 8 === 0) brew.inspect();
      };
      for (let i = 0; i < 160; i++) tick(i);
      const ps = brew.engine.ps, mass = ps.totalMass(), times = [];
      const rebuilds = brew.engine.liquidFun?.rebuilds || 0, appends = brew.engine.liquidFun?.appends || 0;
      measuring = true;
      for (let i = 0; i < 200; i++) {
        const start = performance.now(); tick(i); times.push(performance.now() - start);
      }
      const expectedAddedMass = pouredMl * world.ingredients.find(ingredient => ingredient.id === 1).material.density;
      assert.ok(Math.abs(ps.totalMass() - mass - expectedAddedMass) < .0001);
      for (let i = 0; i < ps.count; i++) assert.ok(Number.isFinite(ps.x[i]) && Number.isFinite(ps.vy[i]));
      times.sort((a, b) => a - b);
      const result = { backend: native ? 'LiquidFun' : 'fallback', form, ml: volume, particles: ps.count,
        medianMs: +times[100].toFixed(3), p95Ms: +times[190].toFixed(3),
        ...(form === 'Pouring' ? { pouredMl, nativeRebuilds: (brew.engine.liquidFun?.rebuilds || 0) - rebuilds,
          nativeAppends: (brew.engine.liquidFun?.appends || 0) - appends } : {}) };
      results.push(result);
      if (!process.argv.includes('--json')) console.log(`${result.backend} ${form} ${volume} ml: median ${result.medianMs} ms, p95 ${result.p95Ms} ms`);
    } finally { brew.dispose(); }
  }
}
if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 2));
