import test from 'node:test';
import assert from 'node:assert/strict';
import { LaboratoryRenderer } from '../src/game/LaboratoryRenderer.mjs';
import { EFFECT_PROPERTIES } from '../src/game/effects.mjs';
import { mixedMagicGlow } from '../src/game/magicLight.mjs';
import { magicGlowSprite } from '../src/game/art.mjs';

function setup(count = 1, quality = 'balanced', scale = 40) {
  const ps = { count };
  for (const key of ['x', 'y', 'vx', 'vy', 'mass', 'particleRadius', 'temperature', 'mixtureProgress', ...EFFECT_PROPERTIES]) ps[key] = new Float32Array(count);
  ps.mass.fill(.25); ps.particleRadius.fill(.1); ps.temperature.fill(.28);
  const cachedSprites = new Map();
  const renderer = { sim: { ps, time: 0 }, quality, getGlowSprite: colour => {
    if (!cachedSprites.has(colour)) cachedSprites.set(colour, { key: colour });
    return cachedSprites.get(colour);
  }, magicColor: new Array(160),
    magicX: new Float32Array(160), magicY: new Float32Array(160),
    magicIntensity: new Float32Array(160), magicCount: 0 };
  const images = [], ctx = { save() {}, restore() {}, drawImage(sprite, x, y, w, h) { images.push({ sprite, x, y, w, h, alpha: this.globalAlpha }); } };
  const draw = () => LaboratoryRenderer.prototype.drawMagicGlows.call(renderer, ctx, { cx: 192 * scale / 40, cy: 158 * scale / 40, scale });
  return { ps, renderer, images, draw };
}

test('latent magic glows before mixing and follows the parcel dominant property', () => {
  const { ps, renderer, images, draw } = setup();
  ps.love[0] = .35; ps.freeze[0] = .8;
  draw();
  assert.equal(images.length, 1);
  assert.equal(images[0].sprite.key, mixedMagicGlow(ps, 0).color);
  assert.ok(images[0].alpha > .1);
  assert.equal(renderer.magicCount, 1);
  assert.equal(ps.mixtureProgress[0], 0);
  assert.equal(ps.freeze[0], Math.fround(.8));
});

test('plain water renders no magic and activity brightens the same latent property', () => {
  const { ps, images, draw } = setup(); draw(); assert.equal(images.length, 0);
  ps.strength[0] = .7; draw(); const quiet = images[0];
  ps.temperature[0] = .8; ps.vx[0] = 2; ps.mixtureProgress[0] = .6;
  draw(); const active = images[1];
  assert.equal(active.sprite, quiet.sprite);
  assert.ok(active.alpha > quiet.alpha);
  assert.ok(active.w > quiet.w);
});

test('large magical brews respect fixed glow budgets, including battery saver', () => {
  for (const [quality, maximum] of [['balanced', 160], ['eco', 48]]) {
    const { ps, renderer, images, draw } = setup(12000, quality);
    ps.transformation.fill(.8); draw();
    assert.ok(images.length > 0 && images.length <= maximum);
    assert.equal(renderer.magicCount, images.length);
    assert.ok(images.every(image => image.w < (quality === 'eco' ? 18 : 28)));
  }
});

test('high-DPR glow footprints scale with the crisp material raster without increasing draw budgets', () => {
  const normal = setup(12000), crisp = setup(12000, 'balanced', 80);
  normal.ps.love.fill(.8); crisp.ps.love.fill(.8); normal.draw(); crisp.draw();
  assert.equal(crisp.images.length, normal.images.length);
  assert.ok(crisp.images.length <= 160);
  assert.equal(crisp.images[0].w, normal.images[0].w * 2);
  assert.equal(crisp.images[0].x, normal.images[0].x * 2);
  assert.equal(crisp.images[0].y, normal.images[0].y * 2);
});

test('laboratory keeps upstream DPR sizing and a 384-pixel battery canvas', () => {
  const previousRatio = globalThis.devicePixelRatio;
  try {
    globalThis.devicePixelRatio = 3;
    const renderer = { quality: 'balanced', canvas: { width: 0, height: 0 } };
    LaboratoryRenderer.prototype.resize.call(renderer);
    assert.equal(renderer.canvas.width, 768); assert.equal(renderer.canvas.height, 464);
    renderer.quality = 'eco'; LaboratoryRenderer.prototype.resize.call(renderer);
    assert.equal(renderer.canvas.width, 384); assert.equal(renderer.canvas.height, 232);
  } finally { globalThis.devicePixelRatio = previousRatio; }
});

test('adaptive effects scale reduces glow work and disables both halo and shimmer at zero', () => {
  const { ps, renderer, images, draw } = setup(12000);
  ps.fire.fill(.8); renderer.graphics = { effectsScale: .25 }; draw();
  assert.ok(images.length > 0 && images.length <= 40);
  assert.ok(images.every(image => image.alpha < .2));
  renderer.graphics.effectsScale = 0; images.length = 0; draw();
  assert.equal(images.length, 0); assert.equal(renderer.magicCount, 0);
  // A direct effects render must also suppress stale sparkle marks when the
  // quality changes between the halo pass and the foreground-effects pass.
  renderer.magicCount = 2; renderer.sim.reactions = { eventCount: 0 };
  ps.combustionProgress = new Float32Array(ps.count); ps.combustionTemperature = new Float32Array(ps.count);
  let foreground = 0;
  const ctx = { save() {}, restore() {}, fillRect() { foreground++; } };
  LaboratoryRenderer.prototype.drawEffects.call(renderer, ctx, { cx: 192, cy: 158, scale: 40 });
  assert.equal(foreground, 0);
});

test('glow falloff is baked once and cached across particle frames', () => {
  const previousDocument = globalThis.document; let canvases = 0, texels = 0;
  globalThis.document = { createElement() { canvases++; return { getContext() { return { fillRect() { texels++; } }; } }; } };
  try {
    const first = magicGlowSprite('#bbee19'), second = magicGlowSprite('#bbee19');
    assert.equal(first, second); assert.equal(canvases, 1);
    assert.equal(first.width, 20); assert.equal(first.height, 20);
    assert.ok(texels > 200 && texels <= 400);
  } finally { globalThis.document = previousDocument; }
});


test('every magical property glows, including withering and venom', () => {
  const { ps, images, draw } = setup(2);
  ps.acidity[0] = .8; ps.poison[1] = .8;
  draw();
  assert.equal(images.length, 2);
  assert.equal(images[0].sprite.key, mixedMagicGlow(ps, 0).color);
  assert.equal(images[1].sprite.key, mixedMagicGlow(ps, 1).color);
  assert.notEqual(images[0].sprite.key, images[1].sprite.key);
});

test('multi-property glow blends color and brightness from the full recipe', () => {
  const { ps, images, draw } = setup();
  ps.strength[0] = .33; ps.poison[0] = .66;
  const blend = mixedMagicGlow(ps, 0);
  const venomOnly = { ...ps, strength: new Float32Array([0]) };
  assert.notEqual(blend.color, mixedMagicGlow(venomOnly, 0).color);
  assert.equal(blend.intensity, Math.fround(.33) + Math.fround(.66));
  draw();
  assert.equal(images[0].sprite.key, blend.color);
  assert.ok(images[0].alpha > .5, 'highly magical mixtures should visibly shine');
  ps.strength[0] = 0; ps.poison[0] = .1;
  draw();
  assert.ok(images[1].alpha < images[0].alpha, 'a weakly enchanted material has a weaker halo');
});
