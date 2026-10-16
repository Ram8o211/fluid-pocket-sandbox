import { effectiveParticleRadius } from '../simulation/FluidSolver.mjs';
import { isPowder } from '../simulation/PowderSolver.mjs';
import { Phase } from '../simulation/Phase.mjs';

// Each ImageData owns reusable density/colour scratch. Resizing replaces the
// pixel buffer, allowing the old scratch to be collected with it.
const liquidRasters = new WeakMap();
// Shared by the canvas fallback and GPU surface reconstruction.
export const LIQUID_SURFACE = Object.freeze({ radius: 2.1, cutoff: .25, edge: .25 });

function paintLiquidSurface(ps, t, pixels, particleColor, colorScratch) {
  let raster = liquidRasters.get(pixels);
  if (raster) {
    // Clear only last frame's occupied texels, including droplets that moved
    // or changed phase. Empty space costs no field scan or allocation.
    for (let n = 0; n < raster.count; n++) {
      const index = raster.touched[n] * 4;
      raster.field[index] = raster.field[index + 1] = raster.field[index + 2] = raster.field[index + 3] = 0;
    }
    raster.count = 0;
  }
  for (let i = 0; i < ps.count; i++) {
    if (ps.phase[i] !== Phase.LIQUID) continue;
    if (!raster) {
      raster = { field: new Float32Array(pixels.length), touched: new Uint32Array(t.w * t.h), count: 0 };
      liquidRasters.set(pixels, raster);
    }
    particleColor(ps, i, colorScratch);
    // A compact kernel joins touching parcels and closes packing pinholes.
    // Distant splashes stay separate; physical radius, mass and mixing never
    // change. Subpixel centres avoid a square footprint jumping each frame.
    const x = t.cx + ps.x[i] * t.scale, y = t.cy - ps.y[i] * t.scale;
    const radius = Math.max(1.25, effectiveParticleRadius(ps, i, true) * t.scale * LIQUID_SURFACE.radius);
    const inverseRadius2 = 1 / (radius * radius);
    const top = Math.max(0, Math.ceil(y - radius - .5)), bottom = Math.min(t.h - 1, Math.floor(y + radius - .5));
    const left = Math.max(0, Math.ceil(x - radius - .5)), right = Math.min(t.w - 1, Math.floor(x + radius - .5));
    const { field, touched } = raster;
    for (let py = top; py <= bottom; py++) {
      const dy = py + .5 - y, rowDistance2 = dy * dy, row = py * t.w;
      for (let px = left; px <= right; px++) {
        const dx = px + .5 - x, falloff = 1 - (dx * dx + rowDistance2) * inverseRadius2;
        if (falloff <= 0) continue;
        const weight = falloff * falloff, texel = row + px, index = texel * 4;
        if (field[index] === 0) touched[raster.count++] = texel;
        field[index] += weight;
        field[index + 1] += colorScratch.r * weight;
        field[index + 2] += colorScratch.g * weight;
        field[index + 3] += colorScratch.b * weight;
      }
    }
  }
  if (!raster) return;
  for (let n = 0; n < raster.count; n++) {
    const index = raster.touched[n] * 4, density = raster.field[index];
    // Opaque interiors, a narrow softened contour, and local weighted colour
    // replace per-particle noise and overlapping square outlines. This does
    // not average separated ingredients across the whole cauldron.
    const alpha = Math.min(1, Math.max(0, (density - LIQUID_SURFACE.cutoff) / LIQUID_SURFACE.edge));
    if (alpha === 0) continue;
    const texel = raster.touched[n], above = texel >= t.w ? raster.field[index - t.w * 4] : 0;
    const contour = Math.max(0, Math.min(1, (.8 - above) / .45));
    const shine = Math.max(0, Math.min(.18, (density - above) * .16)) * contour;
    const shade = .94 + shine;
    pixels[index] = raster.field[index + 1] / density * shade;
    pixels[index + 1] = raster.field[index + 2] / density * shade;
    pixels[index + 2] = raster.field[index + 3] / density * shade;
    pixels[index + 3] = alpha * 255;
  }
}

/** Paint all matter into one reusable RGBA buffer. Texels are always one pixel;
 * physical footprints and mass are independent of the display resolution.
 * This avoids thousands of canvas calls and colour strings every frame. */
export function paintMaterialParticles(ps, t, pixels, particleColor, colorScratch, rawSolids = null) {
  pixels.fill(0);
  paintLiquidSurface(ps, t, pixels, particleColor, colorScratch);
  for (let i = 0; i < ps.count; i++) {
    // Grains, coherent solids and translucent vapour retain their own texture
    // and sit over the reconstructed liquid, never entering its density field.
    if (ps.phase[i] === Phase.LIQUID) continue;
    if (ps.phase[i] === Phase.SOLID && ps.solidSubdivision[i] < .55 && rawSolids?.has(ps.materialId[i])) continue;
    particleColor(ps, i, colorScratch);
    const x = Math.round(t.cx + ps.x[i] * t.scale), y = Math.round(t.cy - ps.y[i] * t.scale);
    const phase = ps.phase[i], dry = isPowder(ps, i) && ps.powderContent[i] > .85;
    const diameter = Math.max(1, Math.ceil(effectiveParticleRadius(ps, i, true) * t.scale * 2));
    const variation = dry ? .13 : phase === Phase.SOLID ? .07 : .04;
    const alpha = phase === Phase.GAS ? .24 : .99;
    const originY = y - Math.floor(diameter / 2), originX = x - Math.floor(diameter / 2);
    const top = Math.max(0, originY), bottom = Math.min(t.h, originY + diameter);
    const left = Math.max(0, originX), right = Math.min(t.w, originX + diameter);
    for (let py = top; py < bottom; py++) for (let px = left; px < right; px++) {
      const ox = px - x, oy = py - y;
      const half = Math.max(1, diameter / 2);
      if ((ox + .5) ** 2 + (oy + .5) ** 2 > half * half + .5) continue;
      const hash = ((i * 67 + ox * 23 + oy * 41) >>> 0) % 11 - 5;
      const shade = 1 + variation * hash / 5 - oy / half * .08;
      const index = (py * t.w + px) * 4, oldAlpha = pixels[index + 3] / 255;
      if(oldAlpha===0){pixels[index]=colorScratch.r*shade;pixels[index+1]=colorScratch.g*shade;pixels[index+2]=colorScratch.b*shade;pixels[index+3]=alpha*255;continue;}
      const outAlpha = alpha + oldAlpha * (1 - alpha), oldWeight = oldAlpha * (1 - alpha);
      pixels[index] = (colorScratch.r * shade * alpha + pixels[index] * oldWeight) / outAlpha;
      pixels[index + 1] = (colorScratch.g * shade * alpha + pixels[index + 1] * oldWeight) / outAlpha;
      pixels[index + 2] = (colorScratch.b * shade * alpha + pixels[index + 2] * oldWeight) / outAlpha;
      pixels[index + 3] = outAlpha * 255;
    }
    // A single fine grit texel distinguishes touching grains without drawing
    // a connected solid skin, artificial outlines or large holes in the pile.
    if (dry && x >= 0 && x < t.w && y >= 0 && y < t.h) {
      const index = (y * t.w + x) * 4;
      pixels[index] *= .68; pixels[index + 1] *= .68; pixels[index + 2] *= .68;
    }
  }
  return ps.count;
}
