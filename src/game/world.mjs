import { generateMaterial, mulberry32 } from '../materials/MaterialGenerator.mjs';
import { EFFECT_PROPERTIES, sanitizeMaterial } from '../materials/MaterialDefinition.mjs';
import { hexToRgb, rgbToHex } from '../simulation/math.mjs';

export function seedNumber(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const PREFIXES = ['Moon', 'Ember', 'Witch', 'Frost', 'Star', 'Dusk', 'Moss', 'Sun', 'Dragon', 'Silver', 'Dream', 'Thorn'];
const NEUTRAL_EFFECTS = Object.freeze(Object.fromEntries(EFFECT_PROPERTIES.map(key => [key, 0])));

// IDs are permanent: the first six starter ingredients, guild unlocks 7–9,
// and the two later starter minerals keep their inventory and recipe identity.
const INGREDIENTS = [
  { id: 1, name: 'Plain Water', form: 'liquid', shape: 'water', icon: '💧', color: '#a8dfe8', density: 1, viscosity: .06, volatility: .08, miscibility: .42, price: .018,
    lore: 'Fresh spring water. A neutral solvent: crush a small amount of a compatible ingredient, then stir it into plenty of water.', effects: {} },
  { id: 2, name: 'Ironroot', form: 'plant', shape: 'sprig', icon: '🌿', color: '#8ba96d', density: .74, viscosity: .32, volatility: .18, miscibility: .41, price: .062,
    lore: 'A sturdy woodland herb carrying strength. Crush its leaves before extracting their character with water.', effects: { strength: .86, acidity: .12 } },
  { id: 3, name: 'Heartpetal', form: 'plant', shape: 'petal', icon: '🌸', color: '#e794b4', density: .58, viscosity: .64, volatility: .43, miscibility: .435, price: .068,
    lore: 'Soft meadow petals carrying warmth and affection. Ground petals slowly tint a well-stirred water infusion.', effects: { love: .9, transformation: .1, acidity: .18 } },
  { id: 4, name: 'Ember Flint', form: 'stone', shape: 'stone', icon: '🪨', color: '#db9467', density: 1.59, viscosity: .9, volatility: .63, miscibility: .4, price: .077,
    lore: 'A warm mineral from the rocky bank. The pestle releases its fire; a little powder goes a long way.', effects: { fire: .9, strength: .16, acidity: .62 } },
  { id: 5, name: 'Frostcap', form: 'mushroom', shape: 'cap', icon: '🍄', color: '#91c9df', density: .95, viscosity: .17, volatility: .76, miscibility: .425, price: .073,
    lore: 'A cool mushroom growing beneath the trees. Crushing reveals a freezing essence with a trace of transformation.', effects: { freeze: .92, transformation: .28 } },
  { id: 6, name: 'Nightshade', form: 'plant', shape: 'leaf', icon: '🍃', color: '#9981bd', density: 1.23, viscosity: .76, volatility: .52, miscibility: .79, price: .086,
    lore: 'A shaded herb carrying venom and shadow magic. Gentle warmth brings its reluctant essence into water.', effects: { poison: .9, death: .62, acidity: .32 } },
  { id: 7, name: 'Mandrake', form: 'root', shape: 'root', icon: '🌱', color: '#d0ae78', density: 1.15, viscosity: .72, volatility: .34, miscibility: .43, price: .15,
    lore: 'A rare guild root carrying transformation and strength. Its gathering patch opens with the first guild reagent licence.', effects: { transformation: .95, strength: .5, poison: .16 } },
  { id: 8, name: 'Grave Moss', form: 'plant', shape: 'sprig', icon: '🌿', color: '#96a899', density: .82, viscosity: .51, volatility: .56, miscibility: .415, price: .18,
    lore: 'A rare moss rich in death magic. Crush carefully, dilute generously, and observe the effects in the experiment room.', effects: { death: .98, freeze: .22, poison: .65 } },
  { id: 9, name: 'Star Quartz', form: 'stone', shape: 'crystal', icon: '💎', color: '#ceb7e8', density: 1.48, viscosity: .44, volatility: .29, miscibility: .42, price: .2,
    lore: 'An unusual crystal carrying love and transformation. Grind it into a fine powder to prepare a luminous infusion.', effects: { transformation: .7, love: .64, fire: .22 } },
  { id: 10, name: 'River Chalk', form: 'stone', shape: 'stone', icon: '🪨', color: '#ded6b1', density: 1.32, viscosity: .56, volatility: .1, miscibility: .42, price: .065,
    lore: 'A soft river stone. Crush and stir it with a little water for thick dough; abundant water and more stirring gradually thin the infusion.', effects: { strength: .12, freeze: .1 } },
  { id: 11, name: 'Mica Dust', form: 'powder', shape: 'powder', icon: '✦', color: '#c5b5d8', density: 1.22, viscosity: .61, volatility: .15, miscibility: .405, price: .075,
    lore: 'Naturally loose mineral grains collected from the bank. Stir with a little water to knead dough; abundant water and sustained stirring make a fluid infusion.', effects: { transformation: .28, love: .12, acidity: .08 } },
  { id: 12, name: 'Phoenix Sap', form: 'liquid', shape: 'water', icon: '🔥', color: '#e9914b', density: 1.08, viscosity: .4, volatility: .3, miscibility: .64, price: .24, lore: 'Golden sap tapped from a slow-growing phoenix tree. Carries fire and courage; warmth helps it blend.', effects: { fire: .88, strength: .4 } },
  { id: 13, name: 'Moon Dew', form: 'liquid', shape: 'water', icon: '🌙', color: '#81c3ed', density: .91, viscosity: .18, volatility: .2, miscibility: .43, price: .22, lore: 'Collected from moonflowers. Carries affection and frost; its awakening rune opposes spring water.', effects: { love: .8, freeze: .46 } },
  { id: 14, name: 'Dream Nectar', form: 'liquid', shape: 'water', icon: '✨', color: '#c78ded', density: 1.12, viscosity: .38, volatility: .3, miscibility: .45, price: .28, lore: 'A small harvest from dream blossoms. Carries transformation with a trace of withering magic.', effects: { transformation: .9, acidity: .14 } }
];

function makeIngredient(worldSeed, spec) {
  const materialSeed = seedNumber(`${worldSeed}:ingredient:${spec.id}`);
  const local = mulberry32(materialSeed), raw = generateMaterial(materialSeed, spec.id);
  const base = hexToRgb(spec.color), original = hexToRgb(raw.color);
  const name = spec.id === 1 ? spec.name : `${PREFIXES[Math.floor(local() * PREFIXES.length)]} ${spec.name}`;
  const awakening = { 1: 4, 2: -8, 3: 9, 4: 1.04, 5: -9, 6: 10, 7: -11, 8: 11, 9: -10, 10: 8, 11: -8, 12: -7, 13: -7, 14: 9 };
  const liquid = spec.form === 'liquid', powder = spec.form === 'powder';
  const material = sanitizeMaterial({
    ...raw, ...NEUTRAL_EFFECTS, ...spec.effects, name, arcaneThreshold: awakening[spec.id], magicDecayTemperature: .79,
    color: liquid ? spec.color : rgbToHex(...base.map((v, k) => v * .92 + original[k] * .08)),
    density: spec.density + (liquid ? 0 : local() * .035),
    viscosity: spec.viscosity + (liquid ? 0 : local() * .025),
    miscibility: spec.miscibility, volatility: spec.volatility,
    meltingTemperature: liquid ? .08 : .70 + local() * .035,
    boilingTemperature: liquid ? .88 : 1.05,
    phaseTransitionHysteresis: .02,
    solidSubdivision: powder ? 1 : 0, crystallinity: spec.form === 'stone' ? .8 : .12,
    heatCapacity: liquid ? .85 : .55 + local() * .2,
    thermalConductivity: liquid ? .35 : .18 + local() * .18,
    cohesion: liquid ? .22 : .14,
    reactionPotential: liquid ? 0 : (spec.id % 2 ? 1 : -1) * (.08 + local() * .12),
    reactionHeat: liquid ? 0 : (local() - .5) * .08,
    electricPotential: 0, electricalConductivity: liquid ? .1 : .1 + local() * .25,
    combustionTemperature: 1.3, particleRadius: .10 + local() * .01,
    incompressible: true, opacity: liquid ? .7 : 1
  });
  return { id: spec.id, name, material, price: spec.price, starter: spec.id <= 6 || spec.id >= 10,
    form: spec.form, unit: liquid ? 'ml' : 'measures', solvent: spec.id === 1,
    crushable: !liquid && !powder, extractable: !liquid,
    appearance: { shape: spec.shape, icon: spec.icon }, lore: spec.lore };
}

/** Kept for version-two migrations; appended IDs never replace pinned stock. */
export function generateStarterPowders(seed) {
  return INGREDIENTS.filter(i => i.id >= 10).map(spec => makeIngredient(String(seed), spec));
}

/** Water, raw plants and minerals feed the same physical material simulation. */
export function generateWorld(seed) {
  const worldSeed = String(seed).trim().slice(0, 48) || 'moonlight';
  const ingredients = INGREDIENTS.map(spec => makeIngredient(worldSeed, spec));
  const validation = validateWorld(ingredients);
  if (!validation.valid) throw new Error('Unplayable world: ' + validation.reason);
  return { seed: worldSeed, ingredientVersion: 3, ingredients, validation };
}

export function validateWorld(ingredients) {
  const starters = ingredients.filter(i => i.starter), water = starters.find(i => i.id === 1);
  const raws = starters.filter(i => i.form !== 'liquid' && i.form !== 'powder');
  const mats = starters.map(i => i.material);
  const span = key => Math.max(...mats.map(m => m[key])) - Math.min(...mats.map(m => m[key]));
  if (starters.length !== 11 || new Set(ingredients.map(i => i.id)).size !== ingredients.length)
    return { valid: false, reason: 'Starter count or duplicate ingredient' };
  if (!water?.solvent || water.form !== 'liquid' || water.material.meltingTemperature >= .28 || water.material.boilingTemperature <= .5)
    return { valid: false, reason: 'Missing safe water solvent' };
  if (raws.length < 5 || raws.some(i => !i.crushable || i.material.meltingTemperature <= .36 || i.material.solidSubdivision !== 0))
    return { valid: false, reason: 'Missing crushable raw ingredients' };
  if (mats.some(m => m.combustionTemperature <= .6 || EFFECT_PROPERTIES.some(key => !Number.isFinite(m[key]) || m[key] < 0 || m[key] > 1)))
    return { valid: false, reason: 'Unsafe or invalid starter material' };
  if (span('density') < .65 || span('viscosity') < .55 || span('volatility') < .45)
    return { valid: false, reason: 'Insufficient property diversity' };
  if (raws.filter(i => Math.abs(i.material.miscibility - water.material.miscibility) < .06).length < 3)
    return { valid: false, reason: 'Insufficient water-compatible ingredients' };
  return { valid: true, reason: 'Fresh water, crushable plants and stones, and loose mineral dust; known magical essences, crushable garden stones and three enchanted liquids.' };
}

/** Preserve legacy recipe targets and pinned physics; only add missing metadata. */
export function migrateIngredients(world) {
  if (!world?.ingredients) return world;
  const additions = generateWorld(world.seed).ingredients.filter(i => !world.ingredients.some(old => old.id === i.id));
  return { ...world, ingredientVersion: 3, ingredients: [...world.ingredients.map(ingredient => {
    const spec = INGREDIENTS.find(i => i.id === ingredient.id);
    const form = ingredient.form || 'liquid', liquid = form === 'liquid', powder = form === 'powder';
    const reference = makeIngredient(world.seed, spec || INGREDIENTS[0]);
    const material = { ...ingredient.material, arcaneThreshold: ingredient.material.arcaneThreshold ?? reference.material.arcaneThreshold, magicDecayTemperature: ingredient.material.magicDecayTemperature ?? .79 };
    for (const key of EFFECT_PROPERTIES) if (material[key] === undefined) material[key] = 0;
    return { ...ingredient, form, material,
      unit: ingredient.unit || (liquid ? 'ml' : 'measures'),
      solvent: ingredient.solvent ?? (ingredient.id === 1 || !ingredient.form),
      crushable: ingredient.crushable ?? (!liquid && !powder),
      extractable: ingredient.extractable ?? !liquid,
      appearance: ingredient.appearance || { shape: liquid ? 'water' : spec?.shape || 'stone', icon: liquid ? '💧' : spec?.icon || '🪨' }
    };
  }), ...additions] };
}

export function availableIngredients(world, equipment) {
  return world.ingredients.filter(i => i.starter || i.id <= 6 + (equipment?.reagents || 0));
}
