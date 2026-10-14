import test from 'node:test';
import assert from 'node:assert/strict';
import { sandboxIngredientProperties, sandboxMixtureProperties } from '../src/game/sandboxProperties.mjs';
import { EFFECT_PROPERTIES } from '../src/game/effects.mjs';
import { generateWorld } from '../src/game/world.mjs';
import { BrewingSession } from '../src/game/brewing.mjs';
import { stepArcana } from '../src/simulation/ArcaneSolver.mjs';

const properties = {
  r: .2, g: .3, b: .4, baseDensity: 1, viscosity: .2,
  meltingTemperature: .25, boilingTemperature: .8, combustionTemperature: 1.3,
  magicDecayTemperature: .95, temperature: .4,
  arcaneThreshold: .58, arcaneCharge: 0, arcaneConverted: 0
};

function fakeBrew(parcels) {
  const fields = [...Object.keys(properties), ...EFFECT_PROPERTIES];
  const ps = {
    count: parcels.length,
    mass: parcels.map(p => p.mass ?? 1),
    materialId: parcels.map(p => p.materialId),
    mixtureGroup: parcels.map(p => p.group ?? 0)
  };
  for (const key of fields) ps[key] = parcels.map(p => p[key] ?? properties[key] ?? 0);
  return {
    ingredients: [
      { id: 1, name: 'Water' }, { id: 2, name: 'Thorn essence' },
      { id: 3, name: 'Frost dust' }
    ],
    engine: { ps, reactions: { mixtures: { root: id => ({ id }) } } }
  };
}

test('ingredient inspection reads magical effects and phase threshold temperatures', () => {
  const ingredient = { name: 'Thorn essence', form: 'liquid',
    material: { strength: .82, fire: .19, arcaneThreshold: -8, meltingTemperature: .21,
      boilingTemperature: .73, combustionTemperature: 1.2, magicDecayTemperature: .9 } };
  const read = sandboxIngredientProperties(ingredient);
  assert.equal(read.effects.strength, .82);
  assert.equal(read.effects.fire, .19);
  assert.equal(read.effects.love, 0);
  assert.equal(read.meltingTemperature, .21);
  assert.equal(read.boilingTemperature, .73);
  assert.equal(read.combustionTemperature, 1.2);
  assert.equal(read.arcaneThreshold, -8);
  assert.equal(read.awakeningDirection, 'below');
  assert.equal(read.awakeningReachable, false);
  assert.equal(read.dominantEffect, 'strength');
  assert.equal(read.awakenedFraction, 0);
});

test('uniform same-group mixtures show actual live blended parcel magic and thermal thresholds', () => {
  const brew = fakeBrew([
    { materialId: 1, group: 5, mass: 1, strength: .32, boilingTemperature: .64 },
    { materialId: 2, group: 5, mass: 3, strength: .32, boilingTemperature: .64 }
  ]);
  const [mixture] = sandboxMixtureProperties(brew);
  assert.equal(mixture.homogeneous, true);
  assert.equal(mixture.effects.strength, .32);
  assert.equal(mixture.boilingTemperature, .64);
  assert.equal(mixture.arcaneThreshold, .58);
  assert.equal(mixture.awakeningDirection, 'above');
  assert.equal(mixture.awakeningReachable, true);
  assert.equal(mixture.sources[0].name, 'Thorn essence');
  assert.equal(mixture.sources[0].fraction, .75);
  brew.engine.ps.strength[0] = brew.engine.ps.strength[1] = .1;
  assert.equal(sandboxMixtureProperties(brew)[0].effects.strength, .1);
});

test('contact grouping does not mislabel an unmixed brew as homogeneous', () => {
  const brew = fakeBrew([
    { materialId: 1, group: 5, strength: 0, boilingTemperature: .7 },
    { materialId: 2, group: 5, strength: .9, boilingTemperature: .9 }
  ]);
  assert.equal(sandboxMixtureProperties(brew)[0].homogeneous, false);
});

test('separate incompatible groups remain distinct instead of being averaged together', () => {
  const brew = fakeBrew([
    { materialId: 1, group: 2, mass: 3, freeze: .2 },
    { materialId: 1, group: 2, mass: 1, freeze: .2 },
    { materialId: 3, group: 9, mass: 1, freeze: .8 }
  ]);
  const mixtures = sandboxMixtureProperties(brew);
  assert.equal(mixtures.length, 2);
  assert.equal(mixtures[0].effects.freeze, .2);
  assert.equal(mixtures[1].effects.freeze, .8);
  assert.ok(mixtures.every(m => m.homogeneous));
  assert.deepEqual(sandboxMixtureProperties(fakeBrew([])), []);
});


test('live rune awakening and charge fractions are mass-weighted, rather than inferred from ingredient defaults', () => {
  const brew = fakeBrew([
    { materialId: 1, group: 7, mass: 1, strength: .98, love: .002, arcaneThreshold: .6, arcaneConverted: 1 },
    { materialId: 2, group: 7, mass: 3, strength: .98, love: .002, arcaneThreshold: .6, arcaneConverted: 0, arcaneCharge: .4 }
  ]);
  const [mixture] = sandboxMixtureProperties(brew);
  assert.equal(mixture.homogeneous, true);
  assert.equal(mixture.dominantEffect, 'strength');
  assert.equal(mixture.awakenedFraction, .25);
  assert.ok(Math.abs(mixture.awakeningCharge - .3) < 1e-6);
  assert.equal(mixture.arcaneThreshold, .6);
  brew.engine.ps.arcaneThreshold[0] = -.4;
  assert.equal(sandboxMixtureProperties(brew)[0].homogeneous, false, 'an unresolved rune threshold is not a homogeneous mixture');
});

test('inspector proportions use original volume shares, not densities or fused particle IDs', () => {
  const brew = fakeBrew([
    { materialId: 1, group: 5, mass: 1, strength:.2, arcaneThreshold:.2 },
    { materialId: 2, group: 5, mass: 4, strength:.2, arcaneThreshold:.2 }
  ]);
  const root = { id:5, sourceAmounts:new Map([[1,10],[2,20]]), arcaneRecipe: { threshold:.2, effects:{ strength:.33, poison:.66 } } };
  brew.engine.reactions.mixtures.root = () => root;
  const [mixture] = sandboxMixtureProperties(brew);
  assert.ok(Math.abs(mixture.sources[0].fraction-2/3)<1e-10);
  assert.ok(Math.abs(mixture.sources[1].fraction-1/3)<1e-10);
  assert.equal(mixture.arcaneThreshold,.2);
  assert.equal(mixture.awakeningDirection,'above');
});

test('a pure negative-rune ingredient retains its exact threshold in the pot and after an old save resumes', () => {
  const world = generateWorld('single-rune-sign-regression');
  const ironroot = world.ingredients.find(item => item.id === 2);
  assert.equal(ironroot.material.arcaneThreshold, -8);
  const brew = new BrewingSession(world.ingredients);
  assert.equal(brew.pour(2, 20, {}, { infinite: true }), 20);
  const ingredientReading = sandboxIngredientProperties(ironroot);
  const freshReading = sandboxMixtureProperties(brew)[0];
  assert.equal(ingredientReading.arcaneThreshold, -8);
  assert.equal(freshReading.arcaneThreshold, -8);
  assert.equal(freshReading.awakeningDirection, 'below');
  assert.equal(freshReading.sources.length, 1);
  assert.equal(freshReading.sources[0].fraction, 1);

  const ps = brew.engine.ps, mixtures = brew.engine.reactions.mixtures;
  mixtures.beginFrame(ps);
  mixtures.finishFrame(ps, {}, .025);
  assert.equal(sandboxMixtureProperties(brew)[0].arcaneThreshold, -8);

  // Reproduce the screenshot's stale +800 °A material and particle values,
  // which can be present in older saved cauldron state.
  const legacy = brew.snapshot();
  legacy.materials.find(material => material.id === ironroot.id).arcaneThreshold = 8;
  legacy.particles.arcaneThreshold.fill(8);
  const restored = new BrewingSession(world.ingredients);
  restored.restore(legacy);
  const livePs = restored.engine.ps;
  assert.equal(restored.engine.materials.get(ironroot.id).arcaneThreshold, -8);
  assert.equal(livePs.arcaneThreshold[0], -8);
  const read = sandboxMixtureProperties(restored)[0];
  assert.equal(read.arcaneThreshold, -8);
  assert.equal(read.awakeningDirection, 'below');
  assert.equal(read.sources.length, 1);
  assert.equal(read.sources[0].fraction, 1);
  restored.engine.reactions.mixtures.beginFrame(livePs);
  restored.engine.reactions.mixtures.finishFrame(livePs, {}, .025);
  assert.equal(sandboxMixtureProperties(restored)[0].arcaneThreshold, -8);
});

test('singleton rune stays authoritative even if live parcel threshold is stale', () => {
  const world = generateWorld('singleton-live-rune');
  const ingredient = world.ingredients.find(item => item.id === 2);
  const brew = new BrewingSession(world.ingredients);
  brew.pour(2, 5, {}, { infinite: true });
  const ps = brew.engine.ps, mix = brew.engine.reactions.mixtures;
  mix.beginFrame(ps);
  mix.finishFrame(ps, {}, .025);
  assert.equal(mix.root(ps.mixtureGroup[0]).arcaneRecipe.threshold, -8);
  ps.arcaneThreshold.fill(8);
  stepArcana(ps, .025, null, mix);
  for (let i = 0; i < ps.count; i++) assert.equal(ps.arcaneThreshold[i], ingredient.material.arcaneThreshold);
  assert.equal(sandboxMixtureProperties(brew)[0].arcaneThreshold, -8);
});

test('positive single-ingredient thresholds remain positive after save and mixing', () => {
  const world = generateWorld('positive-singleton-rune');
  const heartpetal = world.ingredients.find(item => item.id === 3);
  const brew = new BrewingSession(world.ingredients);
  brew.pour(3, 10, {}, { infinite: true });
  const ps = brew.engine.ps, mix = brew.engine.reactions.mixtures;
  mix.beginFrame(ps);
  mix.finishFrame(ps, {}, .025);
  assert.equal(sandboxMixtureProperties(brew)[0].arcaneThreshold, 9);
  assert.equal(sandboxMixtureProperties(brew)[0].awakeningDirection, 'above');
});

test('unregistered source materials never silently create a positive +800°A recipe', () => {
  const world = generateWorld('missing-source-rune');
  const brew = new BrewingSession(world.ingredients);
  brew.pour(2, 5, {}, { infinite: true });
  const ps = brew.engine.ps, mix = brew.engine.reactions.mixtures;
  mix.materials.delete(2);
  mix.beginFrame(ps);
  mix.finishFrame(ps, {}, .025);
  assert.equal(mix.root(ps.mixtureGroup[0]).arcaneRecipe, null);
  assert.equal(sandboxMixtureProperties(brew)[0].arcaneThreshold, -8);
});
