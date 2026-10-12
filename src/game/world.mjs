import { generateMaterial, mulberry32 } from '../materials/MaterialGenerator.mjs';
import { sanitizeMaterial } from '../materials/MaterialDefinition.mjs';
import { hexToRgb, rgbToHex } from '../simulation/math.mjs';

export function seedNumber(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const PREFIXES = ['Moon', 'Ember', 'Witch', 'Frost', 'Star', 'Dusk', 'Moss', 'Sun', 'Dragon', 'Silver', 'Dream', 'Thorn'];
const SUFFIXES = ['water', ' Sap', "'s Tears", 'root Extract', ' Nectar', ' Dew', ' Essence', ' Resin', ' Tincture'];
const PALETTE = ['#67c9dd', '#e4785c', '#be78de', '#8dce99', '#e2c560', '#6995df', '#e58cba', '#a7dfcf', '#e1b18b'];

/** Generates six diverse starter liquids and three unlockable reagents. */
export function generateWorld(seed) {
  const worldSeed = String(seed).trim().slice(0, 48) || 'moonlight';
  const root = seedNumber(worldSeed), rng = mulberry32(root);
  const rotate = Math.floor(rng() * PREFIXES.length);
  const ingredients = Array.from({ length: 9 }, (_, i) => {
    const materialSeed = seedNumber(`${root}:ingredient:${i}`), raw = generateMaterial(materialSeed, i + 1);
    const local = mulberry32(materialSeed ^ 0x12345678), base = hexToRgb(PALETTE[(i + rotate) % PALETTE.length]);
    const original = hexToRgb(raw.color), colour = base.map((v, k) => v * .8 + original[k] * .2);
    const prefix = PREFIXES[(rotate + i * 5) % PREFIXES.length];
    const material = sanitizeMaterial({
      ...raw,
      name: prefix + SUFFIXES[i], color: rgbToHex(...colour),
      density: .68 + (i % 6) * .16 + local() * .06,
      viscosity: .07 + (i % 6) * .14 + local() * .05,
      miscibility: i < 4 ? .40 + local() * .035 : i === 4 ? .79 : i === 5 ? .12 : .42 + local() * .03,
      meltingTemperature: i < 6 ? .05 + local() * .075 : .16 + local() * .08,
      boilingTemperature: .61 + local() * .33,
      volatility: .06 + (i % 6) * .12 + local() * .08,
      reactionPotential: (i % 2 ? 1 : -1) * (i >= 6 ? .5 + local() * .45 : .08 + local() * .36),
      electricalConductivity: i >= 6 ? .55 + local() * .4 : raw.electricalConductivity,
      reactionHeat: (local() - .5) * .5,
      combustionTemperature: i < 4 ? .96 + local() * .2 : .72 + local() * .35,
      particleRadius: .10 + local() * .01, incompressible: true,
      opacity: .72 + local() * .23
    });
    const price = Math.round((.055 + material.viscosity * .045 + material.electricalConductivity * .035 + (i >= 6 ? .07 : 0)) * 1000) / 1000;
    return { id: material.id, name: material.name, material, price, starter: i < 6,
      lore: i < 4 ? 'A gentle reagent from the village apothecary. Often blends with other gentle extracts.' : i < 6 ? 'A wild extract. Watch for separate layers and a lively response to fire.' : 'A rare guild reagent. Best explored with a measuring prism.' };
  });
  const validation = validateWorld(ingredients);
  if (!validation.valid) throw new Error('Unplayable world: ' + validation.reason);
  return { seed: worldSeed, ingredients, validation };
}

export function validateWorld(ingredients) {
  const starters = ingredients.filter(i => i.starter), mats = starters.map(i => i.material);
  const span = key => Math.max(...mats.map(m => m[key])) - Math.min(...mats.map(m => m[key]));
  if (starters.length < 6 || starters.length > 8) return { valid: false, reason: 'Starter count' };
  if (mats.some(m => m.meltingTemperature >= .28 || m.boilingTemperature <= .5 || m.combustionTemperature <= .6))
    return { valid: false, reason: 'Unsafe starting liquid' };
  if (span('density') < .65 || span('viscosity') < .55 || span('volatility') < .45)
    return { valid: false, reason: 'Insufficient property diversity' };
  if (!mats.some((a, i) => mats.some((b, j) => i !== j && Math.abs(a.miscibility - b.miscibility) < .06)))
    return { valid: false, reason: 'No compatible pair' };
  return { valid: true, reason: 'Six ambient liquids; diverse textures and a compatible mixing family.' };
}

export function availableIngredients(world, equipment) {
  return world.ingredients.filter(i => i.starter || i.id <= 6 + (equipment.reagents || 0));
}
