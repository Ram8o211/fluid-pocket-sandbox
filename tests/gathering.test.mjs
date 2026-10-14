import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, migrateIngredients, validateWorld, availableIngredients } from '../src/game/world.mjs';
import { createForaging, resourceStatus, gatherIngredient } from '../src/game/gathering.mjs';

const NOW = 1700000000000;
function setup(mode = 'campaign') {
  const world = generateWorld('foraging-test');
  return { world, mode, equipment: { reagents: 0 }, inventory: Object.fromEntries(world.ingredients.map(i => [i.id, 0])), foraging: createForaging(world, NOW) };
}

test('fresh worlds provide neutral water and raw ingredients covering every effect family', () => {
  const effects = ['strength', 'love', 'death', 'transformation', 'fire', 'freeze', 'acidity', 'poison'];
  for (let seed = 0; seed < 120; seed++) {
    const world = generateWorld(`raw-${seed}`);
    assert.ok(validateWorld(world.ingredients).valid);
    const water = world.ingredients.find(i => i.id === 1);
    assert.equal(water.name, 'Plain Water'); assert.equal(water.form, 'liquid');
    assert.ok(water.solvent); assert.equal(water.crushable, false);
    for (const effect of effects) {
      assert.equal(water.material[effect], 0);
      assert.ok(world.ingredients.some(i => i.material[effect] > .5), `Missing ${effect}`);
    }
    for (const ingredient of world.ingredients.filter(i => i.form !== 'liquid' && i.form !== 'powder')) {
      assert.ok(ingredient.material.meltingTemperature > .36);
      assert.equal(ingredient.material.solidSubdivision, 0); assert.ok(ingredient.crushable);
    }
    assert.equal(world.ingredients.find(i => i.id === 11).material.solidSubdivision, 1);
    assert.deepEqual(availableIngredients(world, { reagents: 0 }).map(i => i.id), [1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 14]);
  }
});

test('foraging creates one spatial resource node per ingredient and reproducible stock', () => {
  const { world, foraging } = setup();
  assert.deepEqual(foraging, createForaging(world, NOW));
  assert.equal(foraging.nodes.length, world.ingredients.length);
  assert.equal(new Set(foraging.nodes.map(n => n.id)).size, foraging.nodes.length);
  assert.equal(new Set(foraging.nodes.map(n => n.ingredientId)).size, world.ingredients.length);
  for (const node of foraging.nodes) {
    assert.ok(node.x >= 0 && node.x <= 1 && node.y >= 0 && node.y <= 1);
    assert.equal(node.updatedAt, NOW); assert.equal(node.stock, node.capacity);
    assert.ok(node.unlimited || node.capacity > 0 && node.regrowMs > 0);
  }
});

test('gathering exhausts a finite patch and credits exactly the actual stock without coins', () => {
  const state = setup(); state.coins = 5;
  const node = state.foraging.nodes.find(n => n.ingredientId === 2);
  const result = gatherIngredient(state, node.id, 10000, NOW);
  assert.equal(result.quantity,10);
  gatherIngredient(state,node.id,10,NOW);
  assert.equal(state.inventory[2],node.capacity);
  assert.equal(result.remaining,10);
  // Two baskets exhaust the small bed.
  const final = resourceStatus(state,node.id,NOW);
  assert.equal(final.available,0);
  assert.equal(result.quantity*2, node.capacity); assert.equal(final.available, 0);
  assert.equal(state.inventory[2], node.capacity); assert.equal(state.coins, 5);
  assert.equal(state.foraging.collectedTotal, node.capacity);
  assert.ok(resourceStatus(state, node.id, NOW).depleted);
  assert.throws(() => gatherIngredient(state, node.id, 20, NOW), /ripen/);
  assert.equal(state.inventory[2], node.capacity);
});

test('depleted patches regrow gradually while untouched, cap at capacity and survive serialization', () => {
  const state = setup(), node = state.foraging.nodes.find(n => n.ingredientId === 3);
  node.stock=0;node.updatedAt=NOW;
  const depletedSnapshot = structuredClone(state.foraging);
  const halfway = NOW + node.regrowMs / 2;
  assert.equal(resourceStatus(state, node.id, halfway).available, node.capacity / 2);
  assert.deepEqual(state.foraging, depletedSnapshot, 'Reading regrowth must not write a timer or timestamp');
  const resumed = JSON.parse(JSON.stringify(state));
  assert.equal(gatherIngredient(resumed, node.id, 5, halfway).quantity, 5);
  assert.equal(resourceStatus(resumed, node.id, halfway).available, node.capacity / 2 - 5);
  assert.equal(resourceStatus(resumed, node.id, NOW + node.regrowMs * 20).available, node.capacity);
  assert.ok(Number.isFinite(resourceStatus(resumed, node.id, halfway).fullAt));
});

test('fractional regrowth is preserved across repeated gathering and clocks do not run backwards', () => {
  const state = setup(), node = state.foraging.nodes.find(n => n.ingredientId === 4);
  node.stock=0;node.updatedAt=NOW;
  const time = NOW + node.regrowMs * 5.5 / node.capacity;
  assert.equal(resourceStatus(state, node.id, time).available, 5);
  assert.equal(gatherIngredient(state, node.id, 5, time).quantity, 5);
  const after = resourceStatus(state, node.id, time);
  assert.ok(Math.abs(after.stock - .5) < 1e-9); assert.equal(after.available, 0);
  assert.equal(resourceStatus(state, node.id, NOW - 1000).available, 0);
  assert.equal(resourceStatus(state, node.id, after.nextReadyAt + 1).available, 5);
});

test('the spring provides renewable water freely and guild patches enforce ingredient unlocks', () => {
  const state = setup(), before = structuredClone(state.foraging.nodes.find(n => n.id === 'spring'));
  for (let i = 0; i < 3; i++) assert.equal(gatherIngredient(state, 'spring', 100, NOW).quantity, 100);
  assert.equal(state.inventory[1], 300);
  assert.deepEqual(state.foraging.nodes.find(n => n.id === 'spring'), before);
  const rare = state.foraging.nodes.find(n => n.ingredientId === 7);
  assert.ok(resourceStatus(state, rare.id, NOW).locked);
  assert.throws(() => gatherIngredient(state, rare.id, 20, NOW), /guild/);
  state.equipment.reagents = 1;
  assert.equal(resourceStatus(state, rare.id, NOW).locked, false);
  assert.equal(gatherIngredient(state, rare.id, 20, NOW).quantity, 10);
});

test('sandbox gathering is unlimited, grants locked ingredients and preserves every resource patch', () => {
  const state = setup('sandbox'), before = structuredClone(state.foraging.nodes);
  for (const node of state.foraging.nodes) {
    const status = resourceStatus(state, node.id, NOW);
    assert.ok(status.unlimited); assert.equal(status.locked, false);
    assert.equal(gatherIngredient(state, node.id, 1000, NOW).quantity, 1000);
    assert.equal(state.inventory[node.ingredientId], 1000);
  }
  assert.deepEqual(state.foraging.nodes, before);
  assert.ok(!JSON.stringify(state).includes('null'), 'Persisted stock must remain finite');
});

test('invalid gathering requests leave resource stocks and inventory unchanged', () => {
  const state = setup(), before = structuredClone(state);
  for (const quantity of [0, -1, NaN, Infinity]) assert.throws(() => gatherIngredient(state, 'grove-2', quantity, NOW));
  assert.throws(() => gatherIngredient(state, 'missing', 20, NOW));
  assert.deepEqual(state, before);
});

test('legacy ingredient migration preserves measured physics, names and supplied effects', () => {
  const world = generateWorld('legacy-pinned'), ingredient = world.ingredients[1];
  ingredient.name = 'Pinned Nectar'; ingredient.material.name = ingredient.name;
  ingredient.material.meltingTemperature = .12; ingredient.material.density = .791;
  ingredient.material.strength = .49;
  delete ingredient.form; delete ingredient.unit; delete ingredient.solvent;
  delete ingredient.crushable; delete ingredient.extractable; delete ingredient.appearance;
  delete ingredient.material.love;
  const before = structuredClone(world), migrated = migrateIngredients(world), pinned = migrated.ingredients[1];
  assert.deepEqual(world, before, 'Migration must not mutate the loaded save');
  assert.equal(pinned.name, 'Pinned Nectar'); assert.equal(pinned.form, 'liquid'); assert.ok(pinned.solvent);
  assert.equal(pinned.material.density, .791); assert.equal(pinned.material.meltingTemperature, .12);
  assert.equal(pinned.material.strength, .49); assert.equal(pinned.material.love, 0);
  assert.equal(pinned.crushable, false); assert.equal(pinned.unit, 'ml');
});
