import { performance } from 'node:perf_hooks';
import { generateWorld } from '../src/game/world.mjs';
import { BrewingSession } from '../src/game/brewing.mjs';
const world = generateWorld('benchmark-guild');
for (const volume of [60, 200, 440]) {
  const brew = new BrewingSession(world.ingredients, { cauldron: 2 }), inventory = { 1: 500, 2: 500 };
  brew.pour(1, volume / 2, inventory); brew.pour(2, volume / 2, inventory);
  for (let i = 0; i < 80; i++) { brew.assistStir(); brew.step(); }
  const times = [];
  for (let i = 0; i < 160; i++) { const start = performance.now(); brew.assistStir(); brew.step(); if (i % 8 === 0) brew.inspect(); times.push(performance.now() - start); }
  times.sort((a, b) => a - b);
  console.log(`${volume} ml / ${brew.engine.ps.count} particles: median ${times[80].toFixed(2)} ms, p95 ${times[152].toFixed(2)} ms per 40 Hz physics step (${brew.engine.stats.performanceTier})`);
}
