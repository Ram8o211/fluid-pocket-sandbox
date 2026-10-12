import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/game/world.mjs';
import { BrewingSession } from '../src/game/brewing.mjs';

test('fresh brews cannot inherit magical activation from a previously emptied cauldron', () => {
  const world = generateWorld('history'), brew = new BrewingSession(world.ingredients);
  const inventory = { 1: 200 };
  brew.pour(1, 60, inventory); brew.setThermal(.35);
  for (let i = 0; i < 160; i++) brew.step();
  assert.ok(brew.history.activation > 0);
  brew.bottle(60); assert.equal(brew.history.activation, 0); assert.equal(brew.history.heatEnergy, 0);
  brew.pour(1, 60, inventory); assert.equal(brew.inspect().history.activation, 0);
});
test('adding fresh material dilutes prior activation by actual mass', () => {
  const world = generateWorld('history'), brew = new BrewingSession(world.ingredients);
  const inventory = { 1: 200 }; brew.pour(1, 50, inventory); brew.setThermal(.35);
  for (let i = 0; i < 160; i++) brew.step();
  const activation = brew.history.activation; brew.pour(1, 50, inventory);
  assert.ok(Math.abs(brew.history.activation - activation * .5) < .0001);
});
