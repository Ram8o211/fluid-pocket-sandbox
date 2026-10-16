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

// Cache disk scanlines by pixel diameter. A powder parcel keeps its original
// coverage, but adjacent frames never repeat the per-texel circle test.
const solidFootprints = new Map();
function solidFootprint(diameter) {
  const cached = solidFootprints.get(diameter);
  if (cached) return cached;
  const rows = [], center = Math.floor(diameter / 2);
  const half = Math.max(1, diameter / 2), limit = half * half + .5;
  for (let py = 0; py < diameter; py++) {
    const dy = py - center, remaining = limit - (dy + .5) * (dy + .5);
    if (remaining < 0) continue;
    let left = -1, right = -1;
    for (let px = 0; px < diameter; px++) {
      const dx = px - center + .5;
      if (dx * dx > remaining) continue;
      if (left < 0) left = px - center;
      right = px - center + 1;
    }
    if (left >= 0) rows.push({ dy, left, right });
  }
  // Oversized solids are rare. Do not allow unbounded resolution-dependent
  // footprint caching as the user changes graphics quality or device DPR.
  if (diameter <= 64) {
    if (solidFootprints.size >= 64) solidFootprints.clear();
    solidFootprints.set(diameter, rows);
  }
  return rows;
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
    const alpha = .99 * grainWeight, half = Math.max(1, diameter / 2);
    // A tiny stable colour variation per grain reads as fine sand even in
    // dense piles. Do not procedurally texture every individual powder texel.
    const grainShade = .96 + (((Math.imul(i + 1, 2654435761) >>> 24) / 255) - .5) * .12;
    const grainR = colorScratch.r * grainShade, grainG = colorScratch.g * grainShade, grainB = colorScratch.b * grainShade;
    const variation = phase === Phase.SOLID ? .07 : .04;
    for (const row of solidFootprint(diameter)) {
      const py = y + row.dy;
      if (py < 0 || py >= t.h) continue;
      const left = Math.max(0, x + row.left), right = Math.min(t.w, x + row.right);
      const rowShade = 1 - row.dy / half * .08;
      for (let px = left; px < right; px++) {
        // Wet/coherent solids retain their older texture; dry powders take
        // the fast, flat-colour path instead of hashing each covered pixel.
        const hash = dry ? 0 : ((i * 67 + (px - x) * 23 + row.dy * 41) >>> 0) % 11 - 5;
        const shade = rowShade + variation * hash / 5;
        const r = dry ? grainR : colorScratch.r * shade;
        const g = dry ? grainG : colorScratch.g * shade;
        const b = dry ? grainB : colorScratch.b * shade;
        const index = (py * t.w + px) * 4, oldAlpha = pixels[index + 3] / 255;
        if (oldAlpha === 0) {
          pixels[index] = r; pixels[index + 1] = g; pixels[index + 2] = b; pixels[index + 3] = alpha * 255;
          continue;
        }
        const oldWeight = oldAlpha * (1 - alpha), outAlpha = alpha + oldWeight;
        pixels[index] = (r * alpha + pixels[index] * oldWeight) / outAlpha;
        pixels[index + 1] = (g * alpha + pixels[index + 1] * oldWeight) / outAlpha;
        pixels[index + 2] = (b * alpha + pixels[index + 2] * oldWeight) / outAlpha;
        pixels[index + 3] = outAlpha * 255;
      }
    }
    // Grain boundaries remain visible through their individual physical
    // silhouettes and tints, without a costly dark pixel on every grain.
  }
  paintPhaseSurface(ps, t, pixels, particleColor, colorScratch, true);
  return ps.count;
}
