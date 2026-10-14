import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/game/world.mjs';
import { BrewingSession } from '../src/game/brewing.mjs';
import { newShop, recordDiscovery } from '../src/game/economy.mjs';
import { createExperimentState, runExperiment, splitPotionSample } from '../src/game/experiments.mjs';
import { returnVialToCauldron, validatePotionContents } from '../src/game/potionTransfer.mjs';
import { EFFECT_PROPERTIES } from '../src/game/effects.mjs';
import { compilePotionId, findPotionId } from '../src/game/potionId.mjs';
import { certificateFor, certifyPotion } from '../src/game/commerce.mjs';
import { observedPotion } from '../src/game/knowledge.mjs';
import { encodeSave, decodeSave } from '../src/game/persistence.mjs';

const world = generateWorld('potion-return');
const near = (actual, expected, epsilon = .0002) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const integral = (ps, key) => Array.from({ length: ps.count }, (_, i) => ps.mass[i] * ps[key][i]).reduce((a, b) => a + b, 0);

test('a tested vial returns only its remainder, preserving magic, heat, costs and source portions', () => {
  const brew = new BrewingSession(world.ingredients), state = { experiments: createExperimentState(), stage: 'inspection', tutorial: 6 };
  brew.pour(13, 40, {}, { infinite: true }); brew.cost = { ingredients: 12, energy: 3 };
  const ps = brew.engine.ps;
  for (let i = 0; i < ps.count; i++) {
    ps.temperature[i] = .46 + i % 3 * .04; ps.arcaneThreshold[i] = .51 + i % 3 * .03;
    ps.arcaneConverted[i] = i % 2; ps.arcaneCharge[i] = .5; ps.magicDecayTemperature[i] = .85;
  }
  const keys = [...EFFECT_PROPERTIES, 'temperature', 'arcaneThreshold', 'magicDecayTemperature', 'arcaneConverted', 'arcaneCharge'];
  const originals = Object.fromEntries(keys.map(key => [key, integral(ps, key)])), mass = ps.totalMass(), portions = brew.portions[0].ml;
  const sealed = brew.bottle(30), split = splitPotionSample(sealed, 5);
  state.pendingBottle = split.remaining; state.negotiation = { agreed: true };
  runExperiment(state, split.dose, 'rabbit', 5, 100, sealed);
  assert.ok(!state.experiments.records[0].sample.contents && !state.experiments.records[0].preparation.contents);
  const before = brew.inspectLiquid(), originalBatch = sealed.batchId;
  near(returnVialToCauldron(state, brew), 25);
  near(ps.totalMass() + split.dose.mass, mass); near(brew.liquidVolume, 35);
  for (const key of EFFECT_PROPERTIES) near(integral(ps, key) + split.dose.mass * split.dose[key], originals[key]);
  // Representative withdrawal returns each thermal/awakening state in the
  // same ratio, rather than rebuilding it from pristine garden ingredients.
  for (const key of keys.slice(EFFECT_PROPERTIES.length)) near(integral(ps, key), originals[key] * 35 / 40);
  near(brew.cost.ingredients + split.dose.cost.ingredients, 12); near(brew.cost.energy + split.dose.cost.energy, 3);
  near(brew.portions.reduce((sum, p) => sum + p.ml, 0) + split.dose.portions[0].ml, portions);
  assert.ok(brew.liquidVolume > before.volume); assert.notEqual(brew.batchId, originalBatch);
  assert.equal(state.pendingBottle, null); assert.equal(state.negotiation, null); assert.equal(state.stage, 'brewing');
  assert.equal(observedPotion(state, brew.inspectLiquid()), null);
  const snapshot = brew.snapshot(); assert.throws(() => returnVialToCauldron(state, brew)); assert.deepEqual(brew.snapshot(), snapshot);
});

test('full cauldrons can repeatedly bottle, test and return without particle fragmentation', () => {
  const brew = new BrewingSession(world.ingredients, { cauldron: 2 });
  brew.pour(1, 440, {}, { infinite: true });
  const count = brew.engine.ps.count, state = { stage: 'inspection' };
  for (let n = 0; n < 8; n++) {
    state.stage = 'inspection'; state.pendingBottle = splitPotionSample(brew.bottle(220), 2).remaining;
    returnVialToCauldron(state, brew);
    assert.equal(brew.engine.ps.count, count); near(brew.liquidVolume, 440 - (n + 1) * 2, .001);
  }
  brew.step(); assert.ok(Number.isFinite(brew.inspectLiquid().temperature));
});

test('returning into an empty pot reconstructs distinct irreversible material states and survives reload', () => {
  const state = newShop(world), brew = new BrewingSession(world.ingredients);
  brew.pour(13, 20, state.inventory); const ps = brew.engine.ps;
  for (let i = 0; i < ps.count; i++) { ps.arcaneConverted[i] = i % 2; ps.arcaneThreshold[i] = i % 2 ? -.7 : .9; ps.love[i] = i % 2 ? .98 : .12; }
  state.pendingBottle = splitPotionSample(brew.bottle(20), 5).remaining; state.stage = 'inspection';
  assert.equal(ps.count, 0);
  const saved = decodeSave(encodeSave(state, brew)), restored = new BrewingSession(world.ingredients);
  restored.restore(saved.brew); const inventory = { ...saved.inventory }, coins = saved.coins;
  returnVialToCauldron(saved, restored);
  near(restored.liquidVolume, 15); near(restored.inspectLiquid().love, .55);
  const converted = Array.from(restored.engine.ps.arcaneConverted.subarray(0, restored.engine.ps.count));
  assert.ok(converted.includes(0) && converted.includes(1)); assert.ok(converted.every(v => v === 0 || v === 1));
  assert.deepEqual(saved.inventory, inventory); assert.equal(saved.coins, coins);
  const roundtrip = decodeSave(encodeSave(saved, restored)); assert.equal(roundtrip.pendingBottle, null);
});

test('overflow, particle exhaustion and corrupt vial data reject the whole transfer without losing potion', () => {
  const brew = new BrewingSession(world.ingredients), state = { stage: 'inspection' };
  brew.pour(13, 40, {}, { infinite: true }); state.pendingBottle = brew.bottle(40);
  brew.pour(1, 180, {}, { infinite: true });
  const pot = brew.snapshot(), vial = structuredClone(state.pendingBottle);
  assert.throws(() => returnVialToCauldron(state, brew), /Make room/);
  assert.deepEqual(brew.snapshot(), pot); assert.deepEqual(state.pendingBottle, vial);
  brew.clean(); brew.pour(1, 100, {}, { infinite: true }); brew.engine.ps.capacity = brew.engine.ps.count;
  const limited = brew.snapshot(); assert.throws(() => returnVialToCauldron(state, brew), /more room/);
  assert.deepEqual(brew.snapshot(), limited); assert.deepEqual(state.pendingBottle, vial);
  const corrupt = structuredClone(vial); corrupt.mass *= 2;
  assert.throws(() => validatePotionContents(corrupt), /quantities/);
  corrupt.mass = vial.mass; corrupt.love = .1; assert.throws(() => validatePotionContents(corrupt), /magic/);
  corrupt.love = vial.love; corrupt.contents.data = 'broken'; assert.throws(() => validatePotionContents(corrupt));
  state.pendingBottle = { ...vial, portions: [{ ingredientId: 13, ml: -1 }] };
  assert.throws(() => returnVialToCauldron(state, brew), /preparation/); assert.deepEqual(brew.snapshot(), limited);
});

test('reopening a certified vial invalidates its ID, seal and offer, while history stays compact', () => {
  const state = newShop(world), brew = new BrewingSession(world.ingredients); state.coins = 1000;
  brew.pour(13, 20, state.inventory); state.pendingBottle = brew.bottle(20); state.stage = 'inspection';
  const split = splitPotionSample(state.pendingBottle, 2);
  runExperiment(state, split.dose, 'rabbit', 2, 100, state.pendingBottle); state.pendingBottle = split.remaining;
  const estimates = Object.fromEntries(EFFECT_PROPERTIES.map(key => [key, state.pendingBottle[key]]));
  compilePotionId(state, state.pendingBottle, estimates, 'First attempt'); certifyPotion(state);
  assert.ok(certificateFor(state, state.pendingBottle)); assert.ok(findPotionId(state, state.pendingBottle));
  recordDiscovery(state, state.pendingBottle); assert.ok(!state.discoveries[0].sample.contents && !state.potionIds[0].sample.contents);
  returnVialToCauldron(state, brew);
  assert.equal(findPotionId(state, brew.inspectLiquid()), null); assert.equal(certificateFor(state, brew.inspectLiquid()), null);
  assert.throws(() => compilePotionId(state, brew.inspectLiquid(), estimates), /real dose/);
  brew.pour(1, 5, state.inventory); const adjusted = brew.takeSample(2);
  runExperiment(state, adjusted, 'beetle', 2, 8000, brew.inspectLiquid());
  assert.ok(compilePotionId(state, brew.inspectLiquid(), estimates, 'Adjusted attempt'));
});

test('older sealed vials can be poured back without replenishing inventory or discarding known magic', () => {
  const brew = new BrewingSession(world.ingredients);
  brew.pour(13, 20, {}, { infinite: true }); const vial = brew.bottle(20);
  delete vial.contents; delete vial.material;
  const state = { pendingBottle: vial, stage: 'inspection', inventory: {} };
  returnVialToCauldron(state, brew);
  near(brew.liquidVolume, 20); near(brew.inspectLiquid().temperature, vial.temperature);
  for (const key of EFFECT_PROPERTIES) near(brew.inspectLiquid()[key], vial[key]);
  assert.deepEqual(state.inventory, {});
});

test('returning a mixed vial preserves its original affinity envelope and emerged material registry', () => {
  const brew = new BrewingSession(world.ingredients); brew.pour(1, 10, {}, { infinite: true }); brew.pour(13, 10, {}, { infinite: true });
  const ps = brew.engine.ps, mixtures = brew.engine.reactions.mixtures;
  mixtures.beginFrame(ps);
  const a = mixtures.root(ps.mixtureGroup[0]), b = mixtures.root(ps.mixtureGroup[40]);
  a.min = .1; a.max = .9; b.parent = a.id;
  // A locally fused source is pruned from an empty pot, so its definition must
  // travel in the vial and register again without flattening the envelope.
  const id = brew.engine.resolveFusion(ps, 0, 40, ps.materialId[0], ps.materialId[40]); ps.materialId[0] = id;
  const vial = brew.bottle(20); assert.ok(!brew.engine.materials.has(id));
  brew.returnPotion(vial); assert.ok(brew.engine.materials.has(id));
  mixtures.beginFrame(ps);
  for (let i = 0; i < ps.count; i++) { const group = mixtures.root(ps.mixtureGroup[i]); near(group.min, .1); near(group.max, .9); }
});

test('the original arcane ratio and signed threshold survive fused materials, bottle splitting and return', () => {
  const brew = new BrewingSession(world.ingredients);
  brew.pour(13, 10, {}, { infinite: true });
  brew.pour(14, 20, {}, { infinite: true });
  const ps = brew.engine.ps, mixtures = brew.engine.reactions.mixtures;
  mixtures.beginFrame(ps);
  const a = mixtures.root(ps.mixtureGroup[0]), b = mixtures.root(ps.mixtureGroup[40]);
  a.sourceAmounts.set(13, 10);
  a.sourceAmounts.set(14, 20);
  a.amount = 30;
  a.min = Math.min(a.min, b.min); a.max = Math.max(a.max, b.max);
  b.parent = a.id;
  const expected = (world.ingredients[12].material.arcaneThreshold * 10 +
    world.ingredients[13].material.arcaneThreshold * 20) / 30;
  for (let i = 0; i < ps.count; i++) ps.mixtureGroup[i] = a.id;
  // A fusion can replace the material IDs, but it must not erase the recipe.
  const fused = brew.engine.resolveFusion(ps, 0, 40, ps.materialId[0], ps.materialId[40]);
  for (let i = 0; i < ps.count; i++) ps.materialId[i] = fused;
  const sealed = brew.bottle(20);
  const remaining = splitPotionSample(sealed, 5).remaining;
  const content = remaining.contents;
  assert.ok(content.recipes?.length);
  assert.ok(content.recipes[0].sources.length === 2);
  assert.equal(ps.count > 0, true);
  const restoredMl = brew.returnPotion(remaining);
  near(restoredMl, 15);
  mixtures.beginFrame(ps);
  mixtures.finishFrame(ps, {}, .025);
  const live = mixtures.root(ps.mixtureGroup[0]).arcaneRecipe;
  near(live.threshold, expected, .0001);
  near(mixtures.root(ps.mixtureGroup[ps.count - 1]).arcaneRecipe.threshold, live.threshold);
});
