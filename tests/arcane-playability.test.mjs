import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, migrateIngredients, INNATE_MAGIC_SCALE } from '../src/game/world.mjs';
import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';
import { arcaneRecipe, arcaneTriggerTemperature, stepArcana } from '../src/simulation/ArcaneSolver.mjs';
import { sandboxIngredientProperties } from '../src/game/sandboxProperties.mjs';
import { EFFECT_PROPERTIES } from '../src/materials/MaterialDefinition.mjs';
import { Phase } from '../src/simulation/Phase.mjs';

function charge(ps, frames = 20) {
  for (let tick = 0; tick < frames; tick++) stepArcana(ps, .025);
}

test('every basic essence is intentionally weak until a rune awakens', () => {
  const world = generateWorld('weak-innate-magic');
  assert.equal(world.ingredientVersion, 4);
  assert.equal(INNATE_MAGIC_SCALE, .12);
  for (const ingredient of world.ingredients) {
    for (const key of EFFECT_PROPERTIES) {
      assert.ok(ingredient.material[key] <= .12 + 1e-7,
        'raw ' + ingredient.name + ' has already-strong ' + key);
      assert.ok(ingredient.material[key] >= 0);
    }
    if (ingredient.id !== 1)
      assert.ok(EFFECT_PROPERTIES.some(key => ingredient.material[key] > .01),
        'each active basic reagent keeps its known magical signature');
  }
  assert.ok(EFFECT_PROPERTIES.every(key => world.ingredients[0].material[key] === 0),
    'plain water remains a neutral solvent');
});

test('existing saved-world ingredients rebalance without losing physics or signed rune', () => {
  const old = generateWorld('save-upgrade');
  old.ingredientVersion = 3;
  old.ingredients[1].material.strength = .86;
  const previousDensity = old.ingredients[1].material.density;
  const upgraded = migrateIngredients(old);
  assert.equal(upgraded.ingredientVersion, 4);
  assert.ok(upgraded.ingredients[1].material.strength < .12);
  assert.equal(upgraded.ingredients[1].material.density, previousDensity);
  assert.equal(upgraded.ingredients[1].material.arcaneThreshold, -8);
  assert.deepEqual(migrateIngredients(upgraded), upgraded, 'rebalance must be idempotent');
});

test('both high positive and negative rune thresholds fit heating and frost ranges', () => {
  const world = generateWorld('arcane-temperature');
  const negative = world.ingredients.find(i => i.id === 2);
  const positive = world.ingredients.find(i => i.id === 8);
  assert.equal(negative.material.arcaneThreshold, -8);
  assert.equal(positive.material.arcaneThreshold, 11);
  const cold = arcaneTriggerTemperature(-8), hot = arcaneTriggerTemperature(11);
  assert.ok(Math.abs(cold - .13) < 1e-9);
  assert.ok(Math.abs(hot - .605) < 1e-9);
  assert.equal(sandboxIngredientProperties(negative).awakeningReachable, true);
  assert.equal(sandboxIngredientProperties(positive).awakeningReachable, true);
  const ps = new ParticleSystem(2);
  ps.add({ x: 0, y: 0, z: 0, temperature: .33 }, negative.material, Phase.SOLID);
  ps.add({ x: .25, y: 0, z: 0, temperature: .33 }, positive.material, Phase.LIQUID);
  charge(ps);
  assert.equal(ps.arcaneConverted[0], 0, 'room-temperature cold rune stays dormant');
  assert.equal(ps.arcaneConverted[1], 0, 'room-temperature hot rune stays dormant');
  ps.temperature[0] = .095;
  ps.temperature[1] = .67;
  charge(ps);
  assert.equal(ps.arcaneConverted[0], 1);
  assert.equal(ps.arcaneConverted[1], 1);
  assert.ok(ps.strength[0] > .97, 'raw strength receives a real transition');
  assert.ok(ps.death[1] > .97, 'raw death receives a real transition');
});

test('weak innate 1:2 sources transition into strong proportional mixture effects', () => {
  const world = generateWorld('proportional-awakening');
  const strength = world.ingredients.find(i => i.id === 2).material;
  const poison = world.ingredients.find(i => i.id === 6).material;
  const ps = new ParticleSystem(2);
  ps.add({ x: 0, y: 0, z: 0, temperature: .33 }, strength, Phase.LIQUID);
  ps.add({ x: .1, y: 0, z: 0, temperature: .33 }, poison, Phase.LIQUID);
  const recipe = arcaneRecipe([
    { amount: 1, threshold: strength.arcaneThreshold, effects: strength },
    { amount: 2, threshold: poison.arcaneThreshold, effects: poison }
  ]);
  assert.equal(recipe.threshold, 4, 'weighted signed threshold stays unchanged');
  assert.ok(Math.abs(recipe.effects.strength - .33) < .001);
  assert.ok(Math.abs(recipe.effects.poison - .66) < .001);
  const original = Math.max(ps.strength[0], ps.poison[1]);
  assert.ok(original < .12);
  // Simulate the finished actual recipe grouping; expose precisely the same
  // state that MixtureSolver builds once its physical contact has blended.
  ps.mixtureGroup.set([1, 1]);
  ps.mixtureProgress.set([1, 1]);
  const mixtures = { root: () => ({ arcaneRecipe: recipe }) };
  for (let tick = 0; tick < 20; tick++) stepArcana(ps, .025, null, mixtures);
  assert.equal(ps.arcaneConverted[0], 0);
  ps.temperature.fill(.48);
  for (let tick = 0; tick < 20; tick++) stepArcana(ps, .025, null, mixtures);
  for (let i = 0; i < 2; i++) {
    assert.equal(ps.arcaneConverted[i], 1);
    assert.ok(Math.abs(ps.strength[i] - .33) < .001);
    assert.ok(Math.abs(ps.poison[i] - .66) < .001);
  }
});
