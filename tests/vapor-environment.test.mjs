import test from 'node:test';
import assert from 'node:assert/strict';
import { BrewingSession } from '../src/game/brewing.mjs';
import { ROOM_DENSITY, ROOM_TEMPERATURE, FIXED_STEP } from '../src/game/contracts.mjs';
import { sanitizeMaterial } from '../src/materials/MaterialDefinition.mjs';
import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';
import { SpatialGrid } from '../src/simulation/SpatialGrid.mjs';
import { updateGasDensity } from '../src/simulation/GasDensitySolver.mjs';
import { applyBuoyancy } from '../src/simulation/BuoyancySolver.mjs';
import { Phase } from '../src/simulation/Phase.mjs';
import { FluidSolver } from '../src/simulation/FluidSolver.mjs';
import { insideCauldron, cauldronParticlePadding, PARTICLE_ML } from '../src/game/cauldron.mjs';

const close = (a, b, tolerance = .0001) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const material = overrides => sanitizeMaterial({ id: 1, density: 1, heatCapacity: .6, thermalConductivity: 1, viscosity: .2, miscibility: .4, meltingTemperature: .05, boilingTemperature: .65, phaseTransitionHysteresis: .01, combustionTemperature: 1.4, reactionPotential: 0, reactionHeat: 0, electricPotential: 0, ...overrides });
const ingredients = [material({ density: .65, color: '#ff2200' }), material({ id: 2, density: 1.65, color: '#0044ff', miscibility: .9 })].map(m => ({ id: m.id, material: m, price: .1 }));
const setup = () => {
  const brew = new BrewingSession(ingredients);
  brew.engine.rules.combustionRate = brew.engine.rules.combustionHeatScale = 0;
  return brew;
};
const ticks = (brew, count) => { for (let i = 0; i < count; i++) brew.step(); };

test('gas flow entrains nearby vapour, conserves contact momentum and dissipates relative energy', () => {
  const brew = setup(), ps = brew.engine.ps, solver = new FluidSolver();
  brew.pour(1, 2, { 1: 10 }); ps.count = 3;
  ps.setPhase(0, Phase.GAS); ps.setPhase(1, Phase.LIQUID); ps.setPhase(2, Phase.GAS);
  ps.vx.set([0, 2, 0]); ps.vy.fill(0);
  const m0 = ps.mass[0] * ps.density[0] / ps.baseDensity[0], m1 = ps.mass[1];
  const momentum = () => ps.vx[0] * m0 + ps.vx[1] * m1;
  const energy = () => ps.vx[0] ** 2 * m0 + ps.vx[1] ** 2 * m1;
  const beforeMomentum = momentum(), beforeEnergy = energy(), mass = ps.totalMass();
  solver.exchangeGasFlow(ps, 0, 1, .06, FIXED_STEP, true, 2.5);
  assert.ok(ps.vx[0] > .01 && ps.vx[1] < 2, 'a liquid current must entrain adjacent steam');
  close(momentum(), beforeMomentum); assert.ok(energy() < beforeEnergy);
  solver.exchangeGasFlow(ps, 0, 2, 1.5, FIXED_STEP, true, 2.5);
  assert.equal(ps.vx[2], 0, 'remote steam cannot inherit the current');
  close(ps.totalMass(), mass);
});

test('a swept spoon moves local steam and reload retains its phase, quantity and magical fields', () => {
  const brew = setup(), ps = brew.engine.ps;
  brew.pour(1, 3, { 1: 10 });
  for (let i = 0; i < ps.count; i++) {
    ps.setPhase(i, Phase.GAS); ps.temperature[i] = .95;
    ps.x[i] = -1.5 + i * .6; ps.y[i] = .5; ps.vx[i] = ps.vy[i] = 0;
    ps.poison[i] = .3;
  }
  const mass = ps.totalMass();
  assert.equal(brew.stir({ x: .5, y: .5 }, { x: 4, y: 0 }, FIXED_STEP, { x: -.5, y: .5 }), 4);
  assert.equal(ps.vx[0], 0); assert.equal(ps.vx[5], 0);
  for (let i = 1; i <= 4; i++) assert.ok(ps.vx[i] > .05);
  close(ps.totalMass(), mass);
  const restored = setup(); restored.restore(brew.snapshot());
  assert.equal(restored.engine.ps.phaseCounts()[Phase.GAS], ps.count);
  assert.deepEqual(Array.from(restored.engine.ps.poison.subarray(0, ps.count)), Array.from(ps.poison.subarray(0, ps.count)));
  close(restored.engine.ps.totalMass(), mass);
});

test('the empty-atmosphere reference stays fixed and crowding never removes density-dependent gas lift', () => {
  const brew = setup(), ps = brew.engine.ps, env = brew.engine.env;
  const reference = env.environmentDensity;
  brew.pour(1, 1, { 1: 10 }); brew.pour(2, 1, { 2: 10 });
  assert.equal(reference, ROOM_DENSITY); assert.equal(env.environmentDensity, reference);
  const gains = [];
  for (const index of [0, 1 / PARTICLE_ML]) {
    ps.setPhase(index, Phase.GAS);
    for (const concentration of [.1, 100]) {
      ps.localGasDensity[index] = concentration; ps.vx[index] = ps.vy[index] = 0;
      applyBuoyancy(ps, index, brew.engine.gravity, env, FIXED_STEP);
      assert.ok(ps.vy[index] > 0); gains.push(ps.vy[index]);
    }
  }
  close(gains[0], gains[1]); close(gains[2], gains[3]);
  assert.ok(gains[0] > gains[2], 'Lighter vapour must retain stronger lift');
  for (const m of ingredients) {
    const density = ps.effectiveDensity(material({ density: m.material.density, compressibility: .1 }), Phase.GAS);
    assert.ok(density < reference, 'Even the densest supported vapour remains buoyant');
  }
  ps.vy[1] = 0; applyBuoyancy(ps, 1, brew.engine.gravity, env, FIXED_STEP);
  assert.equal(ps.vy[1], 0); // Liquid gravity/stratification has a separate path.
  ticks(brew, 200);
  for (let i = 0; i < ps.count; i++) close(ps.baseDensity[i], i < 1 / PARTICLE_ML ? .65 : 1.65);
  assert.equal(env.environmentDensity, reference); // Incompatible fluids do not homogenize.
});

test('hot vapour rises, accumulates beneath the lid and increases local concentration without mass loss', () => {
  const brew = setup(), engine = brew.engine, ps = engine.ps;
  brew.pour(1, 20, { 1: 30 });
  engine.rules.thermalDiffusionRate = 0; engine.env.ambientThermalExchange = 0;
  for (let i = 0; i < ps.count; i++) {
    ps.setPhase(i, Phase.GAS); ps.temperature[i] = .95;
    ps.x[i] = (i % 10 - 4.5) * .29; ps.y[i] = -.75 + Math.floor(i / 10) * .17;
    ps.vx[i] = ps.vy[i] = 0;
  }
  const mass = ps.totalMass(); engine.step(FIXED_STEP);
  const initialPeak = Math.max(...ps.localGasDensity.subarray(0, ps.count));
  for (let i = 0; i < 199; i++) engine.step(FIXED_STEP);
  const meanHeight = [...ps.y.subarray(0, ps.count)].reduce((a, b) => a + b) / ps.count;
  assert.ok(meanHeight > .5, `Vapour is suspended too far below the lid: ${meanHeight}`);
  assert.ok(Math.max(...ps.localGasDensity.subarray(0, ps.count)) > initialPeak * 1.25);
  assert.equal(ps.phaseCounts()[Phase.GAS], ps.count); close(ps.totalMass(), mass);
  for (let i = 0; i < ps.count; i++) assert.ok(insideCauldron(ps.x[i], ps.y[i], cauldronParticlePadding(ps, i)));
});

test('equal-temperature gas condenses only in the compressed cool patch, and a compressed hot patch stays gas', () => {
  const brew = setup(), engine = brew.engine, ps = engine.ps, m = material({ volatility: 1 });
  // Freeze transport to isolate three separated spatial patches; phase changes
  // still run through the complete engine using the current local density field.
  engine.iterations = 0; engine.env.gasThermalMotion = 0; engine.gravity = { x: 0, y: 0, z: 0 };
  engine.rules.thermalDiffusionRate = 0; engine.env.ambientThermalExchange = 0;
  for (let i = 0; i < 9; i++) ps.add({ x: i < 4 ? -.8 + i * .01 : i < 8 ? .5 + (i - 4) * .01 : 1.5, y: 0, z: 0, mass: .25, temperature: i < 4 || i === 8 ? .60 : .95 }, m, Phase.GAS);
  const mass = ps.totalMass();
  for (let i = 0; i < 35; i++) engine.step(FIXED_STEP);
  assert.deepEqual([...ps.phase.subarray(0, 4)], [Phase.LIQUID, Phase.LIQUID, Phase.LIQUID, Phase.LIQUID]);
  assert.deepEqual([...ps.phase.subarray(4, 9)], [Phase.GAS, Phase.GAS, Phase.GAS, Phase.GAS, Phase.GAS]);
  close(ps.totalMass(), mass); close(ps.density[0], ps.baseDensity[0]);
  assert.equal(ps.phaseProgress[8], 0); // Equally cool but too dilute.
});

test('expanding a partly condensing patch removes saturation and cancels its unfinished transition', () => {
  const brew = setup(), engine = brew.engine, ps = engine.ps, m = material({ volatility: 1 });
  engine.iterations = 0; engine.env.gasThermalMotion = 0; engine.gravity = { x: 0, y: 0, z: 0 };
  engine.rules.thermalDiffusionRate = 0; engine.env.ambientThermalExchange = 0;
  for (let i = 0; i < 4; i++) ps.add({ x: i * .01, y: 0, z: 0, mass: .25, temperature: .6 }, m, Phase.GAS);
  for (let i = 0; i < 8; i++) engine.step(FIXED_STEP);
  assert.ok(ps.phaseProgress[0] > 0 && ps.phaseProgress[0] < 1);
  for (let i = 0; i < 4; i++) ps.x[i] = -1.2 + i * .8;
  for (let i = 0; i < 40; i++) engine.step(FIXED_STEP);
  assert.equal(ps.phaseCounts()[Phase.GAS], 4); close(ps.phaseProgress[0], 0);
});

test('fractional parcel refinement preserves concentration and a remote gas patch cannot contribute', () => {
  const m = material({}), rules = { interactionRadiusScale: .5 }, env = { dimensionMode: '2D' };
  const concentration = split => {
    const ps = new ParticleSystem(8), grid = new SpatialGrid(8);
    for (let i = 0; i < split; i++) ps.add({ x: 0, y: 0, z: 0, mass: 1 / split }, m, Phase.GAS);
    ps.add({ x: 1.8, y: 0, z: 0, mass: 10 }, m, Phase.GAS);
    grid.setDimensionMode('2D'); grid.rebuild(ps, { width: 5.6, height: 3.2, depth: 3 });
    updateGasDensity(ps, grid, rules, env); return ps.localGasDensity[0];
  };
  close(concentration(1), concentration(4));
});

test('idle hot and cold contents approach room gradually without source energy costs, including after reload', () => {
  for (const temperature of [.85, .12]) {
    const source = setup(); source.pour(1, 10, { 1: 20 });
    const ps = source.engine.ps;
    ps.temperature.fill(temperature, 0, ps.count); source.thermal.floor = source.thermal.lid = temperature;
    const saved = source.snapshot(), brew = setup(); brew.restore(saved);
    const mass = brew.engine.ps.totalMass(), cost = { ...brew.cost };
    brew.step();
    assert.ok(Math.abs(brew.engine.ps.temperature[0] - temperature) < .02, 'Passive exchange must not reset the entire brew');
    ticks(brew, 1599);
    for (const t of brew.engine.ps.temperature.subarray(0, brew.engine.ps.count)) assert.ok(Math.abs(t - ROOM_TEMPERATURE) < .025, `Idle parcel remains at ${t}`);
    assert.ok(Math.abs(brew.thermal.floor - ROOM_TEMPERATURE) < .025);
    assert.ok(Math.abs(brew.thermal.lid - ROOM_TEMPERATURE) < .025);
    close(brew.engine.ps.totalMass(), mass); assert.deepEqual(brew.cost, cost);
    assert.equal(brew.history.heatEnergy, 0); assert.equal(brew.history.coldEnergy, 0);
  }
});

test('a tiny dilute vapour remainder eventually condenses passively and empty copper also returns to room', () => {
  const brew = setup(), ps = brew.engine.ps;
  brew.pour(1, 1, { 1: 2 }); ps.count = 1; ps.mass[0] = .001; ps.mixtureAmount[0] = ps.mass[0] / ps.baseDensity[0];
  ps.setPhase(0, Phase.GAS); ps.temperature[0] = .6; ps.vx[0] = ps.vy[0] = 0;
  const mass = ps.totalMass(); ticks(brew, 1800);
  assert.equal(ps.phase[0], Phase.LIQUID); close(ps.totalMass(), mass);
  const empty = setup(); empty.thermal.floor = .85; empty.thermal.lid = .12;
  ticks(empty, 600);
  close(empty.thermal.floor, ROOM_TEMPERATURE, .002); close(empty.thermal.lid, ROOM_TEMPERATURE, .002);
  assert.equal(empty.engine.ps.count, 0); assert.equal(empty.cost.energy, 0);
});

test('separated gas parcels do not repel across the neighbour radius, while close contacts stay soft', () => {
  for (const separation of [.25, .02]) {
    const brew = setup(), e = brew.engine, ps = e.ps;
    e.gravity = { x: 0, y: 0, z: 0 }; e.env.gasThermalMotion=0; e.rules.thermalDiffusionRate = 0; e.env.ambientThermalExchange = 0;
    for (const x of [-separation / 2, separation / 2]) ps.add({ x, y: 0, z: 0, mass: .25, temperature: .95 }, material({}), Phase.GAS);
    e.step(FIXED_STEP);
    const distance = ps.x[1] - ps.x[0];
    if (separation === .25) close(distance, separation);
    else { assert.ok(distance > separation); assert.ok(distance < separation + .045, 'Contact must not explosively spread gas'); }
    assert.ok(Math.abs(ps.vx[0]) < .25, 'Contact correction must not launch vapour sideways');
  }
});
