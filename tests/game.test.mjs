import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, validateWorld } from '../src/game/world.mjs';
import { BrewingSession } from '../src/game/brewing.mjs';
import { generateOrder, simulateWitness } from '../src/game/orders.mjs';
import { assessPotion, toleranceSimilarity, priceSale } from '../src/game/evaluation.mjs';
import { newShop, completeSale, nextCustomer, restock, buyUpgrade, recordDiscovery, guildLoan } from '../src/game/economy.mjs';
import { encodeSave, decodeSave, saveShop, loadShop, SAVE_KEY } from '../src/game/persistence.mjs';
import { FIXED_STEP } from '../src/game/contracts.mjs';
import { Phase } from '../src/simulation/Phase.mjs';
import { effectiveLiquidViscosity } from '../src/simulation/FluidSolver.mjs';

const world = generateWorld('test-guild');
function setup() { const state = newShop(world); return { state, brew: new BrewingSession(world.ingredients, state.equipment) }; }
function ticks(brew, n, stir = false) { for (let i = 0; i < n; i++) { if (stir) brew.assistStir(); brew.step(); } }
const close = (a, b, tolerance = .001) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

test('world seeds reproduce all ingredient properties, names and costs', () => {
  assert.deepEqual(world, generateWorld('test-guild'));
  assert.notDeepEqual(world.ingredients, generateWorld('another-guild').ingredients);
});
test('120 generated worlds always contain six safe, diverse starters and compatible mixtures', () => {
  for (let seed = 0; seed < 120; seed++) assert.ok(validateWorld(generateWorld('world-' + seed).ingredients).valid);
});
test('pour transfers exact ml and mass, debits stock, and caps capacity', () => {
  const { state, brew } = setup();
  assert.equal(brew.engine.env.dimensionMode, '2D');
  assert.equal(brew.pour(1, 60, state.inventory), 60);
  assert.equal(state.inventory[1], 180); close(brew.liquidVolume, 60);
  close(brew.engine.ps.totalMass(), world.ingredients[0].material.density * 60);
  assert.equal(brew.pour(1, 400, state.inventory), 140); close(brew.occupiedVolume, 200);
  assert.equal(brew.pour(1, 20, state.inventory), 0);
  for (let i = 0; i < brew.engine.ps.count; i++) assert.equal(brew.engine.ps.z[i], 0);
});
test('invalid pour operations consume neither stock nor mass', () => {
  const { state, brew } = setup();
  for (const ml of [0, -3, NaN, Infinity]) assert.equal(brew.pour(1, ml, state.inventory), 0);
  assert.equal(brew.pour(2000, 30, state.inventory), 0); assert.equal(state.inventory[1], 240);
});
test('spoon drag transfers local momentum and records only actual contact', () => {
  const { state, brew } = setup(); brew.pour(1, 40, state.inventory);
  const before = Array.from(brew.engine.ps.vx.subarray(0, 40));
  assert.ok(brew.stir({ x: -1.2, y: 1.1 }, { x: 4, y: 0 }, .05) > 0);
  assert.notDeepEqual(Array.from(brew.engine.ps.vx.subarray(0, 40)), before);
  const history = brew.history.stirred;
  assert.equal(brew.stir({ x: 40, y: 40 }, { x: 4, y: 0 }), 0); assert.equal(brew.history.stirred, history);
});
test('flame supplies energy and frost removes it rather than assigning a temperature', () => {
  const { state, brew } = setup(); brew.pour(1, 60, state.inventory); ticks(brew, 30);
  const initial = brew.inspect().temperature; brew.setThermal(.35); ticks(brew, 40);
  const warm = brew.inspect().temperature; assert.ok(warm > initial + .02);
  assert.ok(brew.history.heatEnergy > 0); const viscosityWarm = brew.inspect().viscosity;
  brew.setThermal(0, .7); ticks(brew, 40); assert.ok(brew.inspect().temperature < warm);
  assert.ok(brew.inspect().viscosity > viscosityWarm); assert.ok(brew.history.coldEnergy > 0);
});
test('warming changes the viscosity used by the actual liquid solver', () => {
  const { state, brew } = setup(); brew.pour(1, 2, state.inventory); const ps = brew.engine.ps;
  ps.temperature[0] = .33; const atRoom = effectiveLiquidViscosity(ps, 0); close(atRoom, ps.viscosity[0]);
  ps.temperature[0] = .7; assert.ok(effectiveLiquidViscosity(ps, 0) < atRoom);
});
test('sample colour and density follow real unequal poured quantities', () => {
  const { state, brew } = setup(); brew.pour(1, 20, state.inventory); brew.pour(4, 60, state.inventory);
  const sample = brew.inspect(), expectedMass = world.ingredients[0].material.density * 20 + world.ingredients[3].material.density * 60;
  close(sample.density, expectedMass / 80); close(sample.mass, expectedMass);
  assert.notEqual(sample.color, world.ingredients[0].material.color);
});
test('compatible particles become more homogeneous with sustained stirring', () => {
  const { state, brew } = setup(); brew.pour(1, 40, state.inventory); brew.pour(2, 40, state.inventory);
  const initial = brew.inspect().stability; ticks(brew, 200, true);
  assert.ok(brew.inspect().stability > initial + 2); assert.ok(brew.history.reactions > 0);
});
test('incompatible substances stay less stable than a pure liquid', () => {
  const { state, brew } = setup(); brew.pour(1, 40, state.inventory); const pure = brew.inspect().stability;
  brew.pour(5, 40, state.inventory); ticks(brew, 100, true);
  assert.ok(brew.inspect().stability < pure - 5);
});
test('bottling drains exact liquid quantity and conserves mass on repeated fractional drains', () => {
  const { state, brew } = setup(); brew.pour(1, 100, state.inventory); ticks(brew, 50);
  const initial = brew.engine.ps.totalMass(), vial = brew.bottle(30);
  close(vial.volume, 30); close(brew.liquidVolume, 70); close(initial, vial.mass + brew.engine.ps.totalMass());
  const second = brew.bottle(40); close(second.volume, 40); close(brew.liquidVolume, 30);
  const third = brew.bottle(30); close(third.volume, 30); assert.equal(brew.engine.ps.count, 0);
  close(initial, vial.mass + second.mass + third.mass); close(vial.portions[0].ml, 30); close(second.portions[0].ml, 40);
});
test('bottle excludes gas and solids and does not fabricate missing quantity', () => {
  const { state, brew } = setup(); brew.pour(1, 60, state.inventory);
  for (let i = 0; i < 20; i++) brew.engine.ps.setPhase(i, i < 10 ? Phase.GAS : Phase.SOLID);
  const sample = brew.bottle(60); close(sample.volume, 40); assert.equal(sample.liquidFraction, 1); assert.equal(brew.engine.ps.count, 20);
  assert.deepEqual(sample.phases, [0, 40, 0]); close(sample.phaseMass[Phase.LIQUID], sample.mass);
});
test('overheating creates actual vapour losses and cooling can solidify a brew', () => {
  const hot = setup(); hot.brew.pour(1, 15, hot.state.inventory); hot.brew.setThermal(1); ticks(hot.brew, 400);
  assert.ok(hot.brew.history.evaporated > 0 || hot.brew.engine.ps.phaseCounts()[Phase.GAS] > 0);
  const cold = setup(); cold.brew.pour(1, 15, cold.state.inventory); cold.brew.setThermal(0, 1); ticks(cold.brew, 400);
  assert.ok(cold.brew.engine.ps.phaseCounts()[Phase.SOLID] > 0);
});
test('cleaning loses ingredients rather than refunding inventory or coins', () => {
  const { state, brew } = setup(); brew.pour(1, 60, state.inventory); const money = state.coins;
  const waste = brew.clean(); assert.equal(state.inventory[1], 180); assert.equal(state.coins, money);
  assert.ok(waste.ingredients > 0); assert.equal(brew.liquidVolume, 0); assert.throws(() => brew.bottle(60));
});
test('procedural orders are reproducible and their simulated witnesses score perfectly', () => {
  for (const seed of ['a', 'moonlight', 'dragon', 'frost']) {
    const w = generateWorld(seed), equipment = { analyzer: true, reagents: 3, cauldron: 2, furnace: 1 };
    for (let completed = 0; completed < 15; completed++) {
      const order = generateOrder(w, completed, equipment);
      assert.deepEqual(order, generateOrder(w, completed, equipment));
      const sample = simulateWitness(w, order.witness, equipment);
      close(sample.volume, order.volume); assert.equal(assessPotion(sample, order).quality, 100);
    }
  }
});
test('scoring gives continuously decreasing rewards around targets and respects priorities', () => {
  assert.equal(toleranceSimilarity(0, .1), 1);
  assert.ok(toleranceSimilarity(.05, .1) > toleranceSimilarity(.1, .1));
  assert.ok(toleranceSimilarity(.11, .1) > toleranceSimilarity(.3, .1));
  const { state, brew } = setup(); brew.pour(1, 60, state.inventory); const vial = brew.bottle(60);
  const perfect = assessPotion(vial, state.order); assert.equal(perfect.quality, 100);
  assert.ok(assessPotion({ ...vial, density: vial.density + .3 }, state.order).quality < 100);
  const order = { ...state.order, requirements: [{ property: 'temperature', target: .2, tolerance: .05, weight: 1, hard: true }] };
  assert.equal(assessPotion(vial, order).acceptable, false);
});
test('empty, tiny and overfilled samples cannot yield trivial money', () => {
  const { state, brew } = setup(); brew.pour(1, 120, state.inventory); const sample = brew.bottle(120);
  const ideal = priceSale(sample, state.order);
  assert.equal(ideal.payment, state.order.budget);
  assert.equal(priceSale(null, state.order).payment, 0);
  assert.equal(priceSale({ ...sample, volume: 1 }, state.order).payment, 0);
  assert.ok(priceSale({ ...sample, volume: 30 }, state.order).payment < ideal.payment);
  assert.equal(priceSale({ ...sample, volume: 4000 }, state.order, 100).payment, state.order.budget);
});
test('sale updates money, reputation and commissions exactly once and computes profit', () => {
  const { state, brew } = setup(); brew.pour(1, 60, state.inventory); state.pendingBottle = brew.bottle(60);
  const sale = completeSale(state); assert.equal(sale.quality, 100); assert.ok(sale.profit < sale.payment);
  close(state.coins, 80 + sale.payment - sale.expenses); assert.equal(state.completed, 1); assert.equal(state.reputation, 4);
  assert.throws(() => completeSale(state)); const coins = state.coins;
  state.pendingBottle = sale.sample; assert.throws(() => completeSale(state)); assert.equal(state.coins, coins);
  state.pendingBottle = null; assert.notEqual(nextCustomer(state).id, sale.orderId);
});
test('purchases debit coins, preserve stock, and unlock equipment and rare reagents', () => {
  const { state } = setup(); const initial = state.inventory[1]; const refill = restock(state, 1);
  assert.equal(state.inventory[1], initial + 60); close(state.coins, 80 - refill.cost);
  assert.throws(() => buyUpgrade(state, 0)); state.completed = 4; state.coins = 500;
  buyUpgrade(state, 0); assert.ok(state.equipment.densimeter); assert.throws(() => buyUpgrade(state, 0));
  buyUpgrade(state, 5); assert.equal(state.equipment.reagents, 1); assert.equal(state.inventory[7], 120);
});
test('recipe discoveries remember actual measurements and quantities', () => {
  const { state, brew } = setup(); brew.pour(1, 80, state.inventory); const sample = brew.bottle(60);
  const d = recordDiscovery(state, sample, 'Travelling tonic');
  assert.equal(d.name, 'Travelling tonic'); assert.equal(d.sample.volume, 60); assert.equal(d.sample.portions[0].ml, 60);
  sample.volume = 9; assert.equal(d.sample.volume, 60);
});
test('emergency supply loan cannot be repeated and is repaid from real sales', () => {
  const { state, brew } = setup(); assert.throws(() => guildLoan(state));
  state.coins = 0; for (const key of Object.keys(state.inventory)) state.inventory[key] = 0;
  guildLoan(state); assert.equal(state.coins, 25); assert.equal(state.debt, 30); assert.throws(() => guildLoan(state));
  restock(state, 1); brew.pour(1, 60, state.inventory); state.pendingBottle = brew.bottle(60);
  const sale = completeSale(state); assert.ok(sale.repayment > 0); assert.ok(state.debt < 30);
});
test('save/load preserves seed, stock, equipment, orders, full cauldron and pending vial', () => {
  const { state, brew } = setup(); brew.pour(1, 90, state.inventory); brew.setThermal(.35); ticks(brew, 40, true);
  state.pendingBottle = brew.bottle(60); state.stage = 'inspection'; recordDiscovery(state, state.pendingBottle, 'Warm moon');
  const saved = decodeSave(encodeSave(state, brew)); assert.deepEqual(saved.inventory, state.inventory);
  assert.deepEqual(saved.order, state.order); close(saved.pendingBottle.volume, 60);
  const restored = new BrewingSession(saved.world.ingredients, saved.equipment); restored.restore(saved.brew);
  close(restored.liquidVolume, brew.liquidVolume); close(restored.inspect().temperature, brew.inspect().temperature);
  close(restored.inspect().stability, brew.inspect().stability); close(restored.engine.ps.totalMass(), brew.engine.ps.totalMass());
  assert.equal(restored.heat, 0); // A resumed save never leaves a furnace unattended.
});
test('save migrations preserve progress, recover a good backup, reject corrupt and future data', () => {
  const { state, brew } = setup(); const text = encodeSave(state, brew), raw = JSON.parse(text); raw.version = 1;
  assert.equal(decodeSave(JSON.stringify(raw)).version, 2);
  const store = new Map(), storage = { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v) };
  saveShop(storage, state, brew); state.coins = 75; saveShop(storage, state, brew);
  store.set(SAVE_KEY, '{broken'); assert.equal(loadShop(storage).state.coins, 80);
  store.set(SAVE_KEY, JSON.stringify({ ...raw, version: 99 })); assert.equal(loadShop(storage).state, null);
  assert.throws(() => decodeSave(JSON.stringify({ ...raw, inventory: { 1: -40 } })));
  const invalid = brew.snapshot(); invalid.count = 30000; assert.throws(() => brew.restore(invalid));
});
test('complete repeated commissions through physics, assessment, sale and progression', () => {
  const { state } = setup();
  for (let i = 0; i < 7; i++) {
    const brew = new BrewingSession(world.ingredients, state.equipment), recipe = state.order.witness;
    for (const p of recipe.portions) { if (state.inventory[p.ingredientId] < p.ml) restock(state, p.ingredientId, 120); brew.pour(p.ingredientId, p.ml, state.inventory); }
    for (let tick = 0; tick < recipe.ticks; tick++) { brew.setThermal(tick < recipe.thermalTicks ? recipe.heat : 0, tick < recipe.thermalTicks ? recipe.cool : 0); if (recipe.stir && tick > 20) brew.assistStir(FIXED_STEP); brew.step(); }
    state.pendingBottle = brew.bottle(recipe.volume); const sale = completeSale(state);
    assert.equal(sale.quality, 100); assert.ok(sale.profit > 0); assert.equal(state.completed, i + 1);
    if (i === 0) buyUpgrade(state, 0); if (i === 2) buyUpgrade(state, 2); if (i === 4) buyUpgrade(state, 4);
    nextCustomer(state);
  }
  assert.equal(state.equipment.cauldron, 1); assert.ok(state.coins > 80); assert.ok(state.reputation > 20);
});
