import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';
import { sanitizeMaterial } from '../src/materials/MaterialDefinition.mjs';
import { effectiveParticleRadius } from '../src/simulation/FluidSolver.mjs';
import { Phase } from '../src/simulation/Phase.mjs';
import { paintMaterialParticles } from '../src/game/MaterialRaster.mjs';

const material = sanitizeMaterial({ id: 1, color: '#40a0c0', particleRadius: .105 });
const color = (ps, i, out) => { out.r = ps.r[i] * 255; out.g = ps.g[i] * 255; out.b = ps.b[i] * 255; };
const transform = scale => ({ w: scale * 4, h: scale * 3, cx: scale * 2, cy: scale * 1.5, scale });
function paint(ps, t, pixels = new Uint8ClampedArray(t.w * t.h * 4)) {
  assert.equal(paintMaterialParticles(ps, t, pixels, color, { r: 0, g: 0, b: 0 }), ps.count);
  return pixels;
}
function pixel(pixels, t, x, y) {
  const index = (Math.floor(t.cy - y * t.scale) * t.w + Math.floor(t.cx + x * t.scale)) * 4;
  return Array.from(pixels.subarray(index, index + 4));
}

test('touching liquid parcels form an opaque surface without packing holes at both resolutions', () => {
  for (const scale of [40, 80]) {
    const ps = new ParticleSystem(100); ps.packingScale = .58;
    ps.add({ x: 0, y: 0, z: 0, mass: .25 }, material, Phase.LIQUID);
    const radius = effectiveParticleRadius(ps, 0, true), spacing = radius * 2;
    ps.count = 0;
    for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
      ps.add({ x: x * spacing, y: y * spacing, z: 0, mass: .25 }, material, Phase.LIQUID);
    }
    const t = transform(scale), pixels = paint(ps, t);
    const reach = spacing * 3 * scale;
    for (let y = Math.ceil(t.cy - reach); y <= Math.floor(t.cy + reach); y++) {
      for (let x = Math.ceil(t.cx - reach); x <= Math.floor(t.cx + reach); x++) {
        assert.equal(pixels[(y * t.w + x) * 4 + 3], 255, 'interior texels must have no seams or pinholes');
      }
    }
  }
});

test('surface reconstruction keeps remote splashes and unmixed ingredient colours separate', () => {
  const ps = new ParticleSystem(2); ps.packingScale = .58;
  ps.add({ x: -.413, y: .007, z: 0, mass: .25 }, material, Phase.LIQUID);
  ps.add({ x: .417, y: -.009, z: 0, mass: .25 }, sanitizeMaterial({ ...material, id: 2, color: '#c04040' }), Phase.LIQUID);
  for (const scale of [40, 80]) {
    const t = transform(scale), pixels = paint(ps, t);
    assert.equal(pixel(pixels, t, 0, 0)[3], 0, 'separated droplets must not grow a connecting skin');
    const blue = pixel(pixels, t, -.413, .007), red = pixel(pixels, t, .417, -.009);
    assert.equal(blue[3],255); assert.equal(red[3],255);
    // Surface lighting may change brightness, but must preserve each isolated
    // ingredient's hue rather than mix it with the remote splash.
    assert.ok(Math.abs(blue[0]/blue[2] - 1/3) < .02 && Math.abs(blue[1]/blue[2] - 5/6) < .02);
    assert.ok(Math.abs(red[1]/red[0] - 1/3) < .02 && Math.abs(red[2]/red[0] - 1/3) < .02);
    assert.ok(pixels.some((value, i) => i % 4 === 3 && value > 0 && value < 255), 'droplets have a narrow softened contour');
  }
});

test('overlapping liquid colours are local and independent of particle draw order', () => {
  const first = new ParticleSystem(2), reversed = new ParticleSystem(2);
  const red = sanitizeMaterial({ ...material, id: 2, color: '#c04040' });
  first.add({ x: -.035, y: 0, z: 0, mass: .25 }, material, Phase.LIQUID);
  first.add({ x: .035, y: 0, z: 0, mass: .25 }, red, Phase.LIQUID);
  reversed.add({ x: .035, y: 0, z: 0, mass: .25 }, red, Phase.LIQUID);
  reversed.add({ x: -.035, y: 0, z: 0, mass: .25 }, material, Phase.LIQUID);
  const t = transform(80), a = paint(first, t), b = paint(reversed, t);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) <= 1, 'the last poured particle must not overwrite its neighbours');
  assert.deepEqual(Array.from(first.r.subarray(0, 2)), [Math.fround(64 / 255), Math.fround(192 / 255)], 'rendering must not alter simulated diffusion');
});

test('reused surface buffers erase moved, evaporated and removed liquid without ghost trails', () => {
  const ps = new ParticleSystem(1), t = transform(40);
  ps.add({ x: -.4, y: 0, z: 0, mass: .25 }, material, Phase.LIQUID);
  const pixels = paint(ps, t);
  ps.x[0] = .4; paint(ps, t, pixels);
  assert.equal(pixel(pixels, t, -.4, 0)[3], 0);
  assert.equal(pixel(pixels, t, .4, 0)[3], 255);
  ps.phase[0] = Phase.GAS; paint(ps, t, pixels);
  assert.ok(pixel(pixels, t, .4, 0)[3] < 100, 'evaporated matter stays translucent');
  ps.count = 0; paint(ps, t, pixels);
  assert.ok(pixels.every(value => value === 0));
  ps.count = 1; ps.phase[0] = Phase.LIQUID;
  const resized = transform(80); paint(ps, resized);
  paint(ps, t, pixels);
  assert.equal(pixel(pixels, t, .4, 0)[3], 255, 'changing graphics resolution must not leave stale scratch');
});

test('dry powder remains textured and does not acquire a continuous liquid skin', () => {
  const powder = sanitizeMaterial({ ...material, id: 3, solidSubdivision: 1, powderContent: 1 });
  const ps = new ParticleSystem(2); ps.packingScale = .58;
  ps.add({ x: -.12, y: 0, z: 0, mass: .25 }, powder, Phase.SOLID);
  ps.add({ x: .12, y: 0, z: 0, mass: .25 }, powder, Phase.SOLID);
  const t = transform(80), pixels = paint(ps, t), centre = pixel(pixels, t, -.12, 0);
  assert.equal(pixel(pixels, t, 0, 0)[3], 0, 'separate grains must keep their gaps');
  assert.ok(centre[0] < 64 && centre[1] < 160 && centre[2] < 192, 'fine grit remains visible');
});

test('native liquid visibly meets raw solids and powder at the actual fixture contact', () => {
  for (const scale of [20, 40, 80]) for (const subdivision of [.1, 1]) {
    const ps = new ParticleSystem(2); ps.packingScale = .6; ps.volumePacking = true;
    ps.nativeLiquidRadius = .039 * Math.sqrt(2);
    ps.add({ x: 0, y: 0, z: 0, mass: .5 }, material, Phase.SOLID);
    ps.solidSubdivision[0] = subdivision;
    const separation = effectiveParticleRadius(ps, 0, true) + ps.nativeLiquidRadius * 2;
    ps.add({ x: separation, y: 0, z: 0, mass: .5 }, material, Phase.LIQUID);
    const t = transform(scale), pixels = new Uint8ClampedArray(t.w * t.h * 4);
    paintMaterialParticles(ps, t, pixels, color, {}, new Map([[1, material]]));
    for (let x = t.cx; x <= Math.floor(t.cx + separation * scale); x++) {
      assert.ok(pixels[(Math.floor(t.cy) * t.w + x) * 4 + 3] >= 220,
        `a touching ${subdivision < .55 ? 'raw ingredient' : 'grain'} must not have a black halo at scale ${scale}`);
    }
  }
});
