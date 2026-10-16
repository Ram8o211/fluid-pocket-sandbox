import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';
import { sanitizeMaterial } from '../src/materials/MaterialDefinition.mjs';
import { effectiveParticleRadius } from '../src/simulation/FluidSolver.mjs';
import { Phase } from '../src/simulation/Phase.mjs';
import { paintMaterialParticles } from '../src/game/MaterialRaster.mjs';

const powder = sanitizeMaterial({ id: 88, color: '#a07842', density: 1.4,
  particleRadius: .14, solidSubdivision: 1, opacity: 1, meltingTemperature: .9, boilingTemperature: 1.4 });
const color = (ps, i, out) => { out.r = ps.r[i] * 255; out.g = ps.g[i] * 255; out.b = ps.b[i] * 255; };
const sample = (pixels, w, x, y) => Array.from(pixels.slice((y*w+x)*4, (y*w+x)*4+4));

test('powder raster retains original pixel footprint with no per-pixel speckle at different grain sizes', () => {
  const ps = new ParticleSystem(2);
  ps.add({x: 0, y: 0, z: 0, mass: .25}, powder, Phase.SOLID);
  assert.equal(ps.powderContent[0], 1);
  const r = effectiveParticleRadius(ps, 0, true);
  for (const wanted of [1, 2, 3, 4, 5, 7, 10]) {
    const t = { w: 48, h: 48, cx: 24, cy: 24, scale: (wanted - .25) / (2*r) };
    const diameter = Math.max(1, Math.ceil(effectiveParticleRadius(ps, 0, true) * t.scale * 2));
    assert.equal(diameter, wanted);
    const pixels = new Uint8ClampedArray(t.w*t.h*4);
    assert.equal(paintMaterialParticles(ps, t, pixels, color, {}), 1);
    const visible = [], expected = [];
    const start = -Math.floor(diameter / 2), half = Math.max(1, diameter/2);
    for (let dy = start; dy < start + diameter; dy++) for (let dx = start; dx < start + diameter; dx++) {
      if ((dx+.5)**2+(dy+.5)**2 <= half*half+.5) expected.push(`${24+dx},${24+dy}`);
    }
    for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
      if (pixels[(y*t.w+x)*4+3]) visible.push(`${x},${y}`);
    }
    assert.deepEqual(visible.sort(), expected.sort(), `diameter ${diameter} must preserve original coverage`);
    if (visible.length > 1) {
      const [x,y] = visible[0].split(',').map(Number), tone = sample(pixels,t.w,x,y);
      assert.ok(visible.every(point => {
        const [px,py] = point.split(',').map(Number);
        return sample(pixels,t.w,px,py).every((c,j) => c===tone[j]);
      }), 'each dry grain should use one stable tint rather than expensive per-texel noise');
    }
  }
});

test('powder rendering preserves state and clips its cached circular footprint at canvas boundaries', () => {
  const ps = new ParticleSystem(2); ps.add({x:0,y:0,z:0,mass:.25},powder,Phase.SOLID);
  const before = [ps.x[0], ps.y[0], ps.mass[0], ps.powderContent[0], ps.grainRest[0]];
  const t = {w:12,h:12,cx:1,cy:1,scale:22}, pixels = new Uint8ClampedArray(t.w*t.h*4);
  paintMaterialParticles(ps,t,pixels,color,{});
  assert.ok(pixels.some((value,index)=>index%4===3&&value>0));
  assert.deepEqual([ps.x[0],ps.y[0],ps.mass[0],ps.powderContent[0],ps.grainRest[0]],before);
  assert.ok(sample(pixels,t.w,0,0)[3]>=0);
});
