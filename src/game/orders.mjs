import { mulberry32 } from '../materials/MaterialGenerator.mjs';
import { availableIngredients, seedNumber } from './world.mjs';
import { BrewingSession } from './brewing.mjs';
import { FIXED_STEP, PROPERTIES } from './contracts.mjs';
import { propertyDescription } from './potion.mjs';
import { describeEffects, EFFECT_PROPERTIES, EFFECT_DEFINITIONS } from './effects.mjs';

const NAMES = ['Mira', 'Oswin', 'Rowan', 'Elara', 'Bram', 'Sylvie', 'Aldric', 'Tamsin', 'Fern', 'Corin', 'Nessa', 'Hugo'];
const ROLES = ['wandering bard', 'forest keeper', 'village knight', 'moon scholar', 'herbalist', 'castle cook'];
const PURPOSES = ['for a long journey', 'for the evening feast', 'to mend a tired spirit', 'for a quiet ritual', 'for my enchanted garden', 'to brighten a rainy day'];

/** The witness is a bounded brew through exactly the same adapter as the player.
 * It proves feasibility; it is not a recipe lookup or an alternative evaluator. */
export function simulateWitness(world, recipe, equipment = {}) {
  const brew = new BrewingSession(world.ingredients, equipment);
  try {
    const stock = Object.fromEntries(world.ingredients.map(i => [i.id, 10000]));
    for (const portion of recipe.portions) brew.pour(portion.ingredientId, portion.ml, stock, { crushed: Boolean(portion.crushed) });
    for (let tick = 0; tick < recipe.ticks; tick++) {
      brew.setThermal(tick < recipe.thermalTicks ? recipe.heat : 0, tick < recipe.thermalTicks ? recipe.cool : 0);
      if (recipe.stir && tick > 20) brew.assistStir(FIXED_STEP);
      brew.step(FIXED_STEP);
    }
    brew.setThermal(0);
    return brew.bottle(recipe.volume);
  } finally { brew.dispose(); }
}

function generatePhysicalOrder(world, completed = 0, equipment = {}) {
  const rng = mulberry32(seedNumber(`${world.seed}:order:${completed}`));
  const ingredients = availableIngredients(world, equipment), difficulty = Math.min(4, 1 + Math.floor(completed / 3));
  const liquids = ingredients.filter(i => !i.form || i.form === 'liquid');
  const solvent = liquids.find(i => i.solvent) || liquids[0];
  if (!solvent) throw new Error('A customer potion needs an available liquid solvent.');
  const extracts = ingredients.filter(i => i.id !== solvent.id && i.extractable !== false);
  const primary = completed === 0 ? solvent : extracts.length ? extracts[Math.floor(rng() * extracts.length)] : solvent;
  const volume = completed === 0 ? 60 : difficulty < 3 ? 80 : 100;
  const rawPrimary = Boolean(primary.form && primary.form !== 'liquid');
  const compatible = liquids.filter(i => i.id !== primary.id && Math.abs(i.material.miscibility - primary.material.miscibility) < .06);
  const secondary = !rawPrimary && completed >= 2 && compatible.length ? compatible[Math.floor(rng() * compatible.length)] : null;
  const heat = difficulty >= 3 && rng() > .45 ? .45 : 0;
  const cool = difficulty >= 2 && !heat && rng() > .55 ? .35 : 0;
  const portions = rawPrimary ? [{ ingredientId: solvent.id, ml: volume + 10 }, { ingredientId: primary.id, ml: difficulty >= 3 ? 15 : 10, crushed: true }]
    : secondary ? [{ ingredientId: primary.id, ml: Math.ceil(volume * .55 / 10) * 10 }, { ingredientId: secondary.id, ml: Math.ceil(volume * .55 / 10) * 10 }]
      : [{ ingredientId: primary.id, ml: volume }];
  const recipe = { portions, volume, ticks: rawPrimary ? 280 : 120, thermalTicks: heat || cool ? 65 : 0, heat, cool, stir: rawPrimary || Boolean(secondary), crush: rawPrimary };
  let sample = null;
  try { sample = simulateWitness(world, recipe, equipment); } catch { /* A completely evaporated trial needs a safe fallback. */ }
  // If a rare reagent flashes to vapour, validate a safe ambient single-liquid
  // fallback rather than issue an order that lost its required vial quantity.
  if (!sample || sample.volume < volume - .001 || sample.liquidFraction < .98) {
    recipe.portions = [{ ingredientId: solvent.id, ml: volume }];
    recipe.heat = recipe.cool = recipe.thermalTicks = 0; recipe.stir = false; recipe.crush = false;
    sample = simulateWitness(world, recipe, equipment);
  }
  if (sample.volume < volume - .001) throw new Error('Could not validate a customer order.');
  const properties = completed === 0 ? ['color', 'density'] : ['color', completed % 2 ? 'viscosity' : 'density'];
  if (difficulty >= 2) properties.push(heat || cool ? 'temperature' : completed % 2 ? 'stability' : 'volatility');
  if (difficulty >= 3) properties.push(equipment.analyzer ? 'potency' : 'temperature');
  if (difficulty >= 4 && equipment.analyzer) properties.push('stability');
  const characteristic = describeEffects(sample).find(effect => effect.value > .01);
  if (completed >= 2 && characteristic && Object.hasOwn(PROPERTIES, characteristic.property)) properties.push(characteristic.property);
  const unique = [...new Set(properties)];
  const requirements = unique.map((property, i) => ({ property, target: sample[property], tolerance: PROPERTIES[property].tolerance * (difficulty === 1 ? 1.2 : 1), weight: i === 0 ? 1.3 : 1, hard: property === 'temperature' && difficulty >= 3 }));
  const customer = { id: `customer-${completed}`, name: NAMES[Math.floor(rng() * NAMES.length)], role: ROLES[Math.floor(rng() * ROLES.length)], portraitSeed: Math.floor(rng() * 0xffffffff), dialogue: `A potion ${PURPOSES[Math.floor(rng() * PURPOSES.length)]}, please. A careful brew is worth its weight in gold.` };
  const sources = recipe.portions.map(p => world.ingredients.find(i => i.id === p.ingredientId).name);
  return {
    id: `${world.seed}-${completed}`, customer, requirements, volume, difficulty,
    budget: Math.round(43 + difficulty * 14 + rng() * 8), witness: recipe,
    clue: completed === 0 ? `Your first commission: pour ${volume} ml of ${sources[0]}. Three 20 ml pours will do.` : `I like the character of ${sources.join(' with ')}.${recipe.crush ? ' Crush the raw ingredient, then stir it into the water to extract its properties.' : ''}${recipe.heat ? ' Gently warmed, please.' : recipe.cool ? ' A brief touch of frost would be lovely.' : ' A calm, well-mixed brew would suit me.'}`,
    targetDescriptions: Object.fromEntries(requirements.map(r => [r.property, propertyDescription(r.property, r.target)]))
  };
}

const EFFECT_PURPOSES = Object.freeze({
  strength: 'build strength for a long journey', love: 'bring affection and calm to a restless companion',
  transformation: 'change the shape of a stubborn familiar', fire: 'keep my lantern burning through a cold night',
  freeze: 'bring frost to the summer storeroom', acidity: 'break a creeping enchantment on my orchard',
  poison: 'banish magical pests from a sealed garden', death: 'banish an undead curse from my cellar'
});
const EFFECT_SEQUENCE = ['strength', 'love', 'freeze', 'transformation', 'fire', 'acidity', 'poison', 'death'];

/** Customers describe an outcome. A private simulated witness proves that the
 * unlocked ingredients and visible dose controls can achieve it; it never
 * becomes a customer clue or a player recipe. Legacy inert worlds keep their
 * pinned physical commissions until the player opens a modern world. */
export function generateOrder(world, completed = 0, equipment = {}) {
  const ingredients = availableIngredients(world, equipment);
  if (!ingredients.some(i => EFFECT_PROPERTIES.some(key => i.material[key] > .01))) return generatePhysicalOrder(world, completed, equipment);
  const rng = mulberry32(seedNumber(`${world.seed}:effects-order:${completed}`));
  const solvent = ingredients.find(i => i.solvent) || ingredients.find(i => !i.form || i.form === 'liquid');
  if (!solvent) throw new Error('A customer potion needs an available liquid solvent.');
  const candidates = ingredients.filter(i => i.id !== solvent.id && Math.abs(i.material.miscibility - solvent.material.miscibility) < .06);
  const possible = EFFECT_SEQUENCE.filter(key => candidates.some(i => i.material[key] >= .15));
  if (!possible.length) return generatePhysicalOrder(world, completed, equipment);
  const desired = possible[completed % possible.length];
  const strongest = key => candidates.slice().sort((a, b) => b.material[key] - a.material[key])[0];
  const primary = strongest(desired), difficulty = Math.min(4, 1 + Math.floor(completed / 3));
  const opposes = ingredient => primary.material.fire > .1 && ingredient.material.freeze > .1 || primary.material.freeze > .1 && ingredient.material.fire > .1;
  const complements = possible.filter(key => key !== desired && strongest(key).id !== primary.id && !opposes(strongest(key)));
  const secondaryEffect = completed >= 2 && complements.length ? complements[Math.floor(rng() * complements.length)] : null;
  const secondary = secondaryEffect ? strongest(secondaryEffect) : null;
  const volume = completed === 0 ? 60 : difficulty < 3 ? 80 : 100;
  const water = secondary ? Math.max(140, volume + 20) : volume + 20;
  const portion = ingredient => ({ ingredientId: ingredient.id, ml: 10, crushed: Boolean(ingredient.form && !['liquid', 'powder'].includes(ingredient.form)) });
  const recipe = { portions: [{ ingredientId: solvent.id, ml: water }, portion(primary), ...(secondary ? [portion(secondary)] : [])], volume,
    ticks: secondary ? 320 : 280, thermalTicks: 0, heat: 0, cool: 0, stir: true, crush: Boolean(primary.crushable || secondary?.crushable) };
  let sample = simulateWitness(world, recipe, equipment);
  let wanted = [desired, ...(secondaryEffect ? [secondaryEffect] : [])].filter(key => sample[key] >= .01);
  if (sample.volume < volume - .001 || !wanted.includes(desired)) {
    // Some pinned legacy raw materials may not extract reliably. Try a known
    // compatible strength infusion rather than request an unattainable effect.
    const fallback = strongest(possible[0]);
    recipe.portions = [{ ingredientId: solvent.id, ml: volume + 20 }, portion(fallback)];
    recipe.ticks = 280; sample = simulateWitness(world, recipe, equipment);
    wanted = possible.filter(key => sample[key] >= .01).slice(0, 1);
  }
  if (!wanted.length || sample.volume < volume - .001) throw new Error('Could not validate an effect commission.');
  /** @type {import('./contracts.mjs').Requirement[]} */
  const requirements = wanted.map(property => ({ property, target: sample[property], tolerance: Math.max(.002, Math.min(PROPERTIES[property].tolerance, sample[property] * .35)),
    weight: 3, hard: false, minimum: sample[property] * .3, comparison: 'target' }));
  for (const property of EFFECT_PROPERTIES) {
    if (wanted.includes(property)) continue;
    const ceiling = Math.max(property === 'acidity' ? .035 : .015, sample[property] * 1.3 + .005);
    requirements.push({ property, target: Math.min(1, ceiling), tolerance: .008, weight: .4, hard: true, comparison: 'maximum' });
  }
  const purpose = wanted.map(key => EFFECT_PURPOSES[key]).join(' and ');
  const customer = { id: `customer-${completed}`, name: NAMES[Math.floor(rng() * NAMES.length)], role: ROLES[Math.floor(rng() * ROLES.length)],
    portraitSeed: Math.floor(rng() * 0xffffffff), dialogue: `I need a potion to ${purpose}. I need the enchantment in this range, with no unwanted surprises.` };
  const clue = 'Use the known garden essences. Test a spare dose on your familiars, then write your own potion ID from their response.';
  return { id: `${world.seed}-${completed}`, conceptVersion: 2, customer, requirements, volume, difficulty,
    budget: Math.round(43 + difficulty * 14 + wanted.length * 6 + rng() * 8), witness: recipe, clue,
    targetDescriptions: Object.fromEntries(requirements.map(r => [r.property, r.comparison === 'maximum' ? `At most ${Math.round(Number(r.target) * 100)}% ${EFFECT_DEFINITIONS[r.property].label.toLowerCase()}` : propertyDescription(r.property, r.target)])) };
}
