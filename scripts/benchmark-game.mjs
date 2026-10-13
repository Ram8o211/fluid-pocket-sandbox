import { performance } from 'node:perf_hooks';
import { generateWorld } from '../src/game/world.mjs';
import { BrewingSession } from '../src/game/brewing.mjs';

const world = generateWorld('benchmark-guild');
for (const form of ['Infusion', 'Sand', 'Dough']) for (const volume of [60, 200, 440]) {
  const brew = new BrewingSession(world.ingredients, { cauldron: 2 });
  const inventory = { 1: 500, 2: 500, 10: 500, 11: 500 };
  if (form === 'Infusion') {
    const rawMl = Math.max(1, Math.round(volume * .12));
    brew.pour(2, rawMl, inventory, { crushed: true });
    brew.pour(1, volume - rawMl, inventory);
  } else if (form === 'Sand') {
    brew.pour(10, volume / 2, inventory, { crushed: true });
    brew.pour(11, volume / 2, inventory);
  } else {
    brew.pour(10, volume / 2, inventory, { crushed: true });
    brew.pour(1, volume / 2, inventory);
  }
  for (let i = 0; i < (form === 'Sand' ? 400 : 160); i++) {
    if (form !== 'Sand') brew.assistStir();
    brew.step();
  }
  const times = [];
  for (let i = 0; i < 160; i++) {
    const start = performance.now();
    if (form !== 'Sand') brew.assistStir();
    brew.step();
    if (i % 8 === 0) brew.inspect();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.log(`${form}: ${volume} ml / ${brew.engine.ps.count} particles: median ${times[80].toFixed(2)} ms, p95 ${times[152].toFixed(2)} ms per 40 Hz physics step (${brew.engine.stats.performanceTier})`);
}
