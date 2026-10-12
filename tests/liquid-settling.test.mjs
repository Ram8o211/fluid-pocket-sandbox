import test from 'node:test';
import assert from 'node:assert/strict';
import { BrewingSession } from '../src/game/brewing.mjs';
import { generateWorld } from '../src/game/world.mjs';
import { FIXED_STEP } from '../src/game/contracts.mjs';
import { Phase } from '../src/simulation/Phase.mjs';
import { insideCauldron, cauldronParticlePadding } from '../src/game/cauldron.mjs';
import { updateElectrical } from '../src/simulation/ElectricalSolver.mjs';

const close = (a, b) => assert.ok(Math.abs(a - b) < .001, `${a} != ${b}`);
function ticks(brew, count, stir = false) {
  for (let i = 0; i < count; i++) { if (stir) brew.assistStir(); brew.step(); }
}
function heights(brew) {
  const ps = brew.engine.ps, ys = Array.from(ps.y.subarray(0, ps.count)).sort((a, b) => a - b);
  return { mean: ys.reduce((sum, y) => sum + y, 0) / ys.length, p95: ys[Math.floor(ys.length * .95)], top: ys.at(-1) };
}
function bowl(brew) {
  const ps = brew.engine.ps;
  for (let i = 0; i < ps.count; i++) assert.ok(insideCauldron(ps.x[i], ps.y[i], cauldronParticlePadding(ps, i)));
}

test('charged fine liquids fall into a bottom pool rather than levitating across the cauldron', () => {
  for (const seed of ['settling-test', 'mobile-acceptance', 'moonlight']) {
    for (const charge of [-.95, .95]) {
      const brew = new BrewingSession(generateWorld(seed).ingredients);
      brew.pour(1, 60, { 1: 100 }); brew.engine.ps.electricPotential.fill(charge);
      const mass = brew.engine.ps.totalMass(); ticks(brew, 240);
      const h = heights(brew);
      assert.ok(h.mean < -.8, `${seed}: suspended centre of mass ${h.mean}`);
      assert.ok(h.p95 < -.5, `${seed}: floating upper layer ${h.p95}`);
      assert.ok(h.top < -.3, `${seed}: airborne liquid ${h.top}`);
      close(brew.engine.ps.totalMass(), mass); close(brew.liquidVolume, 60); bowl(brew);
      assert.equal(brew.engine.ps.phaseCounts()[Phase.GAS], 0);
    }
  }
});

test('unsupported liquids retain the correct downward acceleration independent of texture', () => {
  for (const viscosity of [.02, .95]) {
    const brew = new BrewingSession(generateWorld('drop-check').ingredients), ps = brew.engine.ps;
    brew.pour(1, 1, { 1: 10 });
    // One isolated parcel: no floor contact, packing or neighbour forces.
    ps.count = 1; ps.x[0] = 0; ps.y[0] = .5; ps.vx[0] = ps.vy[0] = 0; ps.viscosity[0] = viscosity;
    brew.step();
    close(ps.vy[0], -4.5 * FIXED_STEP); close(ps.y[0], .5 - 4.5 * FIXED_STEP ** 2);
  }
});

test('contact stirring moves a local parcel without lifting the bulk, then settles', () => {
  const brew = new BrewingSession(generateWorld('settling-test').ingredients);
  brew.pour(1, 60, { 1: 100 }); ticks(brew, 240); const resting = heights(brew);
  const ps=brew.engine.ps, point={x:ps.x[0],y:ps.y[0]};
  const touched=brew.stir(point,{x:1,y:6},.05);
  assert.ok(touched>0 && touched<ps.count/4);assert.ok(ps.vy[0]>0);
  ticks(brew,80,true);const stirred=heights(brew);
  assert.ok(stirred.mean < resting.mean + .1);assert.ok(brew.history.stirred>0);
  ticks(brew, 160); const settled = heights(brew);
  assert.ok(settled.mean < -.8); assert.ok(settled.p95 < -.5);
  close(brew.liquidVolume, 60); bowl(brew);
});

test('previously floating saves settle while retaining charge properties, stock value and mass', () => {
  const world = generateWorld('settling-test'), source = new BrewingSession(world.ingredients);
  source.pour(1, 60, { 1: 100 }); const snapshot = source.snapshot();
  for (let i = 0; i < snapshot.count; i++) {
    snapshot.particles.y[i] = .2 + (i % 8) * .08;
    snapshot.particles.vy[i] = 1;
    snapshot.particles.electricPotential[i] = .95;
  }
  const restored = new BrewingSession(world.ingredients); restored.restore(snapshot);
  const mass = restored.engine.ps.totalMass(), cost = { ...restored.cost };
  ticks(restored, 240);
  assert.ok(heights(restored).p95 < -.5); close(restored.engine.ps.totalMass(), mass);
  close(restored.liquidVolume, 60); close(restored.engine.ps.electricPotential[0], .95);
  assert.deepEqual(restored.cost, cost); bowl(restored);
});

test('vapour retains upward buoyancy while the liquid settling correction is enabled', () => {
  const brew = new BrewingSession(generateWorld('steam-rise').ingredients), ps = brew.engine.ps;
  brew.pour(1, 1, { 1: 10 }); ps.count = 1;
  ps.x[0] = 0; ps.y[0] = -.5; ps.vx[0] = ps.vy[0] = 0;
  ps.temperature[0] = .5; ps.boilingTemperature[0] = .15; ps.setPhase(0, Phase.GAS);
  ticks(brew, 40);
  assert.equal(ps.phase[0], Phase.GAS); assert.ok(ps.y[0] > -.4); assert.ok(ps.vy[0] > 0); bowl(brew);
});

test('neutral shop fluids still conduct charge without mechanical electrical repulsion', () => {
  const brew = new BrewingSession(generateWorld('conducting-liquid').ingredients), ps = brew.engine.ps;
  brew.pour(1, 1, { 1: 10 }); ps.count = 2;
  for (let i = 0; i < 2; i++) {
    ps.x[i] = i ? .05 : -.05; ps.y[i] = -.5; ps.vx[i] = ps.vy[i] = 0;
    ps.electricalConductivity[i] = .8; ps.electricPotential[i] = i ? -.6 : .6;
  }
  brew.engine.grid.rebuild(ps, brew.engine.env.box);
  updateElectrical(ps, brew.engine.grid, brew.engine.rules, FIXED_STEP);
  assert.ok(Math.abs(ps.electricPotential[0] - ps.electricPotential[1]) < 1.2);
  close(ps.electricPotential[0] + ps.electricPotential[1], 0);
  for (let i = 0; i < 2; i++) { assert.equal(ps.vx[i], 0); assert.equal(ps.vy[i], 0); }
});
