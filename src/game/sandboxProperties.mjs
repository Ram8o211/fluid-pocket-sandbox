import { EFFECT_PROPERTIES, readEffects } from './effects.mjs';
import { arcaneRecipe } from '../simulation/ArcaneSolver.mjs';

// The ArcaneSolver uses this temperature margin and a 0.4-second charge.
const ARCANE_MARGIN = .015;
const MIN_TEMPERATURE = .01;
const MAX_TEMPERATURE = 1.2;

function dominantEffect(effects) {
  return EFFECT_PROPERTIES.reduce((best, key) => effects[key] > (best ? effects[best] : .003) ? key : best, null);
}
function awakeningDetails(threshold, effects, charged = 0, converted = 0) {
  const direction = threshold >= 0 ? 'above' : 'below';
  const reachable = Number.isFinite(threshold) && (direction === 'above'
    ? threshold + ARCANE_MARGIN < MAX_TEMPERATURE
    : threshold - ARCANE_MARGIN > MIN_TEMPERATURE);
  return { arcaneThreshold: threshold, awakeningDirection: direction,
    awakeningReachable: reachable, dominantEffect: dominantEffect(effects),
    awakeningCharge: charged, awakenedFraction: converted, awakeningEffects: effects };
}


// Arcane temperatures use the game's native scale (0.50 = 50 °A).
// Read live parcel values: recipe proportions alone cannot represent local
// mixing, thermal decay, or the properties of a partially mixed cauldron.
export function sandboxIngredientProperties(ingredient) {
  if (!ingredient?.material) return null;
  const m = ingredient.material;
  return {
    name: ingredient.name,
    form: ingredient.form || 'liquid',
    effects: readEffects(m),
    ...awakeningDetails(m.arcaneThreshold ?? 8,
      arcaneRecipe([{ amount: 1, threshold: m.arcaneThreshold ?? 8, effects: m }])?.effects || readEffects(m)),
    meltingTemperature: m.meltingTemperature,
    boilingTemperature: m.boilingTemperature,
    combustionTemperature: m.combustionTemperature,
    magicDecayTemperature: m.magicDecayTemperature
  };
}

const HOMOGENEITY_FIELDS = Object.freeze([
  'r', 'g', 'b', 'baseDensity', 'viscosity',
  'meltingTemperature', 'boilingTemperature', 'combustionTemperature',
  'arcaneThreshold', 'magicDecayTemperature',
  ...EFFECT_PROPERTIES
]);
const AVERAGE_FIELDS = Object.freeze([...HOMOGENEITY_FIELDS, 'temperature', 'arcaneCharge', 'arcaneConverted']);

export function sandboxMixtureProperties(brew) {
  const ps = brew?.engine?.ps;
  if (!ps?.count) return [];
  const mixtures = brew.engine.reactions?.mixtures;
  const names = new Map((brew.ingredients || []).map(ingredient => [ingredient.id, ingredient.name]));
  const groups = new Map();

  for (let i = 0; i < ps.count; i++) {
    const mass = ps.mass[i];
    if (!Number.isFinite(mass) || mass <= 0) continue;
    const assignedGroup = ps.mixtureGroup[i];
    const root = assignedGroup ? mixtures?.root?.(assignedGroup) : null;
    const key = assignedGroup ? 'group:' + (root?.id ?? assignedGroup) : 'material:' + ps.materialId[i];
    let group = groups.get(key);
    if (!group) {
      group = {
        id: key, mass: 0, count: 0, sources: new Map(),
        sums: Object.fromEntries(AVERAGE_FIELDS.map(field => [field, 0])),
        squares: Object.fromEntries(HOMOGENEITY_FIELDS.map(field => [field, 0]))
      };
      groups.set(key, group);
    }
    group.mass += mass;
    group.count++;
    group.sources.set(ps.materialId[i], (group.sources.get(ps.materialId[i]) || 0) + mass);
    for (const field of AVERAGE_FIELDS) {
      const value = ps[field]?.[i] ?? 0;
      group.sums[field] += value * mass;
      if (field in group.squares) group.squares[field] += value * value * mass;
    }
  }

  return [...groups.values()].sort((a, b) => b.mass - a.mass).map((group, index) => {
    const average = field => group.sums[field] / group.mass;
    const dispersion = Math.max(...HOMOGENEITY_FIELDS.map(field => {
      const mean = average(field);
      return Math.sqrt(Math.max(0, group.squares[field] / group.mass - mean * mean));
    }));
    // A compatibility group forms at first contact, before it has blended.
    // Its group mean must NOT be presented as an existing homogeneous potion.
    const homogeneous = dispersion <= 0.035;
    const root = group.id.startsWith('group:') ? mixtures?.root?.(Number(group.id.slice(6))) : null;
    // Show the SAME original volume shares the rune calculation uses. Live
    // material IDs and particle masses can be distorted by density or fusion.
    const shares = root?.sourceAmounts?.size ? root.sourceAmounts : group.sources;
    const shareTotal = [...shares.values()].reduce((sum, amount) => sum + amount, 0);
    const sources = [...shares].filter(([, amount]) => amount > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id, amount]) => ({ id, name: names.get(id) || 'Ingredient ' + id, fraction: amount / shareTotal }));
    const recipe = root?.arcaneRecipe;
    return {
      id: group.id, label: 'Pot mixture ' + (index + 1),
      mass: group.mass, count: group.count, sources, homogeneous, dispersion,
      temperature: average('temperature'),
      effects: Object.fromEntries(EFFECT_PROPERTIES.map(key => [key, average(key)])),
      ...awakeningDetails(recipe?.threshold ?? average('arcaneThreshold'),
        recipe?.effects ?? Object.fromEntries(EFFECT_PROPERTIES.map(key => [key, average(key)])),
        average('arcaneCharge'), average('arcaneConverted')),
      meltingTemperature: average('meltingTemperature'),
      boilingTemperature: average('boilingTemperature'),
      combustionTemperature: average('combustionTemperature'),
      magicDecayTemperature: average('magicDecayTemperature')
    };
  });
}
