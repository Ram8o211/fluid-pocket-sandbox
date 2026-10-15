import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMaterial, EFFECT_PROPERTIES, weightedMaterialMean } from '../src/materials/MaterialDefinition.mjs';
import { sampleParticleSet } from '../src/materials/MaterialSampler.mjs';
import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';
import { SpatialGrid } from '../src/simulation/SpatialGrid.mjs';
import { ReactionEngine } from '../src/reactions/ReactionEngine.mjs';
import { MixtureSolver, MIX_PROPERTIES } from '../src/reactions/MixtureSolver.mjs';
import { DEFAULT_RULES } from '../src/simulation/SimulationEngine.mjs';
import { BrewingSession } from '../src/game/brewing.mjs';
import { assessEffects, readEffects } from '../src/game/effects.mjs';
import { assessPotion } from '../src/game/evaluation.mjs';

const close = (a, b, tolerance = .0001) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const material = overrides => sanitizeMaterial({ id: 1, color: '#8bd6bc', density: 1, viscosity: .2, miscibility: .45, meltingTemperature: .1, boilingTemperature: .95, combustionTemperature: 1.4, reactionPotential: 0, reactionHeat: 0, electricPotential: 0, ...overrides });
const ingredients = [material({ strength: .9, love: .3, acidity: .6 }), material({ id: 2 })].map(m => ({ id: m.id, material: m, price: .01, form: 'liquid' }));

test('effect concentrations are bounded and absent channels stay inert', () => {
  for (const key of EFFECT_PROPERTIES) assert.equal(material({})[key], 0);
  const m = material({ strength: 5, love: -1, poison: NaN, acidity: Infinity });
  assert.equal(m.strength, 1); assert.equal(m.love, 0); assert.equal(m.poison, 0); assert.equal(m.acidity, 0);
  assert.deepEqual(readEffects({ effects: { fire: 3, freeze: -.2 } }), { strength: 0, love: 0, death: 0, transformation: 0, fire: 1, freeze: 0, acidity: 0, poison: 0 });
});

test('weighted material and exact fractional particle samples share all effect fields', () => {
  const a = material({ strength: 1, fire: .8, poison: .6 }), b = material({ id: 2 });
  const mean = weightedMaterialMean(a, b, 1, 3, 3), ps = new ParticleSystem(2);
  ps.add({ x: 0, y: 0, z: 0, mass: 2 }, a); ps.add({ x: .1, y: 0, z: 0, mass: 3 }, b);
  const sample = sampleParticleSet(ps, [{ index: 0, weight: .5 }, { index: 1, weight: 1 }]);
  for (const key of EFFECT_PROPERTIES) close(sample.material[key], mean[key]);
  close(sample.material.strength, .25); close(sample.material.fire, .2); close(sample.material.poison, .15);
});

test('local contact diffusion dilutes magic and chemistry in the measured physical proportions', () => {
  const ps = new ParticleSystem(2), reactions = new ReactionEngine(); reactions.mixtures = new MixtureSolver();
  ps.add({ x: 0, y: 0, z: 0, mass: 1 }, material({ strength: 1, freeze: .8, acidity: .6, poison: .4 }));
  ps.add({ x: .1, y: 0, z: 0, mass: 3 }, material({ id: 2 }));
  const initial = EFFECT_PROPERTIES.map(key => ps[key][0] / 4), totalMass = ps.totalMass();
  const grid = { forEachPair(_ps, _radius, callback) { callback(0, 1); } };
  for (let frame = 0; frame < 650; frame++) reactions.step(ps, grid, DEFAULT_RULES, .025);
  for (let i = 0; i < ps.count; i++) for (let key = 0; key < EFFECT_PROPERTIES.length; key++) close(ps[EFFECT_PROPERTIES[key]][i], initial[key], .001);
  close(ps.totalMass(), totalMass);
});

test('effect-only differences advance one neighbourhood per tick and stop across a gap', () => {
  const ps = new ParticleSystem(4), grid = new SpatialGrid(4), reactions = new ReactionEngine(); reactions.mixtures = new MixtureSolver();
  const source = Object.fromEntries(EFFECT_PROPERTIES.map((key, index) => [key, 1 - index * .1]));
  for (let i = 0; i < 4; i++) ps.add({ x: i * .09, y: 0, z: 0, mass: .25 }, material({ particleRadius: .1, ...(i === 0 ? source : {}) }));
  grid.setDimensionMode('2D'); grid.rebuild(ps, { width: 5, height: 5, depth: 3 });
  const rules = { ...DEFAULT_RULES, interactionRadiusScale: .5, canonicalizationDistance: 0 };
  reactions.step(ps, grid, rules, .025);
  for (const key of EFFECT_PROPERTIES) { assert.ok(ps[key][1] > 0); assert.equal(ps[key][2], 0); assert.equal(ps[key][3], 0); }
  reactions.step(ps, grid, rules, .025);
  for (const key of EFFECT_PROPERTIES) { assert.ok(ps[key][2] > 0); assert.equal(ps[key][3], 0); }
  for (let i = 0; i < 4; i++) ps.x[i] = -1.5 + i;
  grid.rebuild(ps, { width: 5, height: 5, depth: 3 }); ps.temperature.fill(.7);
  const before = EFFECT_PROPERTIES.map(key => Array.from(ps[key]));
  for (let frame = 0; frame < 100; frame++) reactions.step(ps, grid, { ...rules, mixingTemperatureCoefficient: 3.5 }, .025);
  assert.deepEqual(EFFECT_PROPERTIES.map(key => Array.from(ps[key])), before);
});

test('high-degree stirred contacts conserve all eight channels and remain bounded independent of pair order', () => {
  const results = [];
  for (const reverse of [false, true]) {
    const ps = new ParticleSystem(6), reactions = new ReactionEngine(); reactions.mixtures = new MixtureSolver();
    const effects = Object.fromEntries(EFFECT_PROPERTIES.map((key, index) => [key, 1 - index * .1]));
    ps.add({ x: 0, y: 0, z: 0, mass: .125 }, material({ density: .5, particleRadius: .1, ...effects }));
    for (let i = 1; i < 6; i++) ps.add({ x: .06, y: 0, z: 0, mass: .2 + i * .1 }, material({ id: 2, density: 1.5, particleRadius: .1 }));
    const pairs = Array.from({ length: 5 }, (_, i) => [0, i + 1]); if (reverse) pairs.reverse();
    const grid = { dimensionMode: '2D', forEachPair(_ps, _radius, callback) { for (const [i, j] of pairs) callback(i, j); } };
    const amount = key => Array.from(ps[key]).reduce((total, value, i) => total + value * ps.mixtureAmount[i], 0);
    const before = EFFECT_PROPERTIES.map(amount); ps.stirActivity.fill(1);
    reactions.step(ps, grid, DEFAULT_RULES, .2);
    for (let i = 0; i < EFFECT_PROPERTIES.length; i++) {
      close(amount(EFFECT_PROPERTIES[i]), before[i]);
      assert.ok(Array.from(ps[EFFECT_PROPERTIES[i]]).every(value => value >= 0 && value <= 1));
    }
    results.push(EFFECT_PROPERTIES.map(key => Array.from(ps[key])));
  }
  assert.deepEqual(results[0], results[1]);
});

test('particle reassignment and compact removal retain every effect channel', () => {
  const ps = new ParticleSystem(3), neutral = material({}), magic = material({ id: 2, transformation: .8, poison: .4 });
  ps.add({ x: 0, y: 0, z: 0 }, neutral); ps.add({ x: .1, y: 0, z: 0 }, magic);
  ps.removeAt(0); close(ps.transformation[0], .8); close(ps.poison[0], .4);
  ps.assignMaterial(0, neutral);
  for (const key of EFFECT_PROPERTIES) assert.equal(ps[key][0], 0);
});

test('bottles expose actual concentrations to commission assessment and preserve a partial drain', () => {
  const brew = new BrewingSession(ingredients); brew.pour(1, 3, { 1: 10 });
  const vial = brew.bottle(1), remaining = brew.inspect();
  for (const key of EFFECT_PROPERTIES) { close(vial[key], ingredients[0].material[key]); close(remaining[key], vial[key]); close(vial.effects[key], vial[key]); }
  const order = { volume: 1, requirements: [{ property: 'strength', target: .9, tolerance: .05, weight: 1, hard: true }] };
  assert.equal(assessPotion(vial, order).quality, 100);
  assert.equal(assessPotion({ ...vial, volume: 1 - 1e-7 }, order).quality, 100, 'rounding must not invalidate a 1 ml vial');
  assert.equal(assessPotion({ ...vial, volume: .99 }, order).quality, 0, 'truly undersized vials remain invalid');
  assert.equal(assessPotion({ ...vial, strength: 0 }, order).acceptable, false);
});

test('partly mixed scalar channels and targets survive a cauldron snapshot', () => {
  const brew = new BrewingSession(ingredients); brew.pour(1, 2, { 1: 10 }); brew.pour(2, 6, { 2: 10 });
  for (let i = 0; i < 40; i++) { brew.assistStir(); brew.step(); }
  const saved = brew.snapshot(), original = structuredClone(saved), restored = new BrewingSession(ingredients); restored.restore(saved);
  assert.deepEqual(saved, original);
  for (const key of EFFECT_PROPERTIES) assert.deepEqual(Array.from(restored.engine.ps[key].subarray(0, saved.count)), saved.particles[key]);
  assert.deepEqual(restored.engine.reactions.mixtures.snapshot(), saved.mixtures);
  for (const key of EFFECT_PROPERTIES) close(restored.inspect()[key], brew.inspect()[key]);
});

test('old physical-only mixture targets upgrade to neutral effect channels', () => {
  const ps = new ParticleSystem(1), solver = new MixtureSolver(); ps.add({ x: 0, y: 0, z: 0 }, material({})); solver.beginFrame(ps);
  const old = solver.snapshot(); old.groups[0].target.length = MIX_PROPERTIES.length - EFFECT_PROPERTIES.length - 2;
  const input = structuredClone(old), restored = new MixtureSolver(); restored.restore(old, ps);
  assert.deepEqual(old, input); assert.equal(restored.snapshot().groups[0].target.length, MIX_PROPERTIES.length);
  assert.deepEqual(restored.snapshot().groups[0].target.slice(-EFFECT_PROPERTIES.length-2,-2), EFFECT_PROPERTIES.map(() => 0));
});

test('animal, plant and stone trials resolve magic and chemistry without changing the vial', () => {
  const sample = { strength: .6, love: .5, transformation: .4, acidity: 0, stability: 100 }, original = structuredClone(sample);
  const rabbit = { id: 'rabbit', kind: 'animal', stats: { health: 85, vitality: 70 } };
  const result = assessEffects(sample, rabbit, 5);
  assert.deepEqual(result, assessEffects(sample, rabbit, 5)); assert.deepEqual(sample, original);
  assert.ok(result.after.strength > result.before.strength); assert.ok(result.after.love > 0); assert.ok(result.after.transformation > 0); assert.ok(result.safe);
  assert.ok(assessEffects(sample, { id: 'seedling', kind: 'plant' }).after.growth > 0);
  assert.ok(assessEffects({ acidity: .8 }, { id: 'stone', kind: 'mineral' }).after.health < 100);
  assert.equal(assessEffects({ death: .8, stability: 100 }, rabbit).after.alive, false);
});

test('dose and opposing fire/frost determine observable subject exposure', () => {
  const subject = { id: 'beetle', kind: 'animal' }, sample = { fire: .8, freeze: .3, poison: .2 };
  const small = assessEffects(sample, subject, 1), full = assessEffects(sample, subject, 5);
  assert.ok(full.after.health < small.after.health); assert.ok(full.after.burning > small.after.burning); assert.equal(full.after.freezing, 0);
  const neutral = assessEffects({}, subject); assert.deepEqual(neutral.after, neutral.before);
  assert.deepEqual(assessEffects(sample, subject, 0).after, neutral.before);
});
