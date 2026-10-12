import { mulberry32 } from '../materials/MaterialGenerator.mjs';
import { availableIngredients, seedNumber } from './world.mjs';
import { BrewingSession } from './brewing.mjs';
import { FIXED_STEP, PROPERTIES } from './contracts.mjs';
import { propertyDescription } from './potion.mjs';

const NAMES = ['Mira', 'Oswin', 'Rowan', 'Elara', 'Bram', 'Sylvie', 'Aldric', 'Tamsin', 'Fern', 'Corin', 'Nessa', 'Hugo'];
const ROLES = ['wandering bard', 'forest keeper', 'village knight', 'moon scholar', 'herbalist', 'castle cook'];
const PURPOSES = ['for a long journey', 'for the evening feast', 'to mend a tired spirit', 'for a quiet ritual', 'for my enchanted garden', 'to brighten a rainy day'];

/** The witness is a bounded brew through exactly the same adapter as the player.
 * It proves feasibility; it is not a recipe lookup or an alternative evaluator. */
export function simulateWitness(world, recipe, equipment = {}) {
  const brew = new BrewingSession(world.ingredients, equipment);
  const stock = Object.fromEntries(world.ingredients.map(i => [i.id, 10000]));
  for (const portion of recipe.portions) brew.pour(portion.ingredientId, portion.ml, stock);
  for (let tick = 0; tick < recipe.ticks; tick++) {
    brew.setThermal(tick < recipe.thermalTicks ? recipe.heat : 0, tick < recipe.thermalTicks ? recipe.cool : 0);
    if (recipe.stir && tick > 20) brew.assistStir(FIXED_STEP);
    brew.step(FIXED_STEP);
  }
  brew.setThermal(0);
  return brew.bottle(recipe.volume);
}

export function generateOrder(world, completed = 0, equipment = {}) {
  const rng = mulberry32(seedNumber(`${world.seed}:order:${completed}`));
  // Powder recipes require a solvent and longer dissolution. Keep generated
  // single-reagent commissions feasible with the original liquid witness flow.
  const ingredients = availableIngredients(world, equipment).filter(i => i.form !== 'powder'), difficulty = Math.min(4, 1 + Math.floor(completed / 3));
  const primary = completed === 0 ? ingredients[0] : ingredients[Math.floor(rng() * ingredients.length)];
  const volume = completed === 0 ? 60 : difficulty < 3 ? 80 : 100;
  const compatible = ingredients.filter(i => i.id !== primary.id && Math.abs(i.material.miscibility - primary.material.miscibility) < .06);
  const secondary = completed >= 2 && compatible.length ? compatible[Math.floor(rng() * compatible.length)] : null;
  const heat = difficulty >= 3 && rng() > .45 ? .45 : 0;
  const cool = difficulty >= 2 && !heat && rng() > .55 ? .35 : 0;
  const recipe = { portions: secondary ? [{ ingredientId: primary.id, ml: Math.ceil(volume * .55 / 10) * 10 }, { ingredientId: secondary.id, ml: Math.ceil(volume * .55 / 10) * 10 }] : [{ ingredientId: primary.id, ml: volume }], volume, ticks: 120, thermalTicks: heat || cool ? 65 : 0, heat, cool, stir: Boolean(secondary) };
  let sample = null;
  try { sample = simulateWitness(world, recipe, equipment); } catch { /* A completely evaporated trial needs a safe fallback. */ }
  // If a rare reagent flashes to vapour, validate a safe ambient single-liquid
  // fallback rather than issue an order that lost its required vial quantity.
  if (!sample || sample.volume < volume - .001 || sample.liquidFraction < .98) {
    recipe.portions = [{ ingredientId: ingredients[0].id, ml: volume }];
    recipe.heat = recipe.cool = recipe.thermalTicks = 0; recipe.stir = false;
    sample = simulateWitness(world, recipe, equipment);
  }
  if (sample.volume < volume - .001) throw new Error('Could not validate a customer order.');
  const properties = completed === 0 ? ['color', 'density'] : ['color', completed % 2 ? 'viscosity' : 'density'];
  if (difficulty >= 2) properties.push(heat || cool ? 'temperature' : completed % 2 ? 'stability' : 'volatility');
  if (difficulty >= 3) properties.push(equipment.analyzer ? 'potency' : 'temperature');
  if (difficulty >= 4 && equipment.analyzer) properties.push('stability');
  const unique = [...new Set(properties)];
  const requirements = unique.map((property, i) => ({ property, target: sample[property], tolerance: PROPERTIES[property].tolerance * (difficulty === 1 ? 1.2 : 1), weight: i === 0 ? 1.3 : 1, hard: property === 'temperature' && difficulty >= 3 }));
  const customer = { id: `customer-${completed}`, name: NAMES[Math.floor(rng() * NAMES.length)], role: ROLES[Math.floor(rng() * ROLES.length)], portraitSeed: Math.floor(rng() * 0xffffffff), dialogue: `A potion ${PURPOSES[Math.floor(rng() * PURPOSES.length)]}, please. A careful brew is worth its weight in gold.` };
  const sources = recipe.portions.map(p => world.ingredients.find(i => i.id === p.ingredientId).name);
  return {
    id: `${world.seed}-${completed}`, customer, requirements, volume, difficulty,
    budget: Math.round(43 + difficulty * 14 + rng() * 8), witness: recipe,
    clue: completed === 0 ? `Your first commission: pour ${volume} ml of ${sources[0]}. Three 20 ml pours will do.` : `I like the character of ${sources.join(' with ')}.${recipe.heat ? ' Gently warmed, please.' : recipe.cool ? ' A brief touch of frost would be lovely.' : ' A calm, well-mixed brew would suit me.'}`,
    targetDescriptions: Object.fromEntries(requirements.map(r => [r.property, propertyDescription(r.property, r.target)]))
  };
}
