import { EFFECT_PROPERTIES, EFFECT_DEFINITIONS } from './effects.mjs';
import { effectiveParticleRadius } from '../simulation/FluidSolver.mjs';

// Additive magical colors, weighted by the actual CURRENT enchantments.
// A fixed six-level RGB palette bounds reusable sprite allocation to 216 hues.
const COLORS = EFFECT_PROPERTIES.map(key => {
  const hex = EFFECT_DEFINITIONS[key].color;
  return [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
});
const q = v => Math.max(0, Math.min(255, Math.round(v / 51) * 51));
const hex = value => value.toString(16).padStart(2, '0');

/** Works for solids, granules, liquid particles and gas alike. */
export function mixedMagicGlow(ps, index) {
  const effects = {};
  for (const key of EFFECT_PROPERTIES) effects[key] = ps[key]?.[index] || 0;
  return magicGlowFromEffects(effects);
}


/** Resolve each particle's light from LIVE magic. Only genuinely blended
 * mixtures share a common hue; an unmixed pile must retain the separate
 * ingredient colors until the chemistry itself becomes homogeneous. */
export function particleMagicAuras(ps, mixtures = null) {
  const count = ps.count, result = new Array(count), groups = new Map();
  const memberships = new Int32Array(count);
  if (mixtures && ps.mixtureGroup) {
    for (let i = 0; i < count; i++) {
      const root = mixtures.root?.(ps.mixtureGroup[i]);
      if (!root || root.arcaneRecipe?.sourceCount < 2) continue;
      const id = root.id;
      memberships[i] = id;
      let group = groups.get(id);
      if (!group) {
        group = { weight: 0, count: 0, progress: 1, sums: new Float64Array(COLORS.length), squares: new Float64Array(COLORS.length) };
        groups.set(id, group);
      }
      const weight = Math.max(.00001, ps.mass?.[i] || 1);
      group.weight += weight; group.count++;
      group.progress = Math.min(group.progress, ps.mixtureProgress?.[i] ?? 0);
      for (let k = 0; k < EFFECT_PROPERTIES.length; k++) {
        const value = ps[EFFECT_PROPERTIES[k]]?.[i] || 0;
        group.sums[k] += value * weight;
        group.squares[k] += value * value * weight;
      }
    }
    for (const group of groups.values()) {
      if (group.count < 2 || group.progress < .35) continue;
      let homogeneous = true, glowSource = {};
      for (let k = 0; k < EFFECT_PROPERTIES.length; k++) {
        const mean = group.sums[k] / group.weight;
        const deviation = Math.sqrt(Math.max(0, group.squares[k] / group.weight - mean * mean));
        if (deviation > .035) { homogeneous = false; break; }
        glowSource[EFFECT_PROPERTIES[k]] = mean;
      }
      if (homogeneous) group.glow = magicGlowFromEffects(glowSource);
    }
  }
  for (let i = 0; i < count; i++)
    result[i] = (memberships[i] && groups.get(memberships[i])?.glow) || mixedMagicGlow(ps, i);
  return result;
}

/** Pixel-local emission for EVERY particle, independent of phase or broad
 * bloom budget. Work scales with each parcel's small kernel, not canvas size.
 * Existing copper/pigment artwork remains visible under the coloured light. */
export function paintParticleMagicLights(ps, t, pixels, auras, effectsScale = 1) {
  const strength = Math.max(0, Math.min(1, effectsScale));
  if (strength <= .01) return 0;
  let glowingParticles = 0;
  for (let i = 0; i < ps.count; i++) {
    const aura = auras[i];
    if (!aura || aura.intensity <= 0) continue;
    glowingParticles++;
    const x = t.cx + ps.x[i] * t.scale, y = t.cy - ps.y[i] * t.scale;
    const radius = Math.max(3 * t.scale / 40, Math.min(12 * t.scale / 40,
      effectiveParticleRadius(ps, i, true) * t.scale * 1.75));
    const r2 = radius * radius, left = Math.max(0, Math.floor(x - radius));
    const right = Math.min(t.w - 1, Math.ceil(x + radius));
    const top = Math.max(0, Math.floor(y - radius)), bottom = Math.min(t.h - 1, Math.ceil(y + radius));
    const [red, green, blue] = aura.unquantized;
    for (let py = top; py <= bottom; py++) {
      const dy2 = (py + .5 - y) ** 2;
      for (let px = left; px <= right; px++) {
        const distance = ((px + .5 - x) ** 2 + dy2) / r2;
        if (distance >= 1) continue;
        const light = (1 - distance) ** 2 * aura.intensity * strength;
        const at = (py * t.w + px) * 4, alpha = pixels[at + 3];
        if (alpha >= 160) {
          // Glow emanates from the *surface*, not just from sampled halos.
          const gain = light * .22;
          pixels[at] = Math.min(255, pixels[at] + red * gain);
          pixels[at + 1] = Math.min(255, pixels[at + 1] + green * gain);
          pixels[at + 2] = Math.min(255, pixels[at + 2] + blue * gain);
        } else {
          const haloAlpha = Math.min(160, Math.round(120 * light));
          if (haloAlpha > alpha) {
            pixels[at] = red; pixels[at + 1] = green; pixels[at + 2] = blue;
            pixels[at + 3] = haloAlpha;
          }
        }
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
  if (weight < .015) return null;
  const values = [red / weight, green / weight, blue / weight];
  return { color: '#' + hex(q(values[0])) + hex(q(values[1])) + hex(q(values[2])),
    intensity: Math.min(1, weight), unquantized: values };
}
