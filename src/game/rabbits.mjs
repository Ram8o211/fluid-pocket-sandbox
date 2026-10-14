import { EFFECT_DEFINITIONS, EFFECT_PROPERTIES, readEffects } from './effects.mjs';

export const RABBIT_CAPACITY = 12;
export const RABBIT_DEAD_LIMIT = 24;
export const RABBIT_EVENT_LIMIT = 60;
export const RABBIT_GROWTH_MS = 120000;
export const RABBIT_ATTACK_GRACE_MS = 6500;
export const RABBIT_THRESHOLDS = Object.freeze({ strength: 3, love: 2.5, acidity: 2.5, fire: 2.5,
  freeze: 4, transformation: 3, poison: 1.25, death: 1.25 });

const clamp = (value, low = 0, high = 100) => Math.max(low, Math.min(high, value));
const number = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const fill = (source, defaults) => Object.fromEntries(Object.entries(defaults).map(([key, value]) =>
  [key, source?.[key] === undefined ? value : source[key]]));
const exposureDefaults = () => Object.fromEntries(EFFECT_PROPERTIES.map(key => [key, 0]));
const validTime = now => { if (!Number.isFinite(now) || now < 0) throw new Error('Invalid rabbit colony time.'); return now; };

function seedFor(text) {
  let seed = 2166136261;
  for (const character of String(text)) { seed ^= character.charCodeAt(0); seed = Math.imul(seed, 16777619); }
  return seed >>> 0;
}

/** A fixed anatomical recipe. Exposure changes its scale, never its identity. */
function mutationFor(id, bornAt = 0) {
  const seed = seedFor(`rabbit-phenotype:${id}:${bornAt}`);
  let value = seed;
  const random = () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
  const outcome = random() < .58 ? 'creature' : 'deformation';
  const traits = Object.fromEntries(['ears', 'horns', 'limbs', 'eyes', 'spine', 'tail', 'asymmetry']
    .map(trait => [trait, .15 + random() * .85]));
  const colors = ['#9bc8a0', '#bb8bbf', '#91bccc', '#c1bb7c', '#b393cf', '#84bcae'];
  return { seed, outcome, traits, hue: colors[Math.floor(random() * colors.length)] };
}

function freshRabbit(serial, now, baby = false) {
  const id = `rabbit-${serial}`;
  return {
    id, name: baby ? `Kit ${serial}` : ['Moon', 'Clover', 'Hazel', 'Pepper'][serial - 1] || `Rabbit ${serial}`,
    kind: 'animal', species: 'rabbit', icon: 'rabbit', description: 'A living, individual potion trial subject.',
    sex: serial % 2 ? 'female' : 'male', age: baby ? 'baby' : 'adult', bornAt: now,
    adultAt: baby ? now + RABBIT_GROWTH_MS : now, location: 'pen',
    stats: { health: 100, vitality: 100, growth: baby ? 0 : 100, strength: baby ? 8 : 20,
      love: 0, transformation: 0, burning: 0, freezing: 0, alive: true,
      muscleMass: 0, corrosion: 0, scorch: 0, aggression: 0, mutationStage: 0, doseCount: 0, totalDoseMl: 0 },
    exposure: exposureDefaults(), mutation: mutationFor(id, now), infantDoseMl: 0,
    dangerous: false, transformed: false, attackReadyAt: 0, nextAttackAt: 0,
    nextBreedAt: now + 6000, courtingWith: null, courtshipUntil: 0,
    activeFireUntil: 0, causeOfDeath: null, deathAppearance: null, deathAt: 0,
    readyAt: 0, trials: 0, lastTestAt: 0
  };
}

export function createRabbitColony(now = Date.now()) {
  validTime(now);
  return { rabbits: Array.from({ length: 4 }, (_, index) => freshRabbit(index + 1, now)),
    rabbitSerial: 4, lastAdvancedAt: now, events: [], eventSerial: 0, capacity: RABBIT_CAPACITY };
}

function legacyExposure(source) {
  const stats = source?.stats || {};
  return { ...exposureDefaults(), strength: Math.max(0, number(stats.strength, 20) - 20) / 80 * RABBIT_THRESHOLDS.strength,
    love: number(stats.love) / 100 * 3, transformation: number(stats.transformation) / 100 * RABBIT_THRESHOLDS.transformation,
    fire: number(stats.burning) / 100 * RABBIT_THRESHOLDS.fire,
    freeze: number(stats.freezing) / 100 * RABBIT_THRESHOLDS.freeze,
    acidity: number(stats.corrosion) / 100 * RABBIT_THRESHOLDS.acidity };
}

function migrateRabbit(source, serial, now, legacy = false) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
  const defaults = freshRabbit(serial, now, source?.age === 'baby');
  const rabbit = { ...defaults, ...source };
  if (legacy) { rabbit.id = defaults.id; rabbit.species = 'rabbit'; rabbit.kind = 'animal'; }
  if (source?.stats !== undefined && (!source.stats || typeof source.stats !== 'object' || Array.isArray(source.stats))) return rabbit;
  rabbit.stats = { ...defaults.stats, ...source?.stats };
  if (source?.exposure === undefined) rabbit.exposure = legacyExposure(source);
  else if (source.exposure && typeof source.exposure === 'object' && !Array.isArray(source.exposure)) rabbit.exposure = { ...exposureDefaults(), ...source.exposure };
  rabbit.mutation = source?.mutation === undefined ? mutationFor(rabbit.id, rabbit.bornAt) : source.mutation;
  // Keep present invalid values intact: persistence validation must reject them.
  if (legacy && rabbit.stats.alive === false && rabbit.causeOfDeath === null) {
    rabbit.causeOfDeath = 'Previous potion exposure'; rabbit.deathAppearance = 'collapsed'; rabbit.deathAt = now;
  }
  if (source?.stats?.muscleMass === undefined) rabbit.stats.muscleMass = clamp(number(rabbit.exposure?.strength) / 3 * 100);
  if (source?.stats?.corrosion === undefined) rabbit.stats.corrosion = clamp(number(rabbit.exposure?.acidity) / 2.5 * 100);
  if (source?.stats?.scorch === undefined) rabbit.stats.scorch = clamp(number(rabbit.exposure?.fire) / 2.5 * 100);
  if (source?.stats?.mutationStage === undefined) rabbit.stats.mutationStage = clamp(number(rabbit.exposure?.transformation) / 3 * 100);
  return rabbit;
}

/** Current-schema values are preserved; only missing colony fields are added. */
export function migrateRabbitColony(experiments = {}, now = Date.now()) {
  validTime(now);
  /** @type {any} */
  const source = experiments && typeof experiments === 'object' ? experiments : {};
  let rabbits;
  if (source.rabbits === undefined) {
    const legacy = source.subjects?.rabbit;
    rabbits = createRabbitColony(now).rabbits;
    if (legacy) rabbits[0] = migrateRabbit(legacy, 1, now, true);
  } else if (Array.isArray(source.rabbits)) {
    rabbits = source.rabbits.map((rabbit, index) => migrateRabbit(rabbit, index + 1, now));
  } else rabbits = source.rabbits;
  const maxSerial = Array.isArray(rabbits) ? rabbits.reduce((max, rabbit) =>
    Math.max(max, Number(/^rabbit-(\d+)$/.exec(rabbit?.id)?.[1]) || 0), 0) : 0;
  return { ...source, rabbits,
    ...fill(source, { rabbitSerial: maxSerial, lastAdvancedAt: now, events: [], eventSerial: 0, capacity: RABBIT_CAPACITY }),
    subjects: { rabbit: Array.isArray(rabbits) ? rabbits[0] : null } };
}

export function rabbitById(experiments, id) {
  return id === 'rabbit' ? experiments?.rabbits?.[0] || experiments?.subjects?.rabbit || null
    : experiments?.rabbits?.find(rabbit => rabbit.id === id) || null;
}

function colonyFor(state, now) {
  state.experiments ||= { records: [], serial: 0, ...createRabbitColony(now) };
  if (!Array.isArray(state.experiments.rabbits)) Object.assign(state.experiments, migrateRabbitColony(state.experiments, now));
  return state.experiments;
}

export function appendRabbitEvent(experiments, type, message, now, rabbitId, relatedRabbitId = null) {
  experiments.events ||= [];
  experiments.eventSerial = (experiments.eventSerial || 0) + 1;
  const event = { id: `rabbit-event-${experiments.eventSerial}`, at: now, type, rabbitId, message };
  if (relatedRabbitId) event.relatedRabbitId = relatedRabbitId;
  experiments.events.unshift(event);
  experiments.events.length = Math.min(experiments.events.length, RABBIT_EVENT_LIMIT);
  return event;
}

function boundArchive(experiments) {
  const dead = experiments.rabbits.filter(rabbit => !rabbit.stats.alive);
  if (dead.length > RABBIT_DEAD_LIMIT) {
    const discard = new Set(dead.sort((a, b) => a.deathAt - b.deathAt).slice(0, dead.length - RABBIT_DEAD_LIMIT).map(rabbit => rabbit.id));
    experiments.rabbits = experiments.rabbits.filter(rabbit => !discard.has(rabbit.id));
  }
  experiments.subjects = { rabbit: experiments.rabbits[0] };
}

function die(rabbit, cause, appearance, now) {
  rabbit.stats.alive = false; rabbit.stats.health = 0; rabbit.stats.vitality = 0;
  rabbit.causeOfDeath = cause; rabbit.deathAppearance = appearance; rabbit.deathAt = now;
  rabbit.dangerous = false; rabbit.courtingWith = null; rabbit.courtshipUntil = 0;
  rabbit.activeFireUntil = 0;
}

export function rabbitPurchasePrice(state) { return state.mode === 'sandbox' ? 0 : state.equipment?.densimeter ? 6 : 8; }

export function buyRabbit(state, now = Date.now()) {
  validTime(now);
  const experiments = colonyFor(state, now);
  if (experiments.rabbits.filter(rabbit => rabbit.stats.alive).length >= experiments.capacity) throw new Error('The pen is full. There is room for twelve living rabbits.');
  const price = rabbitPurchasePrice(state);
  if (price > 0 && !(state.coins >= price)) throw new Error(`A healthy adult rabbit costs ${price} coins.`);
  if (price > 0) state.coins = Math.round((state.coins - price) * 100) / 100;
  const rabbit = freshRabbit(++experiments.rabbitSerial, now);
  experiments.rabbits.push(rabbit);
  appendRabbitEvent(experiments, 'purchase', `${rabbit.name} joins the pen as a healthy adult.`, now, rabbit.id);
  boundArchive(experiments);
  return rabbit;
}

function interruptCourtship(experiments, rabbit) {
  for (const partner of experiments.rabbits) if (partner.courtingWith === rabbit.id) {
    partner.courtingWith = null; partner.courtshipUntil = 0;
  }
  rabbit.courtingWith = null; rabbit.courtshipUntil = 0;
}

export function moveRabbit(state, id, location, now = Date.now()) {
  validTime(now);
  if (!['pen', 'cage'].includes(location)) throw new Error('Choose the shared pen or isolation cage.');
  const experiments = colonyFor(state, now), rabbit = rabbitById(experiments, id);
  if (!rabbit) throw new Error('Choose a rabbit.');
  if (!rabbit.stats.alive) throw new Error('A dead rabbit cannot be moved for another trial.');
  if (rabbit.location === location) return rabbit;
  if (location === 'cage') for (const other of experiments.rabbits) if (other.location === 'cage') {
    interruptCourtship(experiments, other); other.location = 'pen';
    if (other.dangerous) { other.attackReadyAt = now + RABBIT_ATTACK_GRACE_MS; other.nextAttackAt = other.attackReadyAt; }
  }
  interruptCourtship(experiments, rabbit); rabbit.location = location;
  if (location === 'pen' && rabbit.dangerous) { rabbit.attackReadyAt = now + RABBIT_ATTACK_GRACE_MS; rabbit.nextAttackAt = rabbit.attackReadyAt; }
  appendRabbitEvent(experiments, 'move', `${rabbit.name} ${location === 'cage' ? 'is isolated for a trial' : 'returns to the shared pen'}.`, now, rabbit.id);
  return rabbit;
}

export function cullRabbit(state, id, now = Date.now()) {
  validTime(now);
  const experiments = colonyFor(state, now), rabbit = rabbitById(experiments, id);
  if (!rabbit) throw new Error('Choose a rabbit.');
  if (!rabbit.stats.alive) return rabbit;
  die(rabbit, 'Culled by the player', 'culled', now);
  appendRabbitEvent(experiments, 'cull', `${rabbit.name} was culled. Its trial observations are preserved.`, now, rabbit.id);
  boundArchive(experiments);
  return rabbit;
}

function normalizedRabbit(rabbit, now) {
  const serial = Number(/^rabbit-(\d+)$/.exec(rabbit?.id)?.[1]) || 1;
  return migrateRabbit(structuredClone(rabbit || {}), serial, now);
}

const STRENGTH_STAGES = ['The shoulders and haunches begin to thicken.', 'Individual chest and thigh muscles visibly swell.',
  'Huge muscles distort the body; its movement becomes strained.', 'Muscles crowd the body; the rabbit trembles under their weight.'];
const ACID_STAGES = ['Bubbling acid leaves bare patches in the fur.', 'Fur and tissue erode, leaving visible gaps in the silhouette.',
  'Deep corrosion consumes much of the body.', 'Only a thinning, partially dissolved silhouette remains.'];
const FIRE_STAGES = ['Small flames flicker out, leaving singed fur.', 'Larger flames spread and leave permanent dark scorch patches.',
  'Fire engulfs much of the body; the rabbit staggers.', 'Intense flames turn nearly all of the fur and body to charcoal.'];
const stageText = (texts, normalized) => texts[Math.min(3, Math.floor(clamp(normalized, 0, .999999) * 4))];

/** Pure dose resolution. The caller owns potion transfer, cooldown and records. */
export function assessRabbitEffects(sample, rabbit, doseMl = 5, now = Date.now()) {
  validTime(now);
  const dose = clamp(number(doseMl), 0, 50), concentration = readEffects(sample);
  const beforeRabbit = normalizedRabbit(rabbit, now), afterRabbit = structuredClone(beforeRabbit);
  const before = structuredClone(beforeRabbit.stats), after = afterRabbit.stats, observations = [];
  const sensitivity = beforeRabbit.age === 'baby' ? 3.3 : 1;
  const stability = Number.isFinite(sample?.stability) ? clamp(sample.stability, 0, 100) / 100 : 1;
  const unitDose = dose / 5 * (.65 + .35 * stability) * sensitivity;
  const doseExposure = Object.fromEntries(EFFECT_PROPERTIES.map(key => [key, concentration[key] * unitDose]));
  const effects = Object.fromEntries(EFFECT_PROPERTIES.map(key => [key, clamp(doseExposure[key], 0, 1)]));
  const netFire = Math.max(0, doseExposure.fire - doseExposure.freeze);
  const netFreeze = Math.max(0, doseExposure.freeze - doseExposure.fire);

  if (!before.alive) observations.push('This rabbit is dead; buy or select another living rabbit for a trial.');
  else if (dose <= 0) observations.push('No dose was applied.');
  else {
    for (const key of EFFECT_PROPERTIES) afterRabbit.exposure[key] += key === 'fire' ? netFire : key === 'freeze' ? netFreeze : doseExposure[key];
    // Frost can be melted, but an extinguished fire still leaves its accumulated burns.
    afterRabbit.exposure.freeze = Math.max(0, afterRabbit.exposure.freeze - netFire * .6);
    after.doseCount += 1; after.totalDoseMl += dose;
    if (beforeRabbit.age === 'baby') afterRabbit.infantDoseMl += dose;
    after.muscleMass = clamp(afterRabbit.exposure.strength / RABBIT_THRESHOLDS.strength * 100);
    after.strength = clamp((beforeRabbit.age === 'baby' ? 8 : 20) + after.muscleMass * .8);
    after.love = clamp(afterRabbit.exposure.love / 3 * 100);
    after.transformation = after.mutationStage = clamp(afterRabbit.exposure.transformation / RABBIT_THRESHOLDS.transformation * 100);
    after.corrosion = clamp(afterRabbit.exposure.acidity / RABBIT_THRESHOLDS.acidity * 100);
    after.scorch = clamp(afterRabbit.exposure.fire / RABBIT_THRESHOLDS.fire * 100);
    after.burning = after.scorch;
    after.freezing = clamp(afterRabbit.exposure.freeze / RABBIT_THRESHOLDS.freeze * 100);
    after.aggression = clamp((afterRabbit.exposure.love - 1.7) / 1.3 * 100);
    const infantHarm = beforeRabbit.age === 'baby' ? dose / 15 * 100 : 0;
    const harm = doseExposure.acidity / 2.5 * 100 + doseExposure.poison / 1.25 * 100 +
      doseExposure.death / 1.25 * 100 + netFire / 2.5 * 100 + netFreeze / 4 * 100 + infantHarm;
    after.health = clamp(before.health - harm);
    after.vitality = clamp(before.vitality - harm * .8 - netFreeze * 8);
    if (after.muscleMass > 75) after.health = Math.min(after.health, clamp((100 - after.muscleMass) * 4));
    afterRabbit.activeFireUntil = netFire > .005 ? now + Math.min(7000, 1800 + netFire * 3000) : afterRabbit.activeFireUntil;
    if (doseExposure.freeze > doseExposure.fire) afterRabbit.activeFireUntil = Math.min(afterRabbit.activeFireUntil, now + 450);
    afterRabbit.transformed = afterRabbit.exposure.transformation >= 3 && afterRabbit.mutation.outcome === 'creature';
    afterRabbit.dangerous = afterRabbit.exposure.love >= RABBIT_THRESHOLDS.love || afterRabbit.transformed;
    if (afterRabbit.dangerous && !beforeRabbit.dangerous) {
      afterRabbit.attackReadyAt = now + RABBIT_ATTACK_GRACE_MS;
      afterRabbit.nextAttackAt = afterRabbit.attackReadyAt;
      afterRabbit.courtingWith = null; afterRabbit.courtshipUntil = 0;
    }

    if (doseExposure.strength > .005) observations.push(stageText(STRENGTH_STAGES, after.muscleMass / 100));
    if (doseExposure.love > .005) observations.push(afterRabbit.exposure.love >= 2.5
      ? 'Affection turns aggressive: red eyes and frantic movement warn of attacks on penmates.'
      : afterRabbit.exposure.love >= 1 ? 'Persistent hearts and urgent courtship reveal accelerated coupling.' : 'Pink cheeks and small hearts appear; the rabbit seeks a partner.');
    if (doseExposure.acidity > .005) observations.push(stageText(ACID_STAGES, after.corrosion / 100));
    if (netFire > .005) observations.push(stageText(FIRE_STAGES, after.scorch / 100));
    if (netFreeze > .005) observations.push(after.freezing > 60 ? 'Thick ice coats the body and its stiffened movement slows severely.' : 'Pale frost coats the ears and fur; movement slows.');
    if (Math.min(doseExposure.fire, doseExposure.freeze) > .005) observations.push('Fire and frost cancel in a brief cloud of steam; existing scorch marks remain.');
    if (doseExposure.transformation > .005) observations.push(afterRabbit.transformed
      ? 'The established mutations grow into a dangerous new creature.'
      : after.mutationStage > 70 ? 'The same altered anatomy swells into huge, unstable deformations.'
        : after.mutationStage > 35 ? 'Existing altered ears, limbs and features grow; new traits join the same pattern.'
          : 'Small, asymmetric changes appear in the ears, eyes and body shape.');
    if (doseExposure.poison > .005) observations.push(afterRabbit.exposure.poison > .8 ? 'A sickly green cast, trembling and laboured movement show severe poisoning.' : 'A greenish tint and drooping posture reveal accumulating poison.');
    if (doseExposure.death > .005) observations.push('A dark aura drains vitality; its eyes and posture become dull.');
    if (beforeRabbit.age === 'baby') observations.push('The baby cannot tolerate ordinary trial doses; even a weak potion rapidly exhausts it.');

    let cause = null, appearance = 'collapsed';
    if (afterRabbit.exposure.acidity >= 2.5) { cause = 'Acid dissolution'; appearance = 'dissolved'; }
    else if (afterRabbit.exposure.fire >= 2.5) { cause = 'Fatal burns'; appearance = 'charred'; }
    else if (afterRabbit.exposure.strength >= 3) cause = 'Fatal muscle overgrowth';
    else if (afterRabbit.exposure.transformation >= 3 && afterRabbit.mutation.outcome === 'deformation') { cause = 'Fatal transformation'; appearance = 'deformed'; }
    else if (afterRabbit.exposure.death >= 1.25) cause = 'Death enchantment';
    else if (afterRabbit.exposure.poison >= 1.25) cause = 'Poison overdose';
    else if (afterRabbit.exposure.freeze >= 4) cause = 'Fatal freezing';
    else if (beforeRabbit.age === 'baby' && afterRabbit.infantDoseMl >= 15) cause = 'Infant dose intolerance';
    else if (after.health <= .000001) { cause = beforeRabbit.age === 'baby' ? 'Infant dose intolerance' : 'Combined potion exposure';
      if (netFire > 0 && netFire >= doseExposure.poison + doseExposure.death + doseExposure.acidity) appearance = 'charred'; }
    if (cause) {
      die(afterRabbit, cause, appearance, now);
      observations.push(appearance === 'dissolved' ? 'The rabbit dissolves completely.' : appearance === 'charred' ? 'The fire leaves a completely carbonized body.' : `The rabbit dies: ${cause.toLowerCase()}.`);
    } else if (afterRabbit.dangerous && !beforeRabbit.dangerous) observations.push(afterRabbit.location === 'pen'
      ? 'Danger: isolate or cull it before the warning period ends.' : 'The isolation cage prevents attacks on other rabbits.');
    if (!observations.length) observations.push('No distinct magical change is visible at this dose.');
  }
  const dominantEffect = EFFECT_PROPERTIES.reduce((best, key) => doseExposure[key] > (best ? doseExposure[best] : .000001) ? key : best, null);
  return { subjectId: beforeRabbit.id, kind: 'animal', before, after: structuredClone(after), beforeRabbit, afterRabbit,
    effects, doseExposure, observations, dominantEffect, color: dominantEffect ? EFFECT_DEFINITIONS[dominantEffect].color : sample?.color || '#afd6de',
    doseMl: dose, safe: after.alive && !afterRabbit.dangerous && beforeRabbit.age !== 'baby' && after.health >= before.health - 8 &&
      doseExposure.poison < .1 && doseExposure.death < .1 && doseExposure.acidity < .2 };
}

/** One bounded colony step: no offline attack replay and at most one birth/attack. */
export function advanceRabbits(state, now = Date.now()) {
  validTime(now);
  const experiments = colonyFor(state, now), events = [];
  if (now < experiments.lastAdvancedAt) return events;
  const elapsed = now - experiments.lastAdvancedAt;
  for (const rabbit of experiments.rabbits) if (rabbit.stats.alive && rabbit.age === 'baby') {
    rabbit.stats.growth = clamp((now - rabbit.bornAt) / RABBIT_GROWTH_MS * 100);
    if (now >= rabbit.adultAt) {
      rabbit.age = 'adult'; rabbit.stats.growth = 100; rabbit.stats.strength = Math.max(20, rabbit.stats.strength);
      rabbit.nextBreedAt = now + 6000;
      events.push(appendRabbitEvent(experiments, 'mature', `${rabbit.name} has grown into an adult; previous injuries remain.`, now, rabbit.id));
    }
  }
  if (elapsed > 15000) {
    for (const rabbit of experiments.rabbits) if (rabbit.stats.alive) {
      if (rabbit.dangerous) { rabbit.attackReadyAt = now + RABBIT_ATTACK_GRACE_MS; rabbit.nextAttackAt = rabbit.attackReadyAt; }
      rabbit.courtingWith = null; rabbit.courtshipUntil = 0; rabbit.nextBreedAt = Math.max(rabbit.nextBreedAt, now + 4000);
    }
    experiments.lastAdvancedAt = now; boundArchive(experiments); return events;
  }
  const pen = experiments.rabbits.filter(rabbit => rabbit.stats.alive && rabbit.location === 'pen');
  for (const attacker of pen) {
    if (!attacker.dangerous || now < attacker.attackReadyAt || now < attacker.nextAttackAt) continue;
    const victim = pen.find(rabbit => rabbit.id !== attacker.id && rabbit.stats.alive);
    if (!victim) continue;
    const damage = attacker.transformed || victim.age === 'baby' ? 100 : 60 + Math.max(0, attacker.exposure.love - 2.5) * 25;
    victim.stats.health = clamp(victim.stats.health - damage); victim.stats.vitality = clamp(victim.stats.vitality - damage);
    attacker.nextAttackAt = now + 7000;
    events.push(appendRabbitEvent(experiments, 'attack', `${attacker.name} attacks ${victim.name}. ${victim.stats.health > 0 ? 'Isolate or cull the aggressor quickly.' : 'The attack is fatal.'}`, now, attacker.id, victim.id));
    if (victim.stats.health <= 0) {
      die(victim, `Killed by ${attacker.name}`, 'collapsed', now);
      events.push(appendRabbitEvent(experiments, 'death', `${victim.name} was killed by ${attacker.name}.`, now, victim.id, attacker.id));
    }
    break;
  }
  if (experiments.rabbits.filter(rabbit => rabbit.stats.alive).length < experiments.capacity) {
    const adults = pen.filter(rabbit => rabbit.stats.alive && rabbit.age === 'adult' && !rabbit.dangerous && rabbit.stats.health >= 25);
    for (const mother of adults.filter(rabbit => rabbit.sex === 'female')) {
      const father = adults.find(rabbit => rabbit.sex === 'male' && rabbit.id !== mother.id &&
        now >= rabbit.nextBreedAt && Math.max(rabbit.exposure.love, mother.exposure.love) >= .18);
      if (!father || now < mother.nextBreedAt) continue;
      const affection = Math.max(mother.exposure.love, father.exposure.love);
      if (mother.courtingWith !== father.id) {
        mother.courtingWith = father.id; father.courtingWith = mother.id;
        mother.courtshipUntil = father.courtshipUntil = now + Math.max(1400, 6000 / (1 + affection * 2));
        events.push(appendRabbitEvent(experiments, 'courtship', `${mother.name} and ${father.name} begin coupling under the love enchantment.`, now, mother.id, father.id));
        break;
      }
      if (now < mother.courtshipUntil) continue;
      const baby = freshRabbit(++experiments.rabbitSerial, now, true);
      baby.parents = [mother.id, father.id]; experiments.rabbits.push(baby);
      const cooldown = Math.max(4500, 24000 / (1 + affection * 2.5));
      mother.nextBreedAt = father.nextBreedAt = now + cooldown;
      mother.courtingWith = father.courtingWith = null; mother.courtshipUntil = father.courtshipUntil = 0;
      events.push(appendRabbitEvent(experiments, 'birth', `${baby.name} is born. Babies need two minutes to grow and tolerate very little potion.`, now, baby.id, mother.id));
      break;
    }
  }
  experiments.lastAdvancedAt = now; boundArchive(experiments);
  return events;
}
