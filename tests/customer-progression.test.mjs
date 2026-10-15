import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/game/world.mjs';
import { generateOrder, simulateWitness } from '../src/game/orders.mjs';
import { assessPotion } from '../src/game/evaluation.mjs';

test('early commissions require 8–15% magic and tightly cap every unwanted effect', () => {
  for (const seed of ['a', 'moonlight', 'test-guild']) {
    const world = generateWorld(seed);
    for (let completed = 0; completed < 6; completed++) {
      const order = generateOrder(world, completed, {cauldron:1, reagents:3});
      const wanted = order.requirements.filter(r => r.comparison === 'target');
      const unwanted = order.requirements.filter(r => r.comparison === 'maximum');
      assert.ok(wanted.length, 'each commission must demand an effect');
      assert.ok(wanted.every(r => r.target >= .08 && r.target <= .15), 'early desired range is 8–15%');
      assert.ok(unwanted.every(r => r.target + r.tolerance <= .015 && r.hard), 'unwanted limit at most 1.5%');
      const outcome = assessPotion(simulateWitness(world, order.witness, {cauldron:1, reagents:3}), order);
      assert.deepEqual(outcome.hardFailures, [], 'the validated witness must not violate minimum effects or side-effect ceilings');
      assert.ok(outcome.quality >= 80, 'early witnesses must work in the real cauldron');
    }
  }
});

test('later commissions increase wanted effect thresholds without easing unwanted limits', () => {
  const world = generateWorld('progression-check');
  for (const completed of [6, 8, 12, 14]) {
    const equipment = {cauldron:2, reagents:3, furnace:1};
    const order = generateOrder(world, completed, equipment);
    assert.ok(order.requirements.some(r => r.comparison === 'target' && r.target > .15));
    assert.ok(order.requirements.filter(r => r.comparison === 'maximum').every(r => r.target + r.tolerance <= .015));
    const result = assessPotion(simulateWitness(world, order.witness, equipment), order);
    assert.equal(result.hardFailures.length, 0, 'the high-level target remains achievable');
    assert.ok(result.quality >= 80, 'powerful commissions have a simulated witness');
  }
});

test('combined stories describe one coherent scenario instead of splicing unrelated purposes', () => {
  const world = generateWorld('story-coherence');
  const examples = new Set();
  for (let i = 0; i < 12; i++) {
    const order = generateOrder(world, i, {cauldron:2, reagents:3});
    const wanted = order.requirements.filter(r => r.comparison === 'target').map(r => r.property);
    examples.add(order.customer.dialogue);
    assert.doesNotMatch(order.customer.dialogue,/and build strength for|and keep my lantern burning| and bring frost to the summer storeroom/);
    assert.ok(!wanted.includes('fire') || !wanted.includes('freeze'), 'fire and frost cannot be paired without a coherent use');
  }
  assert.ok(examples.size >= 8, 'many scenarios must be generated');
});
