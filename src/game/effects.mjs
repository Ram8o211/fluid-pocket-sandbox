import { clamp } from '../simulation/math.mjs';
import { EFFECT_PROPERTIES, MAGIC_PROPERTIES, CHEMICAL_PROPERTIES } from '../materials/MaterialDefinition.mjs';

export { EFFECT_PROPERTIES, MAGIC_PROPERTIES, CHEMICAL_PROPERTIES };

export const EFFECT_DEFINITIONS = Object.freeze({
  strength: Object.freeze({ label: 'Strength', color: '#f6c15c', kind: 'magic' }),
  love: Object.freeze({ label: 'Love', color: '#ff82bc', kind: 'magic' }),
  death: Object.freeze({ label: 'Death', color: '#b591ed', kind: 'magic' }),
  transformation: Object.freeze({ label: 'Transformation', color: '#65e4c9', kind: 'magic' }),
  fire: Object.freeze({ label: 'Fire', color: '#ff9052', kind: 'magic' }),
  freeze: Object.freeze({ label: 'Frost', color: '#8cdfff', kind: 'magic' }),
  acidity: Object.freeze({ label: 'Acidity', color: '#d5e873', kind: 'chemical' }),
  poison: Object.freeze({ label: 'Poison', color: '#92cc71', kind: 'chemical' })
});

/** Accept a measured vial or a material. Concentrations are always normalized;
 * effect metadata never substitutes for the properties in the actual particles. */
export function readEffects(source = {}) {
  return Object.fromEntries(EFFECT_PROPERTIES.map(property => {
    const value = source?.[property] ?? source?.effects?.[property] ?? 0;
    return [property, clamp(Number.isFinite(value) ? value : 0, 0, 1)];
  }));
}

export function describeEffects(source) {
  const effects = readEffects(source);
  return EFFECT_PROPERTIES.filter(property => effects[property] >= .005)
    .map(property => ({ property, value: effects[property], ...EFFECT_DEFINITIONS[property] }))
    .sort((a, b) => b.value - a.value);
}

/** @typedef {{health:number,vitality:number,growth:number,strength:number,love:number,transformation:number,burning:number,freezing:number,alive:boolean}} SubjectStats */
/** @type {Readonly<SubjectStats>} */
const DEFAULT_STATS = Object.freeze({ health: 100, vitality: 100, growth: 0, strength: 20, love: 0, transformation: 0, burning: 0, freezing: 0, alive: true });

function subjectStats(subject) {
  const source = subject?.stats || subject || {}, stats = { ...DEFAULT_STATS };
  for (const key of Object.keys(DEFAULT_STATS)) {
    if (key !== 'alive' && Number.isFinite(source[key])) stats[key] = clamp(source[key], 0, 100);
  }
  stats.alive = source.alive !== false && stats.health > 0;
  return stats;
}

/** Deterministic, bounded exposure for the experiment room. Called only for a
 * deliberate test; it adds no per-frame subject or particle simulation. */
export function assessEffects(sample, subject = {}, doseMl = 5) {
  const dose = clamp(Number.isFinite(doseMl) ? doseMl : 0, 0, 50);
  const concentration = readEffects(sample), before = subjectStats(subject), after = { ...before };
  const kind = subject.kind === 'plant' ? 'plant' : subject.kind === 'mineral' || subject.kind === 'stone' ? 'mineral' : 'animal';
  const stability = Number.isFinite(sample?.stability) ? clamp(sample.stability / 100, 0, 1) : 1;
  const exposure = dose / 5 * (.65 + .35 * stability);
  const effects = Object.fromEntries(EFFECT_PROPERTIES.map(key => [key, clamp(concentration[key] * exposure, 0, 1)]));
  const observations = [];
  const netFire = Math.max(0, effects.fire - effects.freeze), netFreeze = Math.max(0, effects.freeze - effects.fire);
  const chemicalDamage = effects.poison * (kind === 'plant' ? 72 : 82) + effects.acidity * (kind === 'mineral' ? 60 : 45);
  const harm = chemicalDamage + effects.death * (kind === 'mineral' ? 12 : 100) + netFire * (kind === 'plant' ? 70 : 44) + netFreeze * (kind === 'plant' ? 35 : 20);

  if (dose > 0 && before.alive) {
    after.health = clamp(before.health + effects.strength * 8 + effects.love * 10 - harm, 0, 100);
    if (kind !== 'mineral' && effects.death >= .75) after.health = 0;
    after.vitality = clamp(before.vitality + effects.strength * 20 + effects.love * 18 - harm * .8 - netFreeze * 12, 0, 100);
    after.strength = clamp(before.strength + effects.strength * 65 - effects.poison * 22, 0, 100);
    after.love = clamp(before.love + effects.love * 80, 0, 100);
    after.transformation = clamp(before.transformation + effects.transformation * 100, 0, 100);
    after.burning = clamp(before.burning + netFire * 90 - effects.freeze * 55, 0, 100);
    after.freezing = clamp(before.freezing + netFreeze * 90 - effects.fire * 55, 0, 100);
    if (kind === 'plant') after.growth = clamp(before.growth + effects.love * 28 + effects.strength * 20 + effects.transformation * 18 - harm * .35, 0, 100);
    after.alive = after.health > 0;
    if (!after.alive) after.vitality = 0;
  }

  if (!before.alive) observations.push('The subject is spent. Reset the enclosure for a fresh trial.');
  else if (dose <= 0) observations.push('No dose was applied.');
  else {
    if (effects.strength >= .04) observations.push(kind === 'plant' ? 'The stem thickens and the leaves lift.' : kind === 'mineral' ? 'The stone becomes harder and more resilient.' : 'The subject becomes stronger and more energetic.');
    if (effects.love >= .04) observations.push(kind === 'plant' ? 'Fresh shoots reach towards the light.' : kind === 'mineral' ? 'Rose light gathers along the stone’s edges.' : 'The subject relaxes and approaches with affection.');
    if (effects.transformation >= .04) observations.push(kind === 'plant' ? 'The leaves change shape and unusual buds appear.' : kind === 'mineral' ? 'The stone’s surface grows a new crystalline pattern.' : 'The subject changes colour and begins a magical transformation.');
    if (netFire >= .04) observations.push(kind === 'plant' ? 'Leaf edges singe under the fire enchantment.' : kind === 'mineral' ? 'The stone radiates enchanted heat.' : 'A fire aura appears and raises the subject’s heat.');
    if (netFreeze >= .04) observations.push(kind === 'plant' ? 'Frost gathers on the leaves and slows their growth.' : kind === 'mineral' ? 'A crisp shell of frost coats the stone.' : 'Frost forms and slows the subject’s movement.');
    if (Math.min(effects.fire, effects.freeze) >= .1) observations.push('Fire and frost temper one another in a flash of mist.');
    if (effects.acidity >= .04) observations.push(kind === 'mineral' ? 'The acid etches the stone’s surface.' : 'Acidity irritates the subject and lowers its health.');
    if (effects.poison >= .04) observations.push(kind === 'mineral' ? 'A toxic residue marks the stone.' : kind === 'plant' ? 'Poison dulls the leaves and drains their vitality.' : 'Poison weakens the subject and drains its vitality.');
    if (effects.death >= .04) observations.push(kind === 'mineral' ? 'A dark enchantment dims the stone’s glow.' : after.alive ? 'A death enchantment drains the subject’s life.' : 'The death enchantment extinguishes the subject’s life.');
    if (!after.alive && effects.death < .04) observations.push('The combined exposure overwhelms the subject.');
    if (!observations.length) observations.push('The subject shows no magical or chemical change.');
  }
  const dominantEffect = describeEffects(effects)[0]?.property || null;
  return {
    subjectId: subject.id || null, kind, before, after, effects, observations, dominantEffect,
    color: dominantEffect ? EFFECT_DEFINITIONS[dominantEffect].color : sample?.color || '#afd6de',
    doseMl: dose, safe: after.alive && after.health >= before.health - 8 && effects.poison < .1 && effects.death < .1 && effects.acidity < .2
  };
}
