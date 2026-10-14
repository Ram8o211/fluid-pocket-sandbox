import { EFFECT_PROPERTIES, EFFECT_DEFINITIONS } from './effects.mjs';

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
  let weight = 0, red = 0, green = 0, blue = 0;
  for (let k = 0; k < EFFECT_PROPERTIES.length; k++) {
    const amount = Math.max(0, ps[EFFECT_PROPERTIES[k]]?.[index] || 0);
    if (!amount) continue;
    weight += amount;
    red += amount * COLORS[k][0];
    green += amount * COLORS[k][1];
    blue += amount * COLORS[k][2];
  }
  if (weight < .015) return null;
  const colour = '#' + hex(q(red / weight)) + hex(q(green / weight)) + hex(q(blue / weight));
  return { color: colour, intensity: Math.min(1, weight), unquantized: [red / weight, green / weight, blue / weight] };
}
