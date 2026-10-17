import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

/** Isolated canvas fixtures use the actual shared renderer; they never inject
 * rabbits into the shop or change the real colony used by the acceptance run. */
export async function verifyRabbitEffectArtwork(page) {
  const result = await page.evaluate(async () => {
    const { rabbitArtwork, rabbitSprite, loadRabbitArtwork } = await import('./src/game/RabbitAssets.mjs');
    const { RABBIT_EFFECT_FILES, rabbitAppearance } = await import('./src/game/RabbitAppearance.mjs');
    const { createRabbitColony, RABBIT_THRESHOLDS } = await import('./src/game/rabbits.mjs');
    const { drawRabbit } = await import('./src/game/RabbitRenderer.mjs');
    await loadRabbitArtwork();
    const original = localStorage.getItem('alchemists-shop-sandbox-save');
    const decoded = Object.keys(RABBIT_EFFECT_FILES).every(key => {
      const image = rabbitArtwork(key);
      return image?.naturalWidth === 256 && image.naturalHeight === 192;
    });
    const create = () => createRabbitColony(1000).rabbits[0];
    const draw = (rabbit, now = 1000, time = 0, facing = 1) => {
      const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 180;
      drawRabbit(canvas.getContext('2d'), rabbit, 120, 162, 96, time, { reference: true, now, facing });
      return canvas;
    };
    const bodies = ['base', 'strength', 'transformation', 'acidity', 'fire'];
    const tiers = document.createElement('canvas'); tiers.width = 1200; tiers.height = 1000;
    const tc = tiers.getContext('2d'); tc.imageSmoothingEnabled = false;
    tc.fillStyle = '#102837'; tc.fillRect(0, 0, tiers.width, tiers.height);
    const stages = [];
    for (let row = 0; row < bodies.length; row++) {
      const signatures = [];
      for (let col = 0; col <= 4; col++) {
        const rabbit = create(), effect = bodies[row];
        if (effect !== 'base' && col) rabbit.exposure[effect] = (col - .5) / 4 * RABBIT_THRESHOLDS[effect];
        rabbit.activeFireUntil = 8000;
        const canvas = draw(rabbit); signatures.push(canvas.toDataURL());
        tc.drawImage(canvas, col * 240, row * 200 + 20);
        tc.fillStyle = '#f5d0a1'; tc.font = '14px monospace';
        tc.fillText(`${effect} · T${col}`, col * 240 + 10, row * 200 + 16);
      }
      stages.push({ effect: bodies[row], distinct: new Set(signatures).size });
    }
    const combinations = document.createElement('canvas'); combinations.width = 720; combinations.height = 1000;
    const cc = combinations.getContext('2d'); cc.imageSmoothingEnabled = false;
    cc.fillStyle = '#102837'; cc.fillRect(0, 0, combinations.width, combinations.height);
    const composed = [];
    for (let row = 0; row < bodies.length; row++) {
      const signatures = [];
      for (let col = 0; col < 3; col++) {
        const rabbit = create(), effect = bodies[row];
        if (effect !== 'base') rabbit.exposure[effect] = .875 * RABBIT_THRESHOLDS[effect];
        if (col) rabbit.exposure[col === 1 ? 'poison' : 'love'] = .625 * RABBIT_THRESHOLDS[col === 1 ? 'poison' : 'love'];
        rabbit.activeFireUntil = 8000;
        const canvas = draw(rabbit); signatures.push(canvas.toDataURL());
        cc.drawImage(canvas, col * 240, row * 200 + 20);
        cc.fillStyle = '#f5d0a1'; cc.font = '14px monospace';
        cc.fillText(`${effect} + ${['none', 'poison', 'love'][col]}`, col * 240 + 10, row * 200 + 16);
      }
      composed.push({ effect: bodies[row], distinct: new Set(signatures).size });
    }
    const mixed = create();
    Object.assign(mixed.exposure, { transformation: 1.9, strength: 1.2, acidity: .8, fire: .5, poison: .1, love: .2, freeze: .1, death: .1 });
    mixed.activeFireUntil = 8000;
    const allChannels = draw(mixed).toDataURL(), secondaryVisible = [];
    for (const effect of ['strength', 'acidity', 'fire', 'poison', 'love', 'freeze', 'death']) {
      const copy = structuredClone(mixed); copy.exposure[effect] = 0;
      secondaryVisible.push({ effect, visible: draw(copy).toDataURL() !== allChannels });
    }
    const mirrored = draw(mixed, 1000, 0, -1).toDataURL() !== allChannels;
    const active = create(); active.exposure.fire = 2; active.activeFireUntil = 5000;
    const fireExtinguished = draw(active, 4999).toDataURL() !== draw(active, 5000).toDataURL();
    const dead = structuredClone(mixed); dead.stats.alive = false; dead.deathAppearance = 'charred';
    const deadStill = draw(dead, 1000, 0).toDataURL() === draw(dead, 100000, 100000).toDataURL();
    // Compare the exact final transformed stage with its deceased counterpart.
    // Death may mute fur and close the eyes, but never flatten the anatomy.
    const sourcePixels = sprite => {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 192;
      const context = canvas.getContext('2d'); context.drawImage(sprite, 0, 0);
      return context.getImageData(0, 0, 256, 192).data;
    };
    const bodyBounds = rabbit => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 280;
      drawRabbit(canvas.getContext('2d'), rabbit, 160, 250, 96, 0, { reference: true, now: 1000 });
      const rgba = canvas.getContext('2d').getImageData(0, 0, 320, 280).data;
      let minX = 320, maxX = 0, minY = 280, maxY = 0;
      for (let y = 0; y < 242; y++) for (let x = 0; x < 320; x++) {
        if (!rgba[(y * 320 + x) * 4 + 3]) continue;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      return { width: maxX - minX + 1, height: maxY - minY + 1 };
    };
    const corpseShapes = ['strength', 'transformation', 'acidity', 'fire'].map(effect => {
      const live = create(); live.exposure[effect] = RABBIT_THRESHOLDS[effect] * .875;
      live.activeFireUntil = 0;
      const deceased = structuredClone(live);
      deceased.stats.alive = false;
      deceased.deathAppearance = effect === 'fire' ? 'charred' : 'collapsed';
      const aliveArt = sourcePixels(rabbitSprite(live, 0, 0, 0, false, rabbitAppearance(live, 1000)));
      const deadArt = sourcePixels(rabbitSprite(deceased, 0, 0, 0, effect === 'fire', rabbitAppearance(deceased, 1000)));
      let alphaErrors = 0, affectedPixels = 0;
      for (let i = 0; i < aliveArt.length; i += 4) {
        if (aliveArt[i + 3] !== deadArt[i + 3]) alphaErrors++;
        if (aliveArt[i + 3] && (aliveArt[i] !== deadArt[i] || aliveArt[i + 1] !== deadArt[i + 1] || aliveArt[i + 2] !== deadArt[i + 2])) affectedPixels++;
      }
      return { effect, alphaErrors, affectedPixels, live: bodyBounds(live), dead: bodyBounds(deceased) };
    });
    return { decoded, stages, composed, secondaryVisible, mirrored, fireExtinguished, deadStill, corpseShapes,
      unchanged: localStorage.getItem('alchemists-shop-sandbox-save') === original,
      body: rabbitAppearance(mixed, 1000).body,
      tiers: tiers.toDataURL(), combinations: combinations.toDataURL(), mixed: allChannels };
  });
  assert.equal(result.decoded, true, 'every supplied body and overlay decodes at its original resolution');
  for (const row of result.stages) assert.equal(row.distinct, row.effect === 'base' ? 1 : 5, `${row.effect}: untreated plus all four supplied tiers are distinct`);
  for (const row of result.composed) assert.equal(row.distinct, 3, `${row.effect} supports both real overlay channels`);
  for (const channel of result.secondaryVisible) assert.equal(channel.visible, true, `${channel.effect} survives simultaneous body effects`);
  assert.equal(result.body, 'transformation');
  assert.equal(result.mirrored, true); assert.equal(result.fireExtinguished, true);
  assert.equal(result.deadStill, true); assert.equal(result.unchanged, true);
  for (const shape of result.corpseShapes) {
    assert.equal(shape.alphaErrors, 0, `${shape.effect}: death must retain its source silhouette alpha`);
    assert.ok(shape.affectedPixels > 200, `${shape.effect}: corpse fur looks lifeless`);
    assert.ok(shape.dead.height >= shape.live.height * .78 && shape.dead.height <= shape.live.height * 1.25,
      `${shape.effect}: corpse must retain its transformed height`);
    assert.ok(shape.dead.width >= shape.live.width * .78 && shape.dead.width <= shape.live.width * 1.25,
      `${shape.effect}: corpse must retain its transformed width`);
  }
  for (const key of ['tiers', 'combinations', 'mixed']) {
    await writeFile(`test-results/rabbit-reference-${key}.png`, Buffer.from(result[key].split(',')[1], 'base64'));
  }
}
