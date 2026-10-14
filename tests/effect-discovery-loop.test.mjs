import { compilePotionId } from '../src/game/potionId.mjs';
import { startNegotiation, acceptCustomerOffer } from '../src/game/commerce.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, availableIngredients } from '../src/game/world.mjs';
import { BrewingSession } from '../src/game/brewing.mjs';
import { generateOrder, simulateWitness } from '../src/game/orders.mjs';
import { assessPotion, priceSale } from '../src/game/evaluation.mjs';
import { runExperiment, splitPotionSample } from '../src/game/experiments.mjs';
import { observedPotion, discoveryKnowledge } from '../src/game/knowledge.mjs';
import { newShop, recordDiscovery, completeSale } from '../src/game/economy.mjs';
import { encodeSave, decodeSave } from '../src/game/persistence.mjs';
import { EFFECT_PROPERTIES } from '../src/game/effects.mjs';

function prepare(state) {
  const brew = new BrewingSession(state.world.ingredients, state.equipment), recipe = state.order.witness;
  for (const portion of recipe.portions) brew.pour(portion.ingredientId, portion.ml, state.inventory, { crushed: Boolean(portion.crushed) });
  for (let tick = 0; tick < recipe.ticks; tick++) { if (tick > 20) brew.assistStir(); brew.step(); }
  return brew;
}

test('customers request attainable effects from the first order, with no recipe in their clues', () => {
  const world = generateWorld('effects-loop');
  for (const completed of [0, 1, 2, 5, 9]) {
    const equipment = { reagents: completed > 5 ? 3 : 0 }, order = generateOrder(world, completed, equipment);
    const desired = order.requirements.filter(r => r.comparison === 'target');
    assert.ok(desired.length >= 1);
    if (completed >= 2) assert.ok(desired.length >= 2);
    assert.ok(desired.every(r => EFFECT_PROPERTIES.includes(r.property) && r.target > .01 && r.tolerance < r.target));
    assert.ok(!desired.some(r => r.property === 'fire') || !desired.some(r => r.property === 'freeze'));
    for (const ingredient of world.ingredients) assert.ok(!order.clue.includes(ingredient.name));
    assert.ok(order.witness.portions.every(p => availableIngredients(world, equipment).some(i => i.id === p.ingredientId)));
    assert.equal(assessPotion(simulateWitness(world, order.witness, equipment), order).quality, 100);
    const water = new BrewingSession(world.ingredients); water.pour(1, order.volume, { 1: 1000 });
    assert.equal(priceSale(water.bottle(order.volume), order).payment, 0, 'neutral water cannot satisfy a missing desired effect');
  }
});

test('unwanted effect limits reward lower concentrations and requested effects drive the price', () => {
  const state = newShop(generateWorld('scoring-effects')), sample = simulateWitness(state.world, state.order.witness);
  const ideal = priceSale(sample, state.order);
  assert.equal(ideal.quality, 100);
  assert.equal(priceSale({ ...sample, poison: 0 }, state.order).quality, 100);
  assert.equal(priceSale({ ...sample, poison: .9 }, state.order).acceptable, false);
  const near = priceSale({ ...sample, strength: sample.strength * .85 }, state.order);
  const far = priceSale({ ...sample, strength: sample.strength * .5 }, state.order);
  assert.ok(ideal.payment > near.payment && near.payment > far.payment);
});

test('serving a modern commission requires an actual test of the current batch', () => {
  const state = newShop(generateWorld('serve-effects')), brew = prepare(state);
  state.pendingBottle = brew.bottle(state.order.volume); state.stage = 'inspection';
  const before = structuredClone(state);
  assert.throws(() => completeSale(state), /Test this batch/);
  assert.deepEqual(state, before, 'an untested sale changes neither stock nor progression');
  const split = splitPotionSample(state.pendingBottle, 5);
  runExperiment(state, split.dose, 'rabbit'); state.pendingBottle = split.remaining;
  assert.throws(()=>completeSale(state),/Compile a potion ID/);
  compilePotionId(state,state.pendingBottle,Object.fromEntries(EFFECT_PROPERTIES.map(k=>[k,state.pendingBottle[k]])));
  startNegotiation(state);acceptCustomerOffer(state);
  assert.ok(completeSale(state).payment > 0);
});

test('inspection and recording an untested formula grant no mixture knowledge; a real test does', () => {
  const state = newShop(generateWorld('knowledge-loop')), brew = prepare(state), source = brew.inspectLiquid();
  assert.equal(observedPotion(state, source), null);
  const hypothesis = recordDiscovery(state, source, 'My hypothesis');
  assert.equal(discoveryKnowledge(hypothesis), null);
  const before = brew.liquidVolume, dose = brew.takeSample(5);
  const report = runExperiment(state, dose, 'rabbit', dose.volume, 100, source);
  assert.ok(Math.abs(before - brew.liquidVolume - 5) < .001);
  assert.equal(observedPotion(state, brew.inspectLiquid()).id, report.id);
  compilePotionId(state,source,Object.fromEntries(EFFECT_PROPERTIES.map(k=>[k,source[k]])));
  const discovered = recordDiscovery(state, source, 'Observed tonic');
  assert.ok(discoveryKnowledge(discovered)); assert.equal(discovered.observations.length,0); assert.ok(discovered.potionId);
  assert.deepEqual(discovered.preparation.portions, source.portions);
  const vial = brew.bottle(state.order.volume);
  assert.equal(observedPotion(state, vial).id, report.id, 'bottling preserves tested batch concentrations');
  const { remaining } = splitPotionSample(vial, 5);
  assert.ok(observedPotion(state, remaining), 'a smaller sealed vial retains its observed effects');
  assert.equal(discoveryKnowledge(hypothesis), null, 'an earlier hypothesis does not retroactively become a tested formula');
});

test('dilution, further extraction, heat, and a new batch invalidate a current mixture reading', () => {
  const state = newShop(generateWorld('retest-loop')), brew = prepare(state), dose = brew.takeSample(5);
  runExperiment(state, dose, 'rabbit-2', 5, 100);
  const measured = brew.inspectLiquid(); assert.ok(observedPotion(state, measured));
  assert.ok(observedPotion(state, { ...measured, temperature: measured.temperature + .08 }), 'Temperature alone does not reveal or erase magical estimates');
  assert.equal(observedPotion(state, { ...measured, strength: measured.strength + .01 }), null);
  brew.pour(1, 40, state.inventory);
  assert.equal(observedPotion(state, brew.inspectLiquid()), null);
  const newBrew = prepare(newShop(state.world));
  assert.equal(observedPotion(state, newBrew.inspectLiquid()), null);
});

test('tested results, full preparation, and batch knowledge survive saving and restoring', () => {
  const state = newShop(generateWorld('persist-loop')), brew = prepare(state), source = brew.inspectLiquid();
  const dose = brew.takeSample(5); runExperiment(state, dose, 'rabbit', 5, 100, source);
  compilePotionId(state,source,Object.fromEntries(EFFECT_PROPERTIES.map(k=>[k,source[k]])));
  recordDiscovery(state, source, 'Tested recipe');
  const saved = decodeSave(encodeSave(state, brew)), resumed = new BrewingSession(saved.world.ingredients, saved.equipment);
  resumed.restore(saved.brew);
  assert.equal(resumed.batchId, brew.batchId);
  assert.ok(observedPotion(saved, resumed.inspectLiquid()));
  assert.ok(discoveryKnowledge(saved.discoveries[0]));
  assert.deepEqual(saved.experiments.records[0].preparation.portions, source.portions);
});

test('old untouched commissions migrate, while an in-progress brew and bottle retain their order', () => {
  const state = newShop(generateWorld('legacy-loop')), brew = new BrewingSession(state.world.ingredients);
  delete state.order.conceptVersion;
  state.order.requirements = [{ property: 'color', target: '#a8dfe8', tolerance: .15, weight: 1, hard: false }];
  const upgraded = decodeSave(encodeSave(state, brew));
  assert.equal(upgraded.order.conceptVersion, 2);
  brew.pour(1, 80, state.inventory);
  assert.deepEqual(decodeSave(encodeSave(state, brew)).order, state.order);
  state.pendingBottle = brew.bottle(60); state.stage = 'inspection';
  assert.deepEqual(decodeSave(encodeSave(state, brew)).order, state.order);
});
