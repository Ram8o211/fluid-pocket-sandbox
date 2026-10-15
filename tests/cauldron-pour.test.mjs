import test from 'node:test';
import assert from 'node:assert/strict';
import { BrewingSession } from '../src/game/brewing.mjs';
import { insideCauldron } from '../src/game/cauldron.mjs';
import { generateLiquidWorld } from './helpers/liquid-world.mjs';
import { Phase } from '../src/simulation/Phase.mjs';

const create = () => new BrewingSession(generateLiquidWorld('controlled-pouring').ingredients);

test('a targeted dose is nearby, conserves inventory and mass, and never spawns an overlapping burst', () => {
  const b = create(), ps = b.engine.ps;
  const inventory = { 1: 120 };
  assert.equal(b.pour(1, 20, inventory, { point: { x: 1.5, y: .4 } }), 20);
  assert.equal(inventory[1], 100);
  assert.equal(ps.count, 40);
  assert.equal(b.occupiedVolume, 20);
  assert.ok(ps.x.subarray(0, ps.count).every(x => x > .6), 'the pour lands near the chosen right-hand spot');
  for (let i = 0; i < ps.count; i++) {
    assert.ok(insideCauldron(ps.x[i], ps.y[i], .05), 'all droplets start inside the vessel');
    assert.ok(ps.vy[i] >= -.15 && ps.vy[i] <= 0, 'droplets have no artificial downward kick');
    for (let j = 0; j < i; j++)
      assert.ok(Math.hypot(ps.x[i]-ps.x[j], ps.y[i]-ps.y[j]) >= .093,
        'droplets do not start at overlapping coordinates');
  }
  b.dispose();
});

test('later pours choose unoccupied space and keep the old liquid at rest at the insertion instant', () => {
  const b = create(), ps = b.engine.ps;
  b.pour(1, 30, { 1: 100 }, { point: { x: -.65, y: -.15 } });
  const first = ps.count, initialPositions = Array.from({length:first},(_,i)=>[ps.x[i],ps.y[i]]);
  const initialVelocities = Array.from({length:first},(_,i)=>[ps.vx[i],ps.vy[i]]);
  b.pour(1, 20, { 1: 100 }, { point: { x: -.65, y: -.15 } });
  assert.equal(ps.count,100);
  for(let i=0;i<first;i++){
    assert.deepEqual([ps.x[i],ps.y[i]],initialPositions[i], 'incoming ingredients cannot teleport prior fluid');
    assert.deepEqual([ps.vx[i],ps.vy[i]],initialVelocities[i], 'pouring cannot impart instantaneous impulses to the old brew');
  }
  assert.ok(Array.from({length:ps.count-first},(_,offset)=>first+offset)
    .every(i=>Array.from({length:first},(_,j)=>Math.hypot(ps.x[i]-ps.x[j],ps.y[i]-ps.y[j])>=.081)
      .every(Boolean)), 'incoming parcels avoid settled matter');
  b.dispose();
});

test('powders stay solid, start calmly and preserve their dose after a liquid pour', () => {
  const b = create(), ps = b.engine.ps;
  assert.equal(b.pour(1, 40, {1:100}),40);
  const initial = ps.count;
  assert.equal(b.pour(10, 10, {10:100}, {point:{x:0,y:.9}}), 10);
  assert.equal(ps.count-initial,20);
  for(let i=initial;i<ps.count;i++){
    assert.equal(ps.phase[i],Phase.SOLID);
    assert.equal(ps.solidSubdivision[i],1);
    assert.ok(Math.abs(ps.vx[i])<.001 && Math.abs(ps.vy[i])<.15);
  }
  assert.ok(Math.abs(b.occupiedVolume-50)<.01);
  b.dispose();
});
