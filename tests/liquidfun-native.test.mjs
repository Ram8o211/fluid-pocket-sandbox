import test from 'node:test';
import assert from 'node:assert/strict';
import { liquidFunRuntime } from './helpers/liquidfun-runtime.mjs';
import { LiquidFunFluid } from '../src/game/LiquidFunFluid.mjs';
import { BrewingSession } from '../src/game/brewing.mjs';
import { generateWorld } from '../src/game/world.mjs';
import { simulateWitness } from '../src/game/orders.mjs';
import { Phase } from '../src/simulation/Phase.mjs';
import { generateLiquidWorld } from './helpers/liquid-world.mjs';
import { insideCauldron, cauldronParticlePadding } from '../src/game/cauldron.mjs';
import { particlePairRestDistance } from '../src/simulation/FluidSolver.mjs';

const runtime = liquidFunRuntime();
function brew() {
  const session = new BrewingSession(generateWorld('native-physics-regression').ingredients);
  session.engine.liquidFun = new LiquidFunFluid(runtime);
  return session;
}
function nativeCount(backend) {
  return runtime.Module._b2ParticleSystem_GetParticleCount(backend.system.ptr);
}

test('real LiquidFun keeps every parcel and its identity through native steps and membership changes', () => {
  const b = brew(), ps = b.engine.ps, backend = b.engine.liquidFun;
  b.pour(1, 60, { 1: 100 });
  const mass = ps.totalMass();
  ps.strength.fill(.2, 0, ps.count); ps.poison.fill(.4, 0, ps.count);
  const thresholds = Array.from(ps.arcaneThreshold.subarray(0, ps.count));
  for (let tick = 0; tick < 40; tick++) {
    b.step();
    assert.equal(nativeCount(backend), ps.count, 'native C++ must not silently delete ingredient parcels');
    assert.equal(backend.system.GetPositionBuffer().length, ps.count * 2, 'never extend a truncated buffer');
  }
  assert.equal(ps.totalMass(), mass);
  assert.deepEqual(Array.from(ps.arcaneThreshold.subarray(0, ps.count)), thresholds);
  assert.ok(ps.strength.subarray(0, ps.count).every(v => Math.abs(v - .2) < .0001));
  assert.ok(ps.poison.subarray(0, ps.count).every(v => Math.abs(v - .4) < .0001));
  ps.setPhase(3, Phase.GAS); ps.boilingTemperature[3] = 0; ps.temperature[3] = .8;
  b.step(); assert.equal(nativeCount(backend), ps.count - 1);
  ps.setPhase(3, Phase.LIQUID); ps.boilingTemperature[3] = 1.2; ps.temperature[3] = .33;
  b.step(); assert.equal(nativeCount(backend), ps.count);
  b.pour(1, 7, { 1: 20 }); b.step(); assert.equal(nativeCount(backend), ps.count);
  b.bottle(10); b.step(); assert.equal(nativeCount(backend), ps.count);
  b.dispose();
});

test('real LiquidFun settles a poured bowl of water with no suspended or escaping parcels', () => {
  const b = brew(), ps = b.engine.ps;
  b.pour(1, 60, { 1: 100 });
  for (let tick = 0; tick < 240; tick++) b.step();
  const heights = Array.from(ps.y.subarray(0, ps.count)).sort((a, b) => a - b);
  const mean = heights.reduce((a, y) => a + y, 0) / ps.count;
  assert.ok(mean < -.8, `water must pool at the bottom, mean height ${mean}`);
  assert.ok(heights[Math.floor(ps.count * .95)] < -.5, '95% of the water must settle into the pool');
  for (let i = 0; i < ps.count; i++) {
    assert.ok(Number.isFinite(ps.x[i]) && Number.isFinite(ps.vx[i]) && Number.isFinite(ps.vy[i]));
    assert.ok(insideCauldron(ps.x[i], ps.y[i], cauldronParticlePadding(ps, i)));
  }
  assert.ok(Math.abs(b.liquidVolume - 60) < .001);
  b.dispose();
});

test('material viscosity and wet dough still resist relative motion with the native backend', () => {
  const relativeSpeed = (viscosity, powderContent = 0) => {
    const b = brew(), ps = b.engine.ps;
    b.pour(1, 1, { 1: 10 }); ps.count = 2;
    for (let i = 0; i < 2; i++) {
      ps.x[i] = i ? .03 : -.03; ps.y[i] = 0;
      ps.vx[i] = 0; ps.vy[i] = i ? -1 : 1;
      ps.viscosity[i] = viscosity; ps.powderContent[i] = powderContent;
    }
    b.step();
    const result = Math.abs(ps.vy[1] - ps.vy[0]); b.dispose();
    return result;
  };
  const thin = relativeSpeed(.01), thick = relativeSpeed(.98), dough = relativeSpeed(.01, .5);
  assert.ok(thick < thin - .005, `viscosity must affect motion: ${thick} vs ${thin}`);
  assert.ok(dough < thick - .1, `wet dough must resist shear more than a liquid: ${dough} vs ${thick}`);
});

test('partial bottling reduces native fluid area without losing recipe parcels', () => {
  const b = brew(), ps = b.engine.ps, backend = b.engine.liquidFun;
  b.pour(1, 60, { 1: 100 }); b.step();
  const radius = backend.system.radius;
  b.bottle(30); b.step();
  assert.equal(nativeCount(backend), 240);
  assert.ok(Math.abs(backend.system.radius - radius * Math.sqrt(.5)) < .00001);
  assert.ok(Math.abs(b.occupiedVolume - 30) < .001);
  b.dispose();
});

test('a falling native liquid cannot overlap a resting powder grain on the bowl floor', () => {
  const b = brew(), ps = b.engine.ps;
  b.pour(1, 1, { 1: 10 }); ps.count = 2;
  ps.x[0] = ps.x[1] = 0; ps.y[0] = -.95;
  ps.y[1] = -1.2 + cauldronParticlePadding(ps, 1);
  ps.vy[0] = -7; ps.vy[1] = 0;
  ps.setPhase(1, Phase.SOLID); ps.solidSubdivision[1] = ps.powderContent[1] = ps.grainRest[1] = 1;
  ps.meltingTemperature[1] = .9; ps.miscibility[1] = .95; ps.materialId[1] = 2;
  b.step();
  assert.ok(Math.hypot(ps.x[0]-ps.x[1],ps.y[0]-ps.y[1]) >= particlePairRestDistance(ps,0,1,true) * .95);
  assert.ok(ps.y[0] > ps.y[1], 'falling water must remain above the supporting grain');
  b.dispose();
});

test('an inverted immiscible heavy layer sinks through the lighter native fluid', () => {
  const b = new BrewingSession(generateLiquidWorld('native-density').ingredients);
  b.engine.liquidFun = new LiquidFunFluid(runtime);
  b.pour(1, 30, { 1: 100 }); b.pour(5, 30, { 5: 100 });
  const ps = b.engine.ps;
  for (let i = 0; i < ps.count; i++) {
    ps.x[i] = -.72 + (i % 20) * .072; ps.y[i] = -1 + Math.floor(i / 20) * .072;
    ps.vx[i] = ps.vy[i] = 0;
    ps.reactionPotential[i] = 0; ps.boilingTemperature[i] = 1.2;
  }
  for (let tick = 0; tick < 600; tick++) b.step();
  const mean = id => {
    let sum = 0, count = 0;
    for (let i = 0; i < ps.count; i++) if (ps.materialId[i] === id) { sum += ps.y[i]; count++; }
    return sum / count;
  };
  assert.ok(mean(5) < mean(1) - .03, `heavy layer must sink: heavy ${mean(5)}, light ${mean(1)}`);
  b.dispose();
});

test('full cauldrons and repeated phase changes keep native buffers finite and conserve the recipe', () => {
  const b = brew(); b.equipment.cauldron = 2;
  b.pour(1, 440, { 1: 500 });
  const ps = b.engine.ps, backend = b.engine.liquidFun, mass = ps.totalMass();
  for (let tick = 0; tick < 200; tick++) { b.assistStir(); b.step(); }
  assert.equal(nativeCount(backend), 1760);
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let i = 0; i < ps.count; i++) {
      ps.setPhase(i, i % 3 ? Phase.LIQUID : Phase.GAS);
      ps.temperature[i] = i % 3 ? .33 : .9;
      ps.boilingTemperature[i] = i % 3 ? 1.2 : .5;
    }
    b.step(); assert.equal(nativeCount(backend), 1173);
    for (let i = 0; i < ps.count; i++) {
      ps.setPhase(i, Phase.LIQUID); ps.temperature[i] = .33; ps.boilingTemperature[i] = 1.2;
    }
    b.step(); assert.equal(nativeCount(backend), 1760);
  }
  for (let i = 0; i < ps.count; i++) {
    assert.ok(Number.isFinite(ps.x[i]) && Number.isFinite(ps.y[i]) && Number.isFinite(ps.vy[i]));
    assert.ok(insideCauldron(ps.x[i], ps.y[i], cauldronParticlePadding(ps, i)));
  }
  assert.equal(ps.totalMass(), mass); assert.equal(b.occupiedVolume, 440);
  b.clean(); b.step(); assert.equal(nativeCount(backend), 0);
  b.pour(1, 5, { 1: 10 }); b.step(); assert.equal(nativeCount(backend), 20);
  b.dispose();
});

test('witness simulations and replaced sessions release their native worlds', () => {
  // Prove disposal actually calls the C++ destructor and frees wrapper scratch
  // buffers, including when a private order trial throws during initialization.
  const realDelete = runtime.Module._b2World_Delete, realFree = runtime.Module._free;
  let deleted = 0, freed = 0;
  runtime.Module._b2World_Delete = pointer => { deleted++; realDelete(pointer); };
  runtime.Module._free = pointer => { freed++; realFree(pointer); };
  try {
    const b = brew(), backend = b.engine.liquidFun;
    b.pour(1, 10, { 1: 100 }); b.step();
    const before = deleted; b.dispose(); b.dispose();
    assert.equal(deleted, before + 1); assert.ok(freed >= 2);
    assert.throws(() => backend.step(b.engine.ps, .025, { x: 0, y: -4.5 }), /disposed/);
    let disposals = 0;
    const realDispose = BrewingSession.prototype.dispose;
    BrewingSession.prototype.dispose = function () { disposals++; realDispose.call(this); };
    try {
      const world = generateWorld('native-witness');
      assert.ok(simulateWitness(world, { portions: [{ ingredientId: 1, ml: 5 }], ticks: 4, volume: 5 }));
      assert.throws(() => simulateWitness(world, { portions: null, ticks: 0, volume: 5 }));
      assert.equal(disposals, 2);
    } finally { BrewingSession.prototype.dispose = realDispose; }
  } finally {
    runtime.Module._b2World_Delete = realDelete; runtime.Module._free = realFree;
  }
});
