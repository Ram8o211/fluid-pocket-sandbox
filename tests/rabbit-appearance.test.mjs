import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rabbitAppearance, rabbitEffectTier, RABBIT_EFFECT_FILES } from '../src/game/RabbitAppearance.mjs';
import { createRabbitColony, assessRabbitEffects, RABBIT_THRESHOLDS } from '../src/game/rabbits.mjs';

test('art stages agree with the simulation observation stages for every actual channel', () => {
  for (const threshold of Object.values(RABBIT_THRESHOLDS)) {
    for (const [fraction, tier] of [[0, 0], [.01, 1], [.249, 1], [.25, 2], [.499, 2], [.5, 3], [.749, 3], [.75, 4], [1, 4], [10, 4]]) {
      assert.equal(rabbitEffectTier(threshold * fraction, threshold), tier);
    }
    assert.equal(rabbitEffectTier(.003, threshold), 0);
    assert.equal(rabbitEffectTier(.0031, threshold), 1, 'a dilute first dose is visible');
    assert.equal(rabbitEffectTier(NaN, threshold), 0);
  }
});

test('repeated real doses advance the supplied anatomy without changing snapshots or gameplay', () => {
  const original = createRabbitColony(1000).rabbits[0];
  const first = assessRabbitEffects({ strength: .45, stability: 100 }, original, 5, 1000);
  const second = assessRabbitEffects({ strength: .45, stability: 100 }, first.afterRabbit, 5, 8000);
  assert.equal(rabbitAppearance(first.afterRabbit).bodyKey, 'strength_t01');
  assert.equal(rabbitAppearance(second.afterRabbit).bodyKey, 'strength_t02');
  const before = JSON.stringify([original, first, second]);
  for (let now = 1000; now < 15000; now += 100) rabbitAppearance(second.afterRabbit, now);
  assert.equal(JSON.stringify([original, first, second]), before);
  assert.equal(original.exposure.strength, 0);
});

test('all simultaneous body effects remain represented under a deterministic strongest-body policy', () => {
  const effects = ['strength', 'transformation', 'acidity', 'fire'];
  for (let mask = 1; mask < 16; mask++) {
    const rabbit = createRabbitColony(1000).rabbits[0];
    const active = effects.filter((_, index) => mask & 1 << index);
    for (const effect of active) rabbit.exposure[effect] = RABBIT_THRESHOLDS[effect] * .5;
    const view = rabbitAppearance(rabbit, 1000);
    assert.deepEqual([view.body, ...view.secondary].sort(), active.sort());
    assert.equal(new Set([view.body, ...view.secondary]).size, active.length);
    rabbit.exposure = Object.fromEntries(Object.entries(rabbit.exposure).reverse());
    assert.deepEqual(rabbitAppearance(rabbit, 1000), view, 'exposure key order cannot change the silhouette');
  }
  const rabbit = createRabbitColony(1000).rabbits[0];
  rabbit.exposure.strength = 1; rabbit.exposure.acidity = 1.5;
  assert.equal(rabbitAppearance(rabbit).body, 'acidity', 'compare channel-relative exposure, rather than raw concentration');
});

test('overlay layers coexist, hostility suppresses hearts, and no unmatched healing mechanic is invented', () => {
  const rabbit = createRabbitColony(1000).rabbits[0];
  rabbit.exposure.poison = .1; rabbit.exposure.love = .2;
  let view = rabbitAppearance(rabbit);
  assert.deepEqual(view.overlays.map(layer => layer.effect), ['poison', 'love']);
  rabbit.dangerous = true;
  assert.deepEqual(rabbitAppearance(rabbit).overlays.map(layer => layer.effect), ['poison']);
  rabbit.dangerous = false; rabbit.exposure = { healing: 1, bubbles: 1, sparkles: 1 };
  view = rabbitAppearance(rabbit);
  assert.equal(view.body, 'base'); assert.deepEqual(view.overlays, []);
  assert.ok(RABBIT_EFFECT_FILES.healing_t04, 'the unused supplied healing art remains available');
});

test('painted flames extinguish with the simulation and corpses never emit love or poison particles', () => {
  const rabbit = createRabbitColony(1000).rabbits[0];
  rabbit.exposure.fire = 2; rabbit.exposure.poison = .1; rabbit.exposure.love = .1;
  rabbit.activeFireUntil = 5000;
  assert.equal(rabbitAppearance(rabbit, 4999).bodyKey, 'fire_t04');
  const cooled = rabbitAppearance(rabbit, 5000);
  assert.equal(cooled.burning, false); assert.equal(cooled.bodyKey, 'fire_t01');
  assert.equal(cooled.tiers.fire, 4, 'persistent burn severity is retained');
  rabbit.stats.alive = false;
  assert.deepEqual(rabbitAppearance(rabbit, 1000).overlays, []);
  assert.equal(rabbitAppearance(rabbit, 1000).burning, false);
});

test('all supplied native-size layers are present and precached at Pages-relative URLs', async () => {
  const manifest = JSON.parse(await readFile('public/assets/rabbit-trials/effects/metadata/manifest.json', 'utf8'));
  const worker = await readFile('public/sw.js', 'utf8');
  assert.equal(Object.keys(RABBIT_EFFECT_FILES).length, 29);
  assert.deepEqual(new Set(Object.values(RABBIT_EFFECT_FILES)), new Set(manifest.assets.map(asset => asset.file)));
  for (const file of Object.values(RABBIT_EFFECT_FILES)) {
    const path = `public/assets/rabbit-trials/effects/${file}`;
    const png = await readFile(path);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 256); assert.equal(png.readUInt32BE(20), 192);
    assert.ok(worker.includes(`'./${path}'`), `${path} must work on the first offline reload`);
  }
  assert.ok(worker.includes("'./src/game/RabbitAppearance.mjs'"));
});
