import { EFFECT_PROPERTIES, EFFECT_DEFINITIONS } from './effects.mjs';
import { Phase } from '../simulation/Phase.mjs';
import { liquidSurfaceRadius } from './MaterialRaster.mjs';
import { effectiveParticleRadius } from '../simulation/FluidSolver.mjs';

// Additive magical colors, weighted by the actual CURRENT enchantments.
// Fine palette steps keep broad halo hues stable while local emission uses exact RGB.
const COLORS = EFFECT_PROPERTIES.map(key => {
  const hex = EFFECT_DEFINITIONS[key].color;
  return [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
});
const q = v => Math.max(0, Math.min(255, Math.round(v / 17) * 17));
const hex = value => value.toString(16).padStart(2, '0');

/** Works for solids, granules, liquid particles and gas alike. */
export function mixedMagicGlow(ps, index) {
  const effects = {};
  for (const key of EFFECT_PROPERTIES) effects[key] = ps[key]?.[index] || 0;
  return magicGlowFromEffects(effects);
}


/** Use live LOCAL concentrations throughout diffusion. Sharing a recipe or
 * crossing a variance threshold must never recolour separated parcels at once.
 * Conservative chemistry makes their emissions homogeneous as they mix. */
export function particleMagicAuras(ps, mixtures = null) {
  return Array.from({ length: ps.count }, (_, i) => mixedMagicGlow(ps, i));
}

// Emission is reconstructed once per pixel, so changing parcel count or
// overlapping kernels cannot multiply a homogeneous brew's magical power.
const lightRasters = new WeakMap();
export function paintParticleMagicLights(ps, t, pixels, auras, effectsScale = 1) {
  const strength = Math.max(0, Math.min(1, effectsScale));
  if (strength <= 0) return 0;
  let raster = lightRasters.get(pixels);
  if (!raster) {
    raster = { field: new Float32Array(pixels.length), touched: new Uint32Array(t.w * t.h), count: 0 };
    lightRasters.set(pixels, raster);
  }
  const { field, touched } = raster;
  for (let n = 0; n < raster.count; n++) field.fill(0, touched[n] * 4, touched[n] * 4 + 4);
  raster.count = 0;
  let glowingParticles = 0;
  for (let i = 0; i < ps.count; i++) {
    const aura = auras[i];
    if (aura?.intensity > 0) glowingParticles++;
    const x = t.cx + ps.x[i] * t.scale, y = t.cy - ps.y[i] * t.scale;
    const radius = ps.phase?.[i] === Phase.LIQUID ? liquidSurfaceRadius(ps, i, t.scale) :
      Math.max(3 * t.scale / 40, effectiveParticleRadius(ps, i, true) * t.scale * 1.75);
    const r2 = radius * radius, left = Math.max(0, Math.floor(x - radius));
    const right = Math.min(t.w - 1, Math.ceil(x + radius));
    const top = Math.max(0, Math.floor(y - radius)), bottom = Math.min(t.h - 1, Math.ceil(y + radius));
    for (let py = top; py <= bottom; py++) {
      const dy2 = (py + .5 - y) ** 2;
      for (let px = left; px <= right; px++) {
        const distance = ((px + .5 - x) ** 2 + dy2) / r2;
        if (distance >= 1) continue;
        const weight = (1 - distance) ** 2, at = (py * t.w + px) * 4;
        if (field[at + 3] === 0) touched[raster.count++] = py * t.w + px;
        field[at + 3] += weight;
        if (!aura) continue;
        const light = weight * aura.intensity;
        for (let k = 0; k < 3; k++) field[at + k] += aura.unquantized[k] * light;
      }
    }
  }
  for (let n = 0; n < raster.count; n++) {
    const at = touched[n] * 4, weight = field[at + 3];
    const red = field[at] / weight, green = field[at + 1] / weight, blue = field[at + 2] / weight;
    if (pixels[at + 3] >= 160) {
      pixels[at] += red * .22 * strength;
      pixels[at + 1] += green * .22 * strength;
      pixels[at + 2] += blue * .22 * strength;
    } else {
      const alpha = Math.min(160, Math.round(120 * Math.max(red, green, blue) / 255 * Math.min(1, weight) * strength));
      if (alpha > pixels[at + 3]) {
        const power = Math.max(red, green, blue) / 255;
        pixels[at] = red / power; pixels[at + 1] = green / power; pixels[at + 2] = blue / power;
        pixels[at + 3] = alpha;
      }
    }
  }
  return glowingParticles;
}

function magicGlowFromEffects(effects) {
  let weight = 0, red = 0, green = 0, blue = 0;
  for (let k = 0; k < EFFECT_PROPERTIES.length; k++) {
    const amount = Math.max(0, effects[EFFECT_PROPERTIES[k]] || 0);
    if (!amount) continue;
    weight += amount;
    red += amount * COLORS[k][0]; green += amount * COLORS[k][1]; blue += amount * COLORS[k][2];
  }
  if (weight <= 0) return null;
  const values = [red / weight, green / weight, blue / weight];
  return { color: '#' + hex(q(values[0])) + hex(q(values[1])) + hex(q(values[2])),
    intensity: weight, unquantized: values };
}
