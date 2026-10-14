import test from 'node:test';
import assert from 'node:assert/strict';
import { arcaneRecipe, stepArcana } from '../src/simulation/ArcaneSolver.mjs';
import { MixtureSolver } from '../src/reactions/MixtureSolver.mjs';
import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';
import { Phase } from '../src/simulation/Phase.mjs';
import { sanitizeMaterial } from '../src/materials/MaterialDefinition.mjs';

const material = (id, threshold, effects, extra = {}) => sanitizeMaterial({
  id, name: 'Rune ' + id, color: '#af81dd', density: 1,
  meltingTemperature: .75, boilingTemperature: .9, combustionTemperature: 1.3,
  miscibility: .42, magicDecayTemperature: 1.4, arcaneThreshold: threshold,
  ...effects, ...extra
});

test('the exact 1:2 recipe uses a proper weighted average and preserves effect proportions', () => {
  const a = { amount: 10, threshold: -10, effects: { strength: .8 } };
  const b = { amount: 20, threshold: 8, effects: { poison: .6 } };
  const recipe = arcaneRecipe([a, b]);
  assert.equal(recipe.threshold, 2, '(-1000 + 800*2)/(1+2) = +200 degrees A');
  assert.ok(Math.abs(recipe.effects.strength - .33) < 1e-10);
  assert.ok(Math.abs(recipe.effects.poison - .66) < 1e-10);
  assert.equal(recipe.effects.love, 0);
  assert.equal(recipe.effects.fire, 0);
  assert.equal(arcaneRecipe([{ ...a, amount: 100 }, { ...b, amount: 200 }]).threshold, 2,
    'enlarging a batch must not change its critical temperature');
  assert.equal(arcaneRecipe([{...a,amount:2},{...b,amount:1}]).threshold,-4,
    'negative component-weighted totals preserve their sign');
});

test('three ingredients distribute magical results according to source shares, not a winner-take-all channel', () => {
  const recipe = arcaneRecipe([
    { amount: 5, threshold: -1, effects: { strength: .9 } },
    { amount: 10, threshold: 1, effects: { poison: .6 } },
    { amount: 5, threshold: 2, effects: { love: .8, fire: .2 } }
  ]);
  assert.equal(recipe.threshold, .75);
  assert.ok(Math.abs(recipe.effects.strength - .2475) < 1e-10);
  assert.ok(Math.abs(recipe.effects.poison - .495) < 1e-10);
  assert.ok(Math.abs(recipe.effects.love - .2475) < 1e-10);
  assert.equal(recipe.effects.fire, 0);
});

test('the physical mixing solver retains initial ingredients across fluid contact and save/restore', () => {
  const a = material(1, -10, { strength: .9 }), b = material(2, 8, { poison: .9 });
  const ps = new ParticleSystem(8);
  ps.add({x:0,y:0,z:0},a,Phase.LIQUID);
  ps.add({x:.05,y:0,z:0},b,Phase.LIQUID);
  ps.mixtureAmount[0] = 10; ps.mixtureAmount[1] = 20;
  const mixtures = new MixtureSolver();
  mixtures.materials = new Map([[1,a],[2,b]]);
  mixtures.beginFrame(ps);
  mixtures.contact(ps,0,1,1,.2,.05,{baseMixingRate:8,mixingExponent:1,mixingTemperatureCoefficient:0});
  mixtures.finishFrame(ps,{},.05);
  const group = mixtures.root(ps.mixtureGroup[0]);
  assert.equal(group.arcaneRecipe.threshold,2);
  assert.ok(Math.abs(group.arcaneRecipe.effects.strength-.33) < 1e-8);
  assert.ok(Math.abs(group.arcaneRecipe.effects.poison-.66) < 1e-8);
  assert.equal(mixtures.root(ps.mixtureGroup[1]).id,group.id);
  const saved = mixtures.snapshot();
  const restored = new MixtureSolver();
  restored.materials = mixtures.materials;
  restored.restore(saved,ps);
  assert.equal(restored.root(ps.mixtureGroup[0]).arcaneRecipe.threshold,2);
  assert.equal(restored.root(ps.mixtureGroup[0]).sourceAmounts.size,2);
  const update=restored.root(ps.mixtureGroup[0]);
  ps.mixtureProgress.fill(1);
  ps.temperature.fill(.35);
  stepArcana(ps,.5,null,restored);
  assert.equal(ps.arcaneConverted[0],0,'a +200°A rune cannot awaken below its mapped heating trigger');
  ps.temperature.fill(.55);
  stepArcana(ps,.5,null,restored);
  assert.equal(ps.arcaneConverted[0],1,'the signed weighted-average rune is reachable by heating');
});

test('hot evaporated gas and dry unmelted powder can still transform independently of phase', () => {
  const ps = new ParticleSystem(4);
  const gas = material(1, .83, { fire: .8, poison: .2 }, { boilingTemperature: .8 });
  const powder = material(2, .42, { strength: .7, love: .3 }, { solidSubdivision: 1, meltingTemperature: .72 });
  ps.add({x:0,y:0,z:0,temperature:1.04},gas,Phase.GAS);
  ps.add({x:0,y:0,z:0,temperature:.55},powder,Phase.SOLID);
  for (let i=0;i<20;i++) stepArcana(ps,.025);
  assert.equal(ps.arcaneConverted[0],1);
  assert.equal(ps.arcaneConverted[1],1);
  assert.equal(ps.phase[0],Phase.GAS);
  assert.equal(ps.phase[1],Phase.SOLID);
  assert.ok(ps.fire[0]>.97);
  assert.ok(ps.strength[1]>.97);
  assert.equal(ps.poison[0],0);
  assert.equal(ps.love[1],0);
});

test('the live recipe transforms BOTH enchantments at their shared temperature', () => {
  const a = material(1,-.4,{strength:.85}), b = material(2,.6,{poison:.9});
  const ps = new ParticleSystem(2),mix = new MixtureSolver();
  mix.materials = new Map([[1,a],[2,b]]);
  ps.add({x:0,y:0,z:0,temperature:.8},a,Phase.LIQUID);
  ps.add({x:.02,y:0,z:0,temperature:.8},b,Phase.GAS);
  ps.mixtureAmount[0]=1;ps.mixtureAmount[1]=2;
  mix.beginFrame(ps);mix.contact(ps,0,1,1,.2,.1,{baseMixingRate:10,mixingExponent:1});mix.finishFrame(ps,{},.1);
  assert.ok(Math.abs(mix.root(ps.mixtureGroup[0]).arcaneRecipe.threshold-(.8/3))<1e-6);
  ps.mixtureProgress.fill(1);
  for(let j=0;j<20;j++)stepArcana(ps,.025,null,mix);
  for(let i=0;i<ps.count;i++){
    assert.equal(ps.arcaneConverted[i],1);
    assert.ok(Math.abs(ps.strength[i]-.33)<.00001);
    assert.ok(Math.abs(ps.poison[i]-.66)<.00001);
    assert.equal(ps.love[i],0);
  }
});

test('a previously awakened ingredient resets its rune when a new recipe is formed', () => {
  const a = material(1,.6,{strength:.8}), b = material(2,-.2,{poison:.9});
  const ps = new ParticleSystem(2),mix = new MixtureSolver();
  mix.materials = new Map([[1,a],[2,b]]);
  ps.add({x:0,y:0,z:0,temperature:.9},a,Phase.LIQUID);
  ps.add({x:.02,y:0,z:0,temperature:.9},b,Phase.LIQUID);
  for(let k=0;k<20;k++)stepArcana(ps,.025);
  assert.equal(ps.arcaneConverted[0],1);
  assert.equal(ps.poison[0],0);
  mix.beginFrame(ps);
  mix.contact(ps,0,1,1,.2,.1,{baseMixingRate:10,mixingExponent:1});
  mix.finishFrame(ps,{},.1);
  assert.equal(ps.arcaneConverted[0],0,'forming a new mixture clears obsolete awakenings');
  ps.temperature.fill(.1);
  stepArcana(ps,.025,null,mix);
  assert.equal(ps.arcaneConverted[0],0,'unblended parcels must not reawaken prematurely');
  ps.mixtureProgress.fill(1);
  ps.temperature.fill(.5);
  for(let k=0;k<20;k++)stepArcana(ps,.025,null,mix);
  assert.ok(Math.abs(mix.root(ps.mixtureGroup[0]).arcaneRecipe.threshold-.2)<1e-6);
  assert.equal(ps.arcaneConverted[0],1);
  assert.ok(Math.abs(ps.strength[0]-.495)<1e-6);
  assert.ok(Math.abs(ps.poison[0]-.495)<1e-6);
});


test('mixture threshold preserves negative, zero and positive signed weighted results', () => {
  const strength = { amount: 1, threshold: -1, effects: { strength: .8 } };
  const venom = { amount: 1, threshold: 1, effects: { poison: .8 } };
  assert.equal(arcaneRecipe([strength, venom]).threshold, 0, 'opposed runes can cancel exactly');
  const negative = arcaneRecipe([strength, { ...venom, threshold: -.5 }]);
  assert.equal(negative.threshold, -.75, 'the final threshold must remain negative');
  assert.ok(Math.abs(negative.effects.strength - .495) < 1e-10);
  assert.ok(Math.abs(negative.effects.poison - .495) < 1e-10);
  assert.equal(arcaneRecipe([strength]).threshold, -1, 'single ingredient keeps its signed threshold');
  assert.equal(arcaneRecipe([{ ...strength, amount: 1, threshold: -10 }, { ...venom, amount: 2, threshold: 8 }]).threshold, 2);
});

test('live mixed parcels and save/restore retain a negative final threshold', () => {
  const a = material(1, -1.2, { strength: .9 });
  const b = material(2, .4, { poison: .9 });
  const ps = new ParticleSystem(2), mix = new MixtureSolver();
  mix.materials = new Map([[1, a],[2, b]]);
  ps.add({x:0,y:0,z:0,temperature:.5},a,Phase.LIQUID);
  ps.add({x:.03,y:0,z:0,temperature:.5},b,Phase.GAS);
  mix.beginFrame(ps);
  mix.contact(ps,0,1,1,.2,.1,{baseMixingRate:10,mixingExponent:1});
  mix.finishFrame(ps,{},.1);
  const group = mix.root(ps.mixtureGroup[0]);
  assert.ok(Math.abs(group.arcaneRecipe.threshold + .4) < 1e-5);
  ps.mixtureProgress.fill(1);
  stepArcana(ps,.025,null,mix);
  assert.ok(ps.arcaneThreshold[0] < 0 && ps.arcaneThreshold[1] < 0);
  const restored = new MixtureSolver();
  restored.materials = mix.materials;
  restored.restore(mix.snapshot(),ps);
  assert.ok(Math.abs(restored.root(ps.mixtureGroup[0]).arcaneRecipe.threshold + .4) < 1e-5);
});

test('weighted rune thresholds remain bounded and are independent of recipe scale', () => {
  const a = { amount: 1, threshold: -.8, effects: { strength: .9 } };
  const b = { amount: 4, threshold: .6, effects: { poison: .9 } };
  const mixed = arcaneRecipe([a, b]);
  assert.ok(Math.abs(mixed.threshold - .32) < 1e-10);
  assert.ok(mixed.threshold >= -.8 && mixed.threshold <= .6);
  assert.ok(Math.abs(arcaneRecipe([{ ...a, amount: .1 }, { ...b, amount: .4 }]).threshold - .32) < 1e-10);
  assert.ok(Math.abs(mixed.effects.strength - .198) < 1e-10);
  assert.ok(Math.abs(mixed.effects.poison - .792) < 1e-10);
});

test('positive runes require heat above room, rather than cooling', () => {
  const m = material(1, .2, { strength: .9 });
  const ps = new ParticleSystem(1);
  ps.add({ x:0,y:0,z:0,temperature:.1 },m,Phase.LIQUID);
  for (let j=0;j<20;j++) stepArcana(ps,.025);
  assert.equal(ps.arcaneConverted[0],0);
  ps.temperature[0]=.4;
  for (let j=0;j<20;j++) stepArcana(ps,.025);
  assert.equal(ps.arcaneConverted[0],1);
});
