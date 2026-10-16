import { effectiveParticleRadius } from '../simulation/FluidSolver.mjs';
import { isPowder } from '../simulation/PowderSolver.mjs';
import { Phase } from '../simulation/Phase.mjs';
import { phaseAppearance } from '../simulation/PhaseSolver.mjs';

// Each ImageData owns reusable density/colour scratch. Resizing replaces the
// pixel buffer, allowing the old scratch to be collected with it.
const liquidRasters = new WeakMap();
const vapourRasters = new WeakMap();
// Shared by the canvas fallback and GPU surface reconstruction. A translucent
// liquid body lets the cauldron interior and immersed ingredients remain visible.
export const LIQUID_SURFACE = Object.freeze({ radius: 2.1, cutoff: .25, edge: .25, opacity: .74 });
const FILLED_CONTOUR = Math.sqrt(1 - Math.sqrt(LIQUID_SURFACE.cutoff + LIQUID_SURFACE.edge));

/** LiquidFun contacts a fixture one liquid diameter from its surface. The
 * filled contour of the squared kernel must reach that same contact, rather
 * than ending at the smaller ingredient/grain radius. Shared by both paths. */
export function liquidSurfaceRadius(ps, i, scale) {
  // Retain the incoming droplet footprint when the last liquid parcel has
  // evaporated; the first recondensing parcel must not resize the whole field.
  const native = ps.frozenRadius?.[i] || ps.nativeLiquidRadius || (ps.volumePacking ? .039 * Math.sqrt(Math.max(.0001, ps.mixtureAmount[i]) / .25) : 0);
  return Math.max(1.25, effectiveParticleRadius(ps, i, true) * scale * LIQUID_SURFACE.radius,
    native > 0 ? (native * 2 * scale + .5) / FILLED_CONTOUR : 0);
}

export function frozenSurfaceWeight(ps, i, appearance) {
  return ps.frozenRadius[i] > 0 || (ps.phase[i] === Phase.LIQUID && ps.phaseTarget[i] === Phase.SOLID)
    ? appearance.solid : 0;
}

export function frostSurfaceColor(color, ice) {
  color.r += (210 - color.r) * ice * .13;
  color.g += (235 - color.g) * ice * .17;
  color.b += (250 - color.b) * ice * .21;
}

export function vapourSurfaceRadius(ps, i, scale) {
  // Preserve at least the former liquid's footprint, with soft overlapping
  // optical volumes instead of pinpricks in a thin lid strip.
  return Math.max(liquidSurfaceRadius(ps, i, scale) * 1.12,
    effectiveParticleRadius(ps, i, true) * scale * 4);
}

function frostShade(x, y, seed) {
  const facet = ((Math.floor(x * 8) * 3 + Math.floor(y * 8) * 5 + seed) % 13 + 13) % 13;
  return facet < 2 ? 1.08 : facet === 6 ? .94 : 1;
}

function paintPhaseSurface(ps, t, pixels, particleColor, colorScratch, vapour = false) {
  const appearance = { liquid: 0, solid: 0, gas: 0 };
  const rasters = vapour ? vapourRasters : liquidRasters;
  let raster = rasters.get(pixels);
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
    phaseAppearance(ps, i, appearance);
    // A crystallized pool keeps one smooth silhouette, never a cloud of
    // independent ice dots. A pending freeze uses the same surface throughout
    // its optical blend, before its rigid-body physics handoff.
    const ice = frozenSurfaceWeight(ps, i, appearance);
    const continuousWeight = vapour ? appearance.gas : appearance.liquid + ice;
    if (continuousWeight <= 0) continue;
    if (!raster) {
      raster = { field: new Float32Array(pixels.length), touched: new Uint32Array(t.w * t.h), count: 0 };
      rasters.set(pixels, raster);
    }
    particleColor(ps, i, colorScratch);
    if (!vapour) frostSurfaceColor(colorScratch, ice);
    // A compact kernel joins touching parcels and closes packing pinholes.
    // Distant splashes stay separate; physical radius, mass and mixing never
    // change. Subpixel centres avoid a square footprint jumping each frame.
    const x = t.cx + ps.x[i] * t.scale, y = t.cy - ps.y[i] * t.scale;
    const radius = vapour ? vapourSurfaceRadius(ps, i, t.scale) : liquidSurfaceRadius(ps, i, t.scale);
    const inverseRadius2 = 1 / (radius * radius);
    const top = Math.max(0, Math.ceil(y - radius - .5)), bottom = Math.min(t.h - 1, Math.floor(y + radius - .5));
    const left = Math.max(0, Math.ceil(x - radius - .5)), right = Math.min(t.w - 1, Math.floor(x + radius - .5));
    const { field, touched } = raster;
    for (let py = top; py <= bottom; py++) {
      const dy = py + .5 - y, rowDistance2 = dy * dy, row = py * t.w;
      for (let px = left; px <= right; px++) {
        const dx = px + .5 - x, falloff = 1 - (dx * dx + rowDistance2) * inverseRadius2;
        if (falloff <= 0) continue;
        const weight = falloff * falloff * continuousWeight, texel = row + px, index = texel * 4;
        if (field[index] === 0) touched[raster.count++] = texel;
        field[index] += weight;
        const shade = !vapour && ice > 0 ? 1 + (frostShade(dx / radius, -dy / radius, i) - 1) * ice : 1;
        field[index + 1] += colorScratch.r * shade * weight;
        field[index + 2] += colorScratch.g * shade * weight;
        field[index + 3] += colorScratch.b * shade * weight;
      }
    }
  }
  if (!raster) return;
  for (let n = 0; n < raster.count; n++) {
    const index = raster.touched[n] * 4, density = raster.field[index];
    // Translucent interiors, a narrow softened contour, and local weighted colour
    // replace per-particle noise and overlapping square outlines. This does
    // not average separated ingredients across the whole cauldron.
    const alpha = vapour ? Math.min(.76, 1 - Math.exp(-density * .28)) : LIQUID_SURFACE.opacity * Math.min(1, Math.max(0, (density - LIQUID_SURFACE.cutoff) / LIQUID_SURFACE.edge));
    if (alpha === 0) continue;
    const texel = raster.touched[n], above = texel >= t.w ? raster.field[index - t.w * 4] : 0;
    const contour = Math.max(0, Math.min(1, (.8 - above) / .45));
    const shine = Math.max(0, Math.min(.18, (density - above) * .16)) * contour;
    const shade = .94 + shine;
    const oldAlpha = vapour ? pixels[index + 3] / 255 : 0;
    const oldWeight = oldAlpha * (1 - alpha), outAlpha = alpha + oldWeight;
    for (let k = 0; k < 3; k++) pixels[index + k] =
      (raster.field[index + k + 1] / density * (vapour ? 1 : shade) * alpha + pixels[index + k] * oldWeight) / outAlpha;
    pixels[index + 3] = outAlpha * 255;
  }
}

/** Paint all matter into one reusable RGBA buffer. Texels are always one pixel;
 * physical footprints and mass are independent of the display resolution.
 * This avoids thousands of canvas calls and colour strings every frame. */
export function paintMaterialParticles(ps, t, pixels, particleColor, colorScratch, rawSolids = null) {
  pixels.fill(0);
  paintPhaseSurface(ps, t, pixels, particleColor, colorScratch);
  const appearance = { liquid: 0, solid: 0, gas: 0 };
  for (let i = 0; i < ps.count; i++) {
    // Solid substrate remains under the ingredient artwork, including its
    // transparent edge texels. Grains and vapour retain their own texture.
    phaseAppearance(ps, i, appearance);
    const grainWeight = appearance.solid - frozenSurfaceWeight(ps, i, appearance);
    if (grainWeight <= 0) continue;
    particleColor(ps, i, colorScratch);
    const x = Math.round(t.cx + ps.x[i] * t.scale), y = Math.round(t.cy - ps.y[i] * t.scale);
    const phase = ps.phase[i], dry = isPowder(ps, i) && ps.powderContent[i] > .85;
    const diameter = Math.max(1, Math.ceil(effectiveParticleRadius(ps, i, true) * t.scale * 2));
    const variation = dry ? .13 : phase === Phase.SOLID ? .07 : .04;
    const alpha = .99 * grainWeight;
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
  paintPhaseSurface(ps, t, pixels, particleColor, colorScratch, true);
  return ps.count;
}
