import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/game/world.mjs';
import { newShop, restock, tradeStock, discardVial } from '../src/game/economy.mjs';
import { BrewingSession } from '../src/game/brewing.mjs';

test('stock trades give bankrupt players cash but cannot create a refill profit loop', () => {
  const state = newShop(generateWorld('recovery')); const initialCoins = state.coins;
  const purchase = restock(state, 1); const trade = tradeStock(state, 1);
  assert.ok(trade.payment < purchase.cost); assert.ok(state.coins < initialCoins);
  state.coins = 0; const previous = state.inventory[1]; tradeStock(state, 1);
  assert.ok(state.coins > 0); assert.equal(state.inventory[1], previous - 60);
  assert.throws(() => tradeStock(state, 1, -40));
});
test('discarding a rejected vial enables another attempt without refund or duplicate stock', () => {
  const state = newShop(generateWorld('recovery')), brew = new BrewingSession(state.world.ingredients);
  const orderId = state.order.id; brew.pour(1, 60, state.inventory);
  state.pendingBottle = brew.bottle(60); state.stage = 'inspection'; discardVial(state);
  assert.equal(state.pendingBottle, null); assert.equal(state.stage, 'brewing');
  assert.equal(state.coins, 80); assert.equal(state.completed, 0); assert.equal(state.order.id, orderId); assert.equal(state.inventory[1], 180);
  assert.throws(() => discardVial(state));
});
