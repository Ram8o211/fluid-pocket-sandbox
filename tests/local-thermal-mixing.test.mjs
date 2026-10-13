import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';
import { SpatialGrid } from '../src/simulation/SpatialGrid.mjs';
import { updateThermal } from '../src/simulation/ThermalSolver.mjs';
import { CombustionSolver } from '../src/simulation/CombustionSolver.mjs';
import { DEFAULT_RULES } from '../src/simulation/SimulationEngine.mjs';
import { Phase } from '../src/simulation/Phase.mjs';
import { ReactionEngine } from '../src/reactions/ReactionEngine.mjs';
import { MixtureSolver, MIX_PROPERTIES } from '../src/reactions/MixtureSolver.mjs';
import { BrewingSession } from '../src/game/brewing.mjs';
import { sanitizeMaterial } from '../src/materials/MaterialDefinition.mjs';
import { cauldronParticlePadding } from '../src/game/cauldron.mjs';

const close = (a, b, tolerance = .0001) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const material = overrides => sanitizeMaterial({ id: 1, color: '#000000', density: 1, heatCapacity: .6, thermalConductivity: 1, viscosity: .2, miscibility: .45, meltingTemperature: .12, boilingTemperature: .65, phaseTransitionHysteresis: .01, combustionTemperature: 1.4, reactionPotential: 0, reactionHeat: 0, electricPotential: 0, ...overrides });
const ingredients = [material({}), material({ id: 2, color: '#ffffff', viscosity: .8, miscibility: .5, phaseTransitionHysteresis: .03 })].map(m => ({ id: m.id, material: m, price: .1 }));
const box = { width: 5.6, height: 3.2, depth: 3 };
const rules = { ...DEFAULT_RULES, interactionRadiusScale: .5, thermalDiffusionRate: 1.2, condensationCoolingCoefficient: 0, canonicalizationDistance: 1 };

test('both thermal sources reach bottom contacts first, never remote parcels directly', () => {
  for (const [heat, cold, sign] of [[1, 0, 1], [0, 1, -1]]) {
    const brew = new BrewingSession(ingredients), ps = brew.engine.ps;
    ps.add({ x: 0, y: 0, z: 0, mass: .25, temperature: .33 }, ingredients[0].material);
    ps.add({ x: 0, y: .5, z: 0, mass: .25, temperature: .33 }, ingredients[0].material);
    ps.y[0] = -1.2 + cauldronParticlePadding(ps, 0);
    brew.setThermal(heat, cold);
    brew.thermal.step(ps, (heat * 3.2 - cold * 3.8), .025);
    assert.ok((ps.temperature[0] - .33) * sign > .001);
    close(ps.temperature[1], .33);
  }
});

test('thermal transport advances one neighbourhood per tick and conserves energy regardless of pair order', () => {
  const results = [];
  for (const reverse of [false, true]) {
    const ps = new ParticleSystem(3), m = material({});
    for (let i = 0; i < 3; i++) ps.add({ x: i * .2, y: 0, z: 0, mass: i + 1, temperature: i === 0 ? 1 : .33 }, m);
    const pairs = reverse ? [[1, 2], [0, 1]] : [[0, 1], [1, 2]];
    const grid = { forEachPair(_ps, _radius, callback) { for (const [i, j] of pairs) callback(i, j); } };
    const energy = () => Array.from({ length: ps.count }, (_, i) => ps.temperature[i] * ps.mass[i] * ps.heatCapacity[i]).reduce((a, b) => a + b);
    const before = energy();
    updateThermal(ps, grid, rules, { ambientTemperature: .33, ambientThermalExchange: 0 }, .025);
    assert.ok(ps.temperature[1] > .33); close(ps.temperature[2], .33);
    close(energy(), before); results.push([...ps.temperature]);
    updateThermal(ps, grid, rules, { ambientTemperature: .33, ambientThermalExchange: 0 }, .025);
    assert.ok(ps.temperature[2] > .33); close(energy(), before);
  }
  assert.deepEqual(results[0], results[1]);
});

test('boiling/freezing are staggered, a continuously heated sealed pot equilibrates and stops condensing', () => {
  const brew = new BrewingSession(ingredients); brew.engine.rules.combustionRate = brew.engine.rules.combustionHeatScale = 0;
  brew.pour(1, 20, { 1: 30 }); brew.setThermal(1);
  let firstBoil = 0;
  for (let i = 0; i < 700; i++) { brew.step(); if (!firstBoil && brew.vaporVolume) firstBoil = brew.vaporVolume; }
  assert.ok(firstBoil > 0 && firstBoil < 20, `First boiling front = ${firstBoil} ml`);
  close(brew.vaporVolume, 20);
  const temperatures = [...brew.engine.ps.temperature.subarray(0, brew.engine.ps.count)];
  assert.ok(Math.max(...temperatures) - Math.min(...temperatures) < .02);
  assert.ok(Math.min(...temperatures) > .66 && brew.thermal.lid > .66);
  const condensed = brew.history.condensed;
  for (let i = 0; i < 100; i++) { brew.step(); close(brew.vaporVolume, 20); }
  close(brew.history.condensed, condensed);
  brew.setThermal(0, 1); let firstFrozen = 0;
  for (let i = 0; i < 1000; i++) { brew.step(); const solids = brew.engine.ps.phaseCounts()[Phase.SOLID]; if (!firstFrozen && solids) firstFrozen = solids; }
  assert.ok(firstFrozen > 0 && firstFrozen < brew.engine.ps.count);
  assert.equal(brew.engine.ps.phaseCounts()[Phase.SOLID], brew.engine.ps.count);
});

test('combustion heats immediate neighbours before those neighbours ignite on the following tick', () => {
  const ps = new ParticleSystem(8), grid = new SpatialGrid(8), solver = new CombustionSolver();
  const m = material({ combustionTemperature: .6, volatility: 1, heatCapacity: 1 });
  for (let i = 0; i < 3; i++) ps.add({ x: i * .2, y: 0, z: 0, mass: 1, temperature: i === 0 ? .601 : .5999 }, m);
  grid.setDimensionMode('2D'); grid.rebuild(ps, box);
  const step = () => solver.step(ps, grid, new Map([[m.id, m]]), rules, { dimensionMode: '2D' }, .025, () => []);
  step(); assert.ok(ps.combustionProgress[0] > 0); assert.equal(ps.combustionProgress[1], 0); assert.equal(ps.combustionProgress[2], 0);
  assert.ok(ps.temperature[1] > .6); close(ps.temperature[2], .5999);
  step(); assert.ok(ps.combustionProgress[1] > 0); assert.equal(ps.combustionProgress[2], 0);
  assert.ok(ps.temperature[2] > .5999);
});

test('local diffusion conserves 20/80 measured proportions and stirring homogenizes unequal-density ingredients', () => {
  const ps = new ParticleSystem(10), grid = new SpatialGrid(10), reactions = new ReactionEngine(); reactions.mixtures = new MixtureSolver();
  const a = material({ density: .5 }), b = material({ ...ingredients[1].material, density: 1.5 });
  for (let i = 0; i < 10; i++) { const m = i < 2 ? a : b; ps.add({ x: i < 2 ? -1.5 : 1.5, y: 0, z: 0, mass: m.density, temperature: .33 }, m); }
  const expected = MIX_PROPERTIES.map(key => ps[key][0] * .2 + ps[key][2] * .8);
  ps.x[1] = 0; ps.x[2] = .1;
  grid.setDimensionMode('2D'); grid.rebuild(ps, box); reactions.step(ps, grid, rules, .025);
  assert.ok(ps.r[1] > 0 && ps.r[1] < .8); assert.ok(ps.r[2] < 1 && ps.r[2] > .8);
  assert.equal(ps.r[0], 0); assert.equal(ps.r[9], 1); // Remote stock has a target but no contact activation.
  assert.equal(ps.materialId[1], ps.materialId[2]); // Canonicalization must not stop homogenization.
  for (let i = 0; i < 10; i++) ps.x[i] = -.8 + i * .18;
  grid.rebuild(ps, box);
  for (let frame = 0; frame < 1200; frame++) { ps.stirActivity.fill(1); reactions.step(ps, grid, rules, .025); }
  for (let i = 0; i < ps.count; i++) for (let k = 0; k < MIX_PROPERTIES.length; k++) close(ps[MIX_PROPERTIES[k]][i], expected[k], .002);
  close(ps.r[0], .8, .002); close(ps.baseDensity[0], 1.3, .002); close(ps.totalMass(), 13);
  close([...ps.mass].reduce((v, m, i) => v + m / ps.density[i], 0), 10, .002);
});

test('an incompatible source cannot enter a mixture through an intermediate affinity', () => {
  const ps = new ParticleSystem(3), grid = new SpatialGrid(3), reactions = new ReactionEngine(); reactions.mixtures = new MixtureSolver();
  const materials = [...ingredients.map(i => i.material), material({ id: 3, color: '#ff00ff', miscibility: .6, viscosity: .95 })];
  for (let i = 0; i < 3; i++) ps.add({ x: i === 2 ? 1.5 : i * .1, y: 0, z: 0, mass: 1, temperature: .33 }, materials[i]);
  grid.setDimensionMode('2D'); grid.rebuild(ps, box); reactions.step(ps, grid, rules, .025);
  const incompatible = MIX_PROPERTIES.map(key => ps[key][2]); ps.x[2] = .2; grid.rebuild(ps, box);
  for (let frame = 0; frame < 300; frame++) reactions.step(ps, grid, rules, .025);
  for (let k = 0; k < MIX_PROPERTIES.length; k++) close(ps[MIX_PROPERTIES[k]][2], incompatible[k]);
  assert.equal(ps.mixtureProgress[2], 0); assert.notEqual(ps.mixtureGroup[0], ps.mixtureGroup[2]);
});

test('partial mixing, weighted targets, and warm copper survive reload, bottling and a new pour', () => {
  const brew = new BrewingSession(ingredients); brew.pour(1, 2, { 1: 10 }); brew.pour(2, 8, { 2: 20 });
  for (let i = 0; i < 200; i++) { brew.assistStir(); brew.step(); }
  const saved = brew.snapshot(), restored = new BrewingSession(ingredients); restored.restore(saved);
  assert.deepEqual(restored.thermal.snapshot(), saved.thermal); assert.deepEqual(restored.engine.reactions.mixtures.snapshot(), saved.mixtures);
  for (let i = 0; i < 600; i++) { restored.assistStir(); restored.step(); }
  restored.bottle(5); restored.pour(2, 5, { 2: 10 });
  for (let i = 0; i < 800; i++) { restored.assistStir(); restored.step(); }
  const ps = restored.engine.ps;
  for (let i = 0; i < ps.count; i++) close(ps.r[i], .9, .003);
  close(ps.totalMass(), 10); close(restored.liquidVolume, 10);
  const legacy = brew.snapshot(); delete legacy.thermal; delete legacy.mixtures; delete legacy.particles.mixtureGroup; delete legacy.particles.mixtureProgress; delete legacy.particles.mixtureAmount;
  const upgraded = new BrewingSession(ingredients); upgraded.restore(legacy);
  close(upgraded.engine.ps.totalMass(), brew.engine.ps.totalMass()); upgraded.step();
});
