import test from 'node:test';
import assert from 'node:assert/strict';
import { sandboxIngredientProperties, sandboxMixtureProperties } from '../src/game/sandboxProperties.mjs';
import { EFFECT_PROPERTIES } from '../src/game/effects.mjs';

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
