import { mulberry32 } from '../materials/MaterialGenerator.mjs';
import { availableIngredients, seedNumber } from './world.mjs';
import { BrewingSession } from './brewing.mjs';
import { CAPACITY_ML, FIXED_STEP, PROPERTIES } from './contracts.mjs';
import { propertyDescription } from './potion.mjs';
import { describeEffects, EFFECT_PROPERTIES } from './effects.mjs';
import { requirementDescription, UNWANTED_EFFECT_MAX } from './evaluation.mjs';
import { arcaneRecipe } from '../simulation/ArcaneSolver.mjs';

const NAMES = ['Mira', 'Oswin', 'Rowan', 'Elara', 'Bram', 'Sylvie', 'Aldric', 'Tamsin', 'Fern', 'Corin', 'Nessa', 'Hugo'];
const ROLES = ['wandering bard', 'forest keeper', 'village knight', 'moon scholar', 'herbalist', 'castle cook'];
const PURPOSES = ['for a long journey', 'for the evening feast', 'to mend a tired spirit', 'for a quiet ritual', 'for my enchanted garden', 'to brighten a rainy day'];

/** The witness is a bounded brew through exactly the same adapter as the player.
 * It proves feasibility; it is not a recipe lookup or an alternative evaluator. */
export function simulateWitness(world, recipe, equipment = {}) {
  const brew = new BrewingSession(world.ingredients, equipment);
  try {
    const stock = Object.fromEntries(world.ingredients.map(i => [i.id, 10000]));
    const obtainable = availableIngredients(world, equipment).filter(i => !i.recoverOnly);
    for (const portion of recipe.portions) {
      if (!obtainable.some(i => i.id === portion.ingredientId))
        throw new Error('A commission witness cannot use a locked or recovery-only ingredient.');
      const poured = brew.pour(portion.ingredientId, portion.ml, stock, { crushed: Boolean(portion.crushed) });
      if (Math.abs(poured - portion.ml) > 1e-6 || !(poured > 0))
        throw new Error('A commission witness must fit every full portion in the unlocked cauldron.');
    }
    for (let tick = 0; tick < recipe.ticks; tick++) {
      brew.setThermal(tick < recipe.thermalTicks ? recipe.heat : 0, tick < recipe.thermalTicks ? recipe.cool : 0);
      if (recipe.stir && tick > 20) brew.assistStir(FIXED_STEP);
      brew.step(FIXED_STEP);
    }
    brew.setThermal(0);
    // Customer recipes are tested on a creature before the remaining vial is
    // sealed. Sampling can change an incompletely homogenized brew.
    if (recipe.reserveTrial) brew.takeSample(5);
    return brew.bottle(recipe.volume);
  } finally { brew.dispose(); }
}

function generatePhysicalOrder(world, completed = 0, equipment = {}) {
  const rng = mulberry32(seedNumber(`${world.seed}:order:${completed}`));
  const ingredients = availableIngredients(world, equipment).filter(i => !i.recoverOnly), difficulty = Math.min(4, 1 + Math.floor(completed / 3));
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
  return {
    id: `${world.seed}-${completed}`, customer, requirements, volume, difficulty,
    budget: Math.round(43 + difficulty * 14 + rng() * 8), witness: recipe,
    clue: 'Compare the known ingredient properties with the request. Test a spare dose before sealing the requested quantity.',
    targetDescriptions: Object.fromEntries(requirements.map(r => [r.property, propertyDescription(r.property, r.target)]))
  };
}

const EFFECT_SEQUENCE = ['strength', 'love', 'freeze', 'transformation', 'fire', 'acidity', 'poison', 'death'];
// Every second enchantment must contribute to the SAME practical problem.
// No independent random purposes are ever spliced together.
const COMPANIONS = Object.freeze({
  strength: ['love', 'transformation'], love: ['fire', 'strength', 'transformation'],
  freeze: ['transformation', 'poison'], transformation: ['strength', 'poison', 'freeze', 'love'],
  fire: ['love', 'strength'], acidity: ['poison', 'transformation'],
  poison: ['transformation', 'acidity', 'death'], death: ['poison', 'transformation']
});
export const CUSTOMER_SCENARIOS = Object.freeze({
  strength: ['The mountain rescue team needs strength to carry the stranded villagers home.',
    'My apprentice must lift the fallen forge gate before the river rises.'],
  love: ['The estranged siblings at the inn want to reconcile before winter.',
    'Our frightened rescue animal needs to trust its new caretaker.'],
  freeze: ['The fish merchants need a spell to preserve their catch during the heatwave.',
    'Please keep the medicinal herbs frozen until the healer arrives.'],
  transformation: ['The guard needs a harmless disguise to infiltrate the bandit camp.',
    'Our messenger must take the shape of a bird to cross the blocked pass.'],
  fire: ['The isolated village needs heat until the storm passes.',
    'Our signal lantern must burn through the freezing mountain night.'],
  acidity: ['A petrified thorn hedge blocks our only road; we need to dissolve it.',
    'A cursed metal lock must be corroded before its prisoner suffocates.'],
  poison: ['Venomous pests are devouring the crops. We need a stronger poison for the sealed traps.',
    'The giant rats are overrunning the abandoned mill. Our poison must work.'],
  death: ['The necromancer’s summoned dead must finally be laid to rest.',
    'The tomb guardian will not release the spirits; a death enchantment is needed.'],
  'strength+love': ['The exhausted watch needs strength to rebuild the wall, and affection to end the quarrel dividing them.',
    'A weakened caretaker needs renewed strength and compassion for the frightened animals.'],
  'love+fire': ['Please warm our snowbound cottage and rekindle the affection between my wife and me.',
    'The winter festival needs a warming flame and a charm to reunite estranged families.'],
  'love+transformation': ['Our rescued shapeshifter must regain a gentle form and learn to trust its keeper.',
    'The cursed couple need their true appearances restored and their affection renewed.'],
  'strength+transformation': ['Our scout must change into a strong mountain beast to drag the fallen cart to safety.',
    'The besieged defenders need both a protective disguise and the strength to break free.'],
  'freeze+transformation': ['We must turn the flood into a temporary icy crossing so the children can escape.',
    'The captured spy needs a changed appearance and a frosty trail to throw off pursuers.'],
  'freeze+poison': ['Freeze the infested grain store and poison the insects hidden inside its walls.',
    'Immobilize the venomous marsh vermin with frost and finish them with poison.'],
  'poison+transformation': ['Our enemy must mistake the bait for a harmless feast, then be poisoned by it.',
    'Disguise the trap as a beautiful fruit while lacing it with venom for the invading monster.'],
  'acidity+poison': ['Corrode the burrowing pests’ armored shells and poison them before they spread.',
    'Wither the invasive roots and poison the blight growing beneath them.'],
  'acidity+transformation': ['Change the cursed armor into brittle stone and corrode it to free its wearer.',
    'Transform the locked gate into soft material and eat through it with acid.'],
  'death+poison': ['Poison the necromancer’s undead servants and end the death curse binding them.',
    'Lay the plague spirits to rest and destroy their poisoned vessel.'],
  'death+transformation': ['Return the wandering wraith to its mortal shape, then lay it to rest.',
    'Reveal the disguised revenant and break the death curse animating it.'],
  'fire+strength': ['The forge workers need strength to clear the debris and fire to restart the furnace.',
    'Our lost travelers must stay warm and strong enough to cross the blizzard.']
});
const STORY_ROLES = Object.freeze(['village healer', 'forest ranger', 'guild messenger', 'castle caretaker',
  'travelling trader', 'village elder', 'watch captain', 'wandering scholar', 'farm steward', 'mountain scout']);
const ORDER_CACHE = new Map();
const SIDE_EFFECT_TARGET = .009;
const SIDE_EFFECT_TOLERANCE = UNWANTED_EFFECT_MAX - SIDE_EFFECT_TARGET;
const scenarioKey = wanted => Object.keys(CUSTOMER_SCENARIOS).find(key =>
  key.split('+').sort().join('+') === wanted.slice().sort().join('+'));

/** The client sees only goals, not the recipe. Reference brews are real particle
 * simulations and must meet the same limits before an order is offered. */
export function generateOrder(world, completed = 0, equipment = {}) {
  if (world.legacyCommissions) return generatePhysicalOrder(world, completed, equipment);
  const ingredients = availableIngredients(world, equipment);
  if (!ingredients.some(i => EFFECT_PROPERTIES.some(key => i.material[key] > .01)))
    return generatePhysicalOrder(world, completed, equipment);
  const rng = mulberry32(seedNumber(world.seed + ':effects-order:' + completed));
  const solvent = ingredients.find(i => i.solvent) || ingredients.find(i => !i.form || i.form === 'liquid');
  if (!solvent) throw new Error('A customer potion needs an available liquid solvent.');
  const candidates = ingredients.filter(i => i.id !== solvent.id &&
    !i.recoverOnly && Math.abs(i.material.miscibility - solvent.material.miscibility) < .06);
  // Awakening keeps only the dominant innate channel of a single reagent.
  // A trace secondary channel cannot certify a strong customer demand.
  const dominant = ingredient => EFFECT_PROPERTIES.reduce((best, key) =>
    ingredient.material[key] > (best ? ingredient.material[best] : .003) ? key : best, null);
  const specialists = key => candidates.filter(i => dominant(i) === key && i.material[key] >= .025);
  const possible = EFFECT_SEQUENCE.filter(key => specialists(key).length);
  if (!possible.length) return generatePhysicalOrder(world, completed, equipment);

  // Scenario search runs full physics. Cache only identical catalogs and
  // equipment; callers receive fresh objects so save edits never mutate the cache.
  const cacheKey = JSON.stringify([world, completed, equipment, typeof globalThis.b2World === 'function']);
  if (ORDER_CACHE.has(cacheKey)) return structuredClone(ORDER_CACHE.get(cacheKey));
  const desired = possible[completed % possible.length];
  const strongest = key => specialists(key).sort((a, b) => b.material[key] - a.material[key])[0];
  const primary = strongest(desired);
  const linked = (COMPANIONS[desired] || []).filter(key => possible.includes(key) && strongest(key).id !== primary.id);
  const secondaryEffect = completed >= 2 && linked.length ? linked[Math.floor(rng() * linked.length)] : null;
  const difficulty = Math.min(4, 1 + Math.floor(completed / 3));
  const volume = completed === 0 ? 60 : difficulty < 3 ? 80 : 100;
  const cauldronCapacity = CAPACITY_ML[Math.max(0, Math.min(2, equipment.cauldron || 0))];
  const targetBand = completed < 6 ? [.08, .15] : completed < 12 ? [.16, .3] : [.20, .55];
  // Preserve varied, themed two-effect orders whenever an actual reference
  // infusion proves feasible. Never request concentrations the witness lacks.
  const plans = [
    ...(secondaryEffect ? [secondaryEffect, ...linked.filter(k => k !== secondaryEffect)]
      .map(key => [desired, key]).filter(keys => scenarioKey(keys)) : []),
    [desired],
    ...possible.filter(key => key !== desired).map(key => [key])
  ];
  let choice = null;
  for (const keys of plans) {
    const count = keys.length;
    const intended = completed < 6 ? 15 : completed < 12 ? 40 : count === 1 ? 65 : 40;
    // All reference portions can be entered with the player's 5/10/20/40 controls
    // and fit obtainable ingredient jars, including before capacity upgrades.
    const each = Math.max(10, Math.min(intended, Math.floor((cauldronCapacity - volume - 15) / count / 5) * 5));
    const portion = ingredient => ({
      ingredientId: ingredient.id, ml: each,
      crushed: Boolean(ingredient.form && !['liquid', 'powder'].includes(ingredient.form))
    });
    const parts = keys.map(key => strongest(key));
    const recipe = {
      portions: [{ ingredientId: solvent.id, ml: volume + 15 }, ...parts.map(portion)],
      volume, ticks: count > 1 ? 480 : 440, thermalTicks: count > 1 ? 375 : 340,
      heat: .7, cool: 0, reserveTrial: true, stir: true,
      crush: parts.some(ingredient => ingredient.crushable)
    };
    // Include the solvent in the exact same signed, proportion-weighted rule
    // used by live mixtures; opposite runes can change the required direction.
    const activation = arcaneRecipe(recipe.portions.map(portion => {
      const material = ingredients.find(i => i.id === portion.ingredientId).material;
      return { amount:portion.ml, threshold:material.arcaneThreshold, effects:material };
    }));
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) {
        recipe.ticks += 160;
        recipe.thermalTicks += 130;
        recipe.heat = activation.threshold < 0 ? 0 : 1;
        recipe.cool = recipe.heat ? 0 : .7;
      }
      let sample;
      try { sample = simulateWitness(world, recipe, equipment); } catch { continue; }
      if (sample.volume < volume - .001 || sample.liquidFraction < .98) continue;
      if (keys.some(key => sample[key] < targetBand[0] || sample[key] > targetBand[1])) continue;
      if (EFFECT_PROPERTIES.some(key => !keys.includes(key) && sample[key] > UNWANTED_EFFECT_MAX)) continue;
      choice = { wanted: keys, recipe: { ...recipe, portions: recipe.portions.map(p => ({...p})) }, sample };
      break;
    }
    if (choice) break;
  }
  if (!choice) throw new Error('Could not validate an effect commission within strict magic limits.');
  const { wanted, recipe, sample } = choice;
  /** @type {import('./contracts.mjs').Requirement[]} */
  const requirements = wanted.map(property => ({
    property, target: Math.floor(sample[property] * 1000) / 1000, tolerance: .02, weight: 3, hard: false,
    minimum: Math.max(targetBand[0], Math.floor(sample[property] * 1000 - 20) / 1000),
    comparison: 'target'
  }));
  for (const property of EFFECT_PROPERTIES) {
    if (wanted.includes(property)) continue;
    requirements.push({ property, target: SIDE_EFFECT_TARGET, tolerance: SIDE_EFFECT_TOLERANCE,
      weight: .4, hard: true, comparison: 'maximum' });
  }
  const storyKey = scenarioKey(wanted), stories = CUSTOMER_SCENARIOS[storyKey];
  const narrative = stories[Math.floor(rng() * stories.length)];
  const customer = { id: 'customer-' + completed, name: NAMES[Math.floor(rng() * NAMES.length)],
    role: STORY_ROLES[Math.floor(rng() * STORY_ROLES.length)], portraitSeed: Math.floor(rng() * 0xffffffff),
    dialogue: narrative + ' I need a reliable potion, with no dangerous side effects.' };
  const clue = 'Study the known garden essences and their activation temperatures. Test a spare dose on your familiars, then write your potion ID from their response.';
  const order = { id: world.seed + '-' + completed, conceptVersion: 3, scenarioKey: storyKey, customer, requirements, volume, difficulty,
    budget: Math.round(43 + difficulty * 14 + wanted.length * 6 + rng() * 8), witness: recipe, clue,
    targetDescriptions: Object.fromEntries(requirements.map(r => [r.property, requirementDescription(r)])) };
  if (ORDER_CACHE.size >= 96) ORDER_CACHE.delete(ORDER_CACHE.keys().next().value);
  ORDER_CACHE.set(cacheKey, order);
  return structuredClone(order);
}
