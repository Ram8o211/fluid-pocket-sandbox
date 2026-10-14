import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/game/world.mjs';
import { BrewingSession } from '../src/game/brewing.mjs';
import { createExperimentState, runExperiment, resetExperimentSubject, splitPotionSample } from '../src/game/experiments.mjs';
import { newShop, completeSale, restock, tradeStock, guildLoan } from '../src/game/economy.mjs';
import { encodeSave, decodeSave, saveShop, loadShop, SAVE_KEY, SANDBOX_SAVE_KEY } from '../src/game/persistence.mjs';
import { generateOrder, simulateWitness } from '../src/game/orders.mjs';
import { assessPotion } from '../src/game/evaluation.mjs';
import { EFFECT_PROPERTIES } from '../src/game/effects.mjs';
import { SAVE_VERSION } from '../src/game/contracts.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < .00001, `${actual} != ${expected}`);
const potion = effects => ({ id: 'vial-immutable', volume: 60, mass: 75, density: 1.25, temperature: .33,
  color: '#94d58c', viscosity: .2, volatility: .1, stability: 100, potency: 50, liquidFraction: 1,
  cost: { ingredients: 6, energy: 2 }, composition: { 1: 60, 2: 15 }, phaseMass: [0, 75, 0],
  portions: [{ ingredientId: 1, ml: 48 }, { ingredientId: 2, ml: 12 }],
  ...Object.fromEntries(EFFECT_PROPERTIES.map(key => [key, effects?.[key] || 0])) });

test('a vial dose conserves every stored quantity and leaves potion properties and identity immutable', () => {
  const sample = potion({ strength: .8 }), original = structuredClone(sample);
  const { dose, remaining } = splitPotionSample(sample, 5);
  assert.deepEqual(sample, original); assert.equal(remaining.id, sample.id);
  close(dose.volume + remaining.volume, sample.volume); close(dose.mass + remaining.mass, sample.mass);
  for (const key of ['ingredients', 'energy']) close(dose.cost[key] + remaining.cost[key], sample.cost[key]);
  for (const key of Object.keys(sample.composition)) close(dose.composition[key] + remaining.composition[key], sample.composition[key]);
  sample.portions.forEach((portion, index) => close(dose.portions[index].ml + remaining.portions[index].ml, portion.ml));
  assert.equal(dose.strength, sample.strength); assert.equal(remaining.strength, sample.strength);
  dose.portions[0].ml = 100; assert.deepEqual(sample, original);
  assert.equal(splitPotionSample(sample, 100).remaining, null);
  assert.throws(() => splitPotionSample(sample, -5));
});

test('experiment subjects respond to actual dose effects, retain independent observations and can reset', () => {
  const state = { experiments: createExperimentState() }, sample = potion({ strength: .9, love: .4 });
  const report = runExperiment(state, sample, 'rabbit', 5, 100);
  assert.ok(report.after.strength > report.before.strength); assert.ok(report.after.love > report.before.love);
  assert.equal(state.experiments.subjects.rabbit.trials, 1); assert.equal(state.experiments.records[0].volume, 5);
  report.after.strength = 0; sample.strength = 0;
  assert.ok(state.experiments.subjects.rabbit.stats.strength > 20);
  assert.equal(state.experiments.records[0].sample.strength, .9);
  resetExperimentSubject(state, 'rabbit'); assert.equal(state.experiments.subjects.rabbit.stats.strength, 20);
  assert.equal(state.experiments.records.length, 1);
  const count = state.experiments.records.length;
  assert.throws(() => runExperiment(state, sample, 'unknown', 5, 100));
  assert.equal(state.experiments.records.length, count);
});

test('animals, plants and minerals reveal different chemical and magical responses', () => {
  const state = { experiments: createExperimentState() };
  const poisoned = runExperiment(state, potion({ poison: 1 }), 'rabbit', 20, 100);
  const corroded = runExperiment(state, potion({ acidity: 1 }), 'stone', 20, 100);
  const growing = runExperiment(state, potion({ transformation: 1 }), 'seedling', 20, 100);
  assert.ok(poisoned.after.health < poisoned.before.health);
  assert.ok(corroded.after.health < corroded.before.health);
  assert.ok(growing.after.growth > growing.before.growth || growing.after.transformation > growing.before.transformation);
  assert.ok([poisoned, corroded, growing].every(report => report.observations.length > 0));
});

test('experiment history is bounded and dead subjects need a reset', () => {
  const state = { mode: 'sandbox', experiments: createExperimentState() };
  for (let index = 0; index < 90; index++) runExperiment(state, potion(), 'stone', 1, index * 7000);
  assert.equal(state.experiments.records.length, 80); assert.equal(state.experiments.records[0].serial, 90);
  state.experiments.subjects.rabbit.stats.alive = false;
  assert.throws(() => runExperiment(state, potion(), 'rabbit', 5, 100));
  resetExperimentSubject(state, 'rabbit'); assert.equal(runExperiment(state, potion(), 'rabbit', 5, 100).serial, 91);
});

test('sandbox unlocks ingredients and measurements while isolating progression and save slots', () => {
  const world = generateWorld('sandbox-domain'), shop = newShop(world), sandbox = newShop(world, { sandbox: true });
  assert.equal(sandbox.mode, 'sandbox'); assert.equal(sandbox.equipment.analyzer, true); assert.equal(sandbox.equipment.reagents, 3);
  assert.ok(Object.values(sandbox.inventory).every(quantity => quantity > 0));
  const totals = [sandbox.coins, sandbox.reputation, sandbox.completed, sandbox.debt];
  restock(sandbox, 1); assert.deepEqual([sandbox.coins, sandbox.reputation, sandbox.completed, sandbox.debt], totals);
  assert.throws(() => completeSale(sandbox)); assert.throws(() => tradeStock(sandbox, 1)); assert.throws(() => guildLoan(sandbox));
  const data = new Map(), storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  const brew = new BrewingSession(world.ingredients, sandbox.equipment);
  saveShop(storage, shop, brew); saveShop(storage, sandbox, brew);
  assert.ok(data.has(SAVE_KEY)); assert.ok(data.has(SANDBOX_SAVE_KEY));
  assert.equal(loadShop(storage).state.mode, 'shop'); assert.equal(loadShop(storage, SANDBOX_SAVE_KEY).state.mode, 'sandbox');
  assert.equal(shop.coins, 80); assert.equal(shop.equipment.analyzer, false);
});

test('legacy migration preserves consumed stock and physical brews while introducing gathering and subjects', () => {
  const world = generateWorld('migration-domain'), state = newShop(world), brew = new BrewingSession(world.ingredients);
  brew.pour(1, 80, state.inventory); state.pendingBottle = brew.bottle(60); state.stage = 'inspection';
  const original = JSON.parse(encodeSave(state, brew));
  const legacy = structuredClone(original); legacy.version = 3;
  delete legacy.mode; delete legacy.foraging; delete legacy.experiments;
  for (const ingredient of legacy.world.ingredients) for (const key of EFFECT_PROPERTIES) delete ingredient.material[key];
  for (const key of EFFECT_PROPERTIES) delete legacy.pendingBottle[key];
  delete legacy.pendingBottle.effects;
  const migrated = decodeSave(JSON.stringify(legacy));
  assert.equal(migrated.version, SAVE_VERSION); assert.deepEqual(migrated.inventory, original.inventory);
  assert.deepEqual(migrated.brew, original.brew); assert.deepEqual(migrated.order, original.order);
  close(migrated.pendingBottle.volume, 60); assert.equal(migrated.mode, 'shop');
  assert.ok(migrated.foraging.nodes.length > 1); assert.ok(migrated.experiments.subjects.seedling);
  assert.ok(EFFECT_PROPERTIES.every(key => migrated.pendingBottle[key] === 0));
});

test('save validation rejects corrupted resources, subjects and observed samples', () => {
  const world = generateWorld('validation-domain'), state = newShop(world), brew = new BrewingSession(world.ingredients);
  runExperiment(state, potion({ freeze: .8 }), 'beetle', 5, 100);
  const original = JSON.parse(encodeSave(state, brew));
  const patches = [raw => { raw.foraging.nodes[1].stock = -1; }, raw => { raw.experiments.subjects.rabbit.stats.health = NaN; },
    raw => { raw.experiments.records[0].sample.strength = 2; }, raw => { raw.mode = 'sandbox'; }];
  for (const patch of patches) { const corrupt = structuredClone(original); patch(corrupt); assert.throws(() => decodeSave(JSON.stringify(corrupt))); }
});

test('raw-ingredient customer witnesses include water and crushing and reproduce fully attainable targets', () => {
  const world = generateWorld('raw-orders'), equipment = { analyzer: true, reagents: 3, cauldron: 2, furnace: 1 };
  const orders = [1, 2, 5].map(completed => generateOrder(world, completed, equipment));
  assert.ok(orders.some(order => order.witness.crush));
  assert.ok(orders.some(order => order.requirements.some(requirement => EFFECT_PROPERTIES.includes(requirement.property))));
  for (const order of orders) {
    assert.ok(order.witness.portions.some(portion => portion.ingredientId === 1));
    const sample = simulateWitness(world, order.witness, equipment);
    close(sample.volume, order.volume); assert.equal(assessPotion(sample, order).quality, 100);
    if (order.witness.crush) assert.ok(EFFECT_PROPERTIES.some(property => sample[property] > .005), 'crushed raw ingredients must transfer observable effects into the drained liquid');
  }
});
