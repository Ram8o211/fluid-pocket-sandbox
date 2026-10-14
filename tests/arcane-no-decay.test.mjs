import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';
import { sanitizeMaterial, EFFECT_PROPERTIES } from '../src/materials/MaterialDefinition.mjs';
import { arcaneRecipe, stepArcana } from '../src/simulation/ArcaneSolver.mjs';
import { BrewingSession } from '../src/game/brewing.mjs';
import { sandboxIngredientProperties, sandboxMixtureProperties } from '../src/game/sandboxProperties.mjs';

const material = (id, extras = {}) => sanitizeMaterial({
  id, name: 'Permanent enchantment', color: '#a67bcd',
  strength: .10, love: .025, fire: .012, poison: .014,
  arcaneThreshold: -8, magicDecayTemperature: .5, ...extras
});
const cycle = (ps, frames = 80, mixtures = null) => {
  for (let i = 0; i < frames; i++) stepArcana(ps, .025, null, mixtures);
};
const effects = (ps, i) => EFFECT_PROPERTIES.map(key => ps[key][i]);

test('intense heating does not erode any unawakened magical or chemical effect', () => {
  const ps = new ParticleSystem(2);
  ps.add({ x: 0, y: 0, z: 0, temperature: 1.18 }, material(1));
  const before = effects(ps, 0);
  cycle(ps, 200);
  assert.equal(ps.arcaneConverted[0], 0, 'negative frost rune must not awaken from heat');
  assert.deepEqual(effects(ps, 0), before, 'no effect can be eroded by heat');
});

test('magical properties remain fixed after hot-rune awakening and later temperature cycling', () => {
  const ps = new ParticleSystem(2);
  ps.add({ x: 0, y: 0, z: 0, temperature: .33 },
    material(1, { arcaneThreshold: 8, strength: .10, love: 0, fire: 0, poison: 0 }));
  cycle(ps, 30);
  assert.equal(ps.arcaneConverted[0], 0);
  ps.temperature[0] = .9;
  cycle(ps, 20);
  assert.equal(ps.arcaneConverted[0], 1);
  assert.ok(ps.strength[0] >= .97);
  const awakened = effects(ps, 0);
  for (const temp of [1.2, .01, .95, .33, 1.2]) {
    ps.temperature[0] = temp;
    cycle(ps, 160);
    assert.deepEqual(effects(ps, 0), awakened, 'awakened effects survive cycling at ' + temp);
    assert.equal(ps.arcaneConverted[0], 1);
  }
});

test('a 1:2 awakened mixture retains all source-weighted effects at extreme temperatures', () => {
  const strength = material(1, { arcaneThreshold: -8, strength: .1, love: 0, fire: 0, poison: 0 });
  const venom = material(2, { arcaneThreshold: 10, strength: 0, love: 0, fire: 0, poison: .1 });
  const ps = new ParticleSystem(2);
  ps.add({ x: 0, y: 0, z: 0, temperature: .6 }, strength);
  ps.add({ x: .15, y: 0, z: 0, temperature: .6 }, venom);
  const recipe = arcaneRecipe([
    { amount: 1, threshold: strength.arcaneThreshold, effects: strength },
    { amount: 2, threshold: venom.arcaneThreshold, effects: venom }
  ]);
  assert.equal(recipe.threshold, 4);
  ps.mixtureGroup.fill(7, 0, ps.count);
  ps.mixtureProgress.fill(1, 0, ps.count);
  const mixtures = { root: () => ({ arcaneRecipe: recipe }) };
  cycle(ps, 20, mixtures);
  for (let i = 0; i < ps.count; i++) {
    assert.equal(ps.arcaneConverted[i], 1);
    assert.ok(Math.abs(ps.strength[i] - .33) < .005);
    assert.ok(Math.abs(ps.poison[i] - .66) < .005);
  }
  const baseline = [effects(ps, 0), effects(ps, 1)];
  for (const temp of [1.2, .02, 1.15, .33]) {
    ps.temperature.fill(temp);
    cycle(ps, 100, mixtures);
    for (let i = 0; i < ps.count; i++)
      assert.deepEqual(effects(ps, i), baseline[i], 'mixture magic persists at ' + temp);
  }
});

test('old decay metadata in saved brews remains readable and inert', () => {
  const ingredient = { id: 1, name: 'Permanent enchantment', form: 'liquid', price: .1,
    material: material(1, { arcaneThreshold: -8, strength: .11 }) };
  const brew = new BrewingSession([ingredient]);
  assert.equal(brew.pour(1, 5, { 1: 10 }), 5);
  const restored = new BrewingSession([ingredient]);
  restored.restore(brew.snapshot());
  const ps = restored.engine.ps;
  ps.temperature.fill(1.2, 0, ps.count);
  const initial = Array.from(ps.strength.subarray(0, ps.count));
  cycle(ps, 100);
  assert.deepEqual(Array.from(ps.strength.subarray(0, ps.count)), initial);
  assert.equal(sandboxIngredientProperties(ingredient).magicDecayTemperature, undefined);
  assert.equal(sandboxMixtureProperties(restored)[0].magicDecayTemperature, undefined);
});
