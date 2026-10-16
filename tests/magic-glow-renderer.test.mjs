import test from 'node:test';
import assert from 'node:assert/strict';
import { LaboratoryRenderer } from '../src/game/LaboratoryRenderer.mjs';
import { EFFECT_PROPERTIES } from '../src/game/effects.mjs';
import { mixedMagicGlow, particleMagicAuras, paintParticleMagicLights } from '../src/game/magicLight.mjs';
import { magicGlowSprite } from '../src/game/art.mjs';
import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';
import { sanitizeMaterial } from '../src/materials/MaterialDefinition.mjs';
import { MixtureSolver } from '../src/reactions/MixtureSolver.mjs';
import { Phase } from '../src/simulation/Phase.mjs';

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


test('every enchanted parcel contributes a local glow pixel, not only the 160 broad halo samples', () => {
  const { ps } = setup(480);
  ps.strength.fill(.3);
  ps.poison.fill(.65);
  ps.x.fill(0);ps.y.fill(0);
  const auras = particleMagicAuras(ps);
  const pixels = new Uint8ClampedArray(64*64*4);
  assert.equal(paintParticleMagicLights(ps, {cx:32,cy:32,w:64,h:64,scale:40}, pixels, auras), 480);
  const center = (32*64+32)*4;
  assert.ok(pixels[center+3]>0,'the local light is rendered to real pixels');
  assert.ok(pixels[center]>0&&pixels[center+1]>0&&pixels[center+2]>0,'multi-effect light carries a blended hue');
  pixels.fill(0);
  assert.equal(paintParticleMagicLights(ps, {cx:32,cy:32,w:64,h:64,scale:40}, pixels, auras,0),0);
  assert.equal(pixels[center+3],0,'effect scaling zero disables per-particle glow');
});

test('mixture glow converges with its local fields without a batch-wide hue switch', () => {
  const { ps } = setup(3);
  ps.mixtureGroup = new Uint32Array([1,1,2]);
  ps.mixtureProgress.fill(.95);
  ps.strength.set([.34,.35,.1]);
  ps.poison.set([.65,.64,.8]);
  const groups = {
    root(id){return id===1?{id:1,arcaneRecipe:{sourceCount:2}}:{id:2,arcaneRecipe:{sourceCount:1}};}
  };
  const glows=particleMagicAuras(ps,groups);
  assert.ok(glows[0]&&glows[1]&&glows[2]);
  assert.deepEqual(glows[0],mixedMagicGlow(ps,0));
  assert.deepEqual(glows[1],mixedMagicGlow(ps,1));
  assert.equal(glows[0].color,glows[1].color,'nearly equal concentrations have nearly equal colours');
  ps.strength[1]=ps.strength[0];ps.poison[1]=ps.poison[0];
  const homogeneous=particleMagicAuras(ps,groups);
  assert.deepEqual(homogeneous[0],homogeneous[1],'identical live concentrations have identical emission');
  assert.notEqual(glows[0].color,glows[2].color,'a separate potion must retain its own color');
  ps.mixtureProgress[1]=0;
  const unmixed=particleMagicAuras(ps,groups);
  assert.notStrictEqual(unmixed[0],unmixed[1],'unmixed ingredients must NOT inherit a false homogeneous aura');
});

test('local magic exists for gas and powder particles even if they are skipped by the broad bloom budget', () => {
  const {ps}=setup(3);
  ps.x.set([-1,0,1]);ps.poison.fill(.65);
  ps.phase = new Int32Array([0,1,2]); // gas, liquid, solid in native phase order
  ps.powderContent = new Float32Array([0,0,1]);
  const auras=particleMagicAuras(ps);
  const pixels=new Uint8ClampedArray(160*80*4);
  assert.equal(paintParticleMagicLights(ps,{cx:80,cy:40,w:160,h:80,scale:40},pixels,auras),3);
  for(const x of [40,80,120]) assert.ok(pixels[(40*160+x)*4+3]>0,'each physical phase receives its own glow');
});

test('weak magic and every effect scale linearly without a brightness floor or a visibility cutoff', () => {
  for (const key of EFFECT_PROPERTIES) {
    const { ps, images, draw } = setup();
    ps[key][0] = .005; draw(); const weak = mixedMagicGlow(ps, 0);
    ps[key][0] = .01; draw(); const strong = mixedMagicGlow(ps, 0);
    assert.ok(weak && strong, `${key} must not suddenly appear at 1.5%`);
    assert.equal(strong.intensity, weak.intensity * 2);
    assert.ok(Math.abs(images[1].alpha - images[0].alpha * 2) < 1e-6);
    ps[key][0] = 0; assert.equal(mixedMagicGlow(ps, 0), null);
  }
});

test('homogeneous fallback glow is independent of overlapping parcel count and follows actual power', () => {
  const glowPixel = (count, power) => {
    const { ps } = setup(count); ps.poison.fill(power);
    const pixels = new Uint8ClampedArray(32 * 32 * 4);
    for (let i = 0; i < pixels.length; i += 4) { pixels[i] = pixels[i + 1] = pixels[i + 2] = 60; pixels[i + 3] = 255; }
    paintParticleMagicLights(ps, { cx: 16, cy: 16, w: 32, h: 32, scale: 40 }, pixels, particleMagicAuras(ps));
    return Array.from(pixels.subarray((16 * 32 + 16) * 4, (16 * 32 + 16) * 4 + 3));
  };
  assert.deepEqual(glowPixel(1, .2), glowPixel(100, .2), 'overlap must not overexpose the potion');
  const weak = glowPixel(1, .1), strong = glowPixel(1, .2);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs((strong[k] - 60) - 2 * (weak[k] - 60)) <= 1);
});

test('recipe membership and old homogeneity thresholds cannot recolour unmixed local magic', () => {
  const { ps } = setup(2); ps.mixtureGroup = new Int32Array([1, 1]);
  ps.strength.set([.1, .16]); ps.poison.set([.14, .08]);
  const mixtures = { root: () => ({ id: 1, arcaneRecipe: { sourceCount: 2 } }) };
  ps.mixtureProgress.fill(.349); const before = particleMagicAuras(ps, mixtures);
  ps.mixtureProgress.fill(.351); const after = particleMagicAuras(ps, mixtures);
  assert.deepEqual(after, before, 'a progress threshold cannot replace live local colours');
  assert.notDeepEqual(after[0], after[1], 'spatially separated concentrations keep their own hue');
});

test('real local mixing conserves magical emission and converges to a homogeneous hue and power', () => {
  const a = sanitizeMaterial({ id: 1, strength: .24, poison: 0, miscibility: .4 });
  const b = sanitizeMaterial({ id: 2, strength: 0, poison: .12, miscibility: .4 });
  const ps = new ParticleSystem(2), mixtures = new MixtureSolver();
  mixtures.materials = new Map([[1, a], [2, b]]);
  ps.add({ x: -.1, y: 0, z: 0, mass: .5 }, a, Phase.LIQUID);
  ps.add({ x: .1, y: 0, z: 0, mass: 1 }, b, Phase.LIQUID);
  const energy = () => {
    const auras = particleMagicAuras(ps, mixtures), sum = [0, 0, 0];
    for (let i = 0; i < 2; i++) for (let k = 0; k < 3; k++)
      sum[k] += auras[i].unquantized[k] * auras[i].intensity * ps.mixtureAmount[i];
    return sum;
  };
  const before = energy();
  for (let tick = 0; tick < 120; tick++) {
    ps.stirActivity.fill(1); mixtures.beginFrame(ps);
    mixtures.contact(ps, 0, 1, .7, .12, .025); mixtures.finishFrame(ps, {}, .025);
  }
  const auras = particleMagicAuras(ps, mixtures), after = energy();
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(after[k] - before[k]) < .0001, 'mixing must conserve the light contribution of each live effect');
    assert.ok(Math.abs(auras[0].unquantized[k] - auras[1].unquantized[k]) < .001);
  }
  assert.ok(Math.abs(auras[0].intensity - auras[1].intensity) < .00001);
});
