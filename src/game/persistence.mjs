import { SAVE_VERSION } from './contracts.mjs';
import { generateWorld, generateStarterPowders, migrateIngredients } from './world.mjs';
import { newShop } from './economy.mjs';
import { PROPERTIES } from './contracts.mjs';
import { EFFECT_PROPERTIES } from './effects.mjs';
import { createForaging } from './gathering.mjs';
import { createExperimentState, EXPERIMENT_RECORD_LIMIT } from './experiments.mjs';
import { migrateRabbitColony, RABBIT_EVENT_LIMIT } from './rabbits.mjs';
import { generateOrder } from './orders.mjs';
import { observedPotion } from './knowledge.mjs';
import { validatePotionContents } from './potionTransfer.mjs';

export const SAVE_KEY = 'alchemists-shop-save';
export const SANDBOX_SAVE_KEY = 'alchemists-shop-sandbox-save';

const migrateSample = sample => sample && ({ ...sample, ...Object.fromEntries(EFFECT_PROPERTIES.map(key => [key, sample[key] ?? sample.effects?.[key] ?? 0])),
  effects: Object.fromEntries(EFFECT_PROPERTIES.map(key => [key, sample[key] ?? sample.effects?.[key] ?? 0])) });

export function migrateSave(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Unreadable shop save.');
  if (raw.version > SAVE_VERSION) throw new Error('This save belongs to a newer game. It has been preserved.');
  if (raw.version === 1) {
    const defaults = newShop(raw.world || generateWorld(raw.seed));
    raw = { ...defaults, ...raw, version: 2, soldOrderIds: raw.soldOrderIds || [], debt: raw.debt || 0, settings: { ...defaults.settings, ...raw.settings } };
  }
  if (raw.version === 2) {
    if (!raw.world?.ingredients?.length || !raw.inventory) throw new Error('Missing world ingredients or stock.');
    const added = generateStarterPowders(raw.world.seed).filter(p => !raw.world.ingredients.some(i => i.id === p.id));
    // Keep pinned liquids, customer targets and the physical brew intact. Grant
    // only newly added stock; reloading never refills powders already consumed.
    const world = { ...raw.world, ingredients: [...raw.world.ingredients, ...added] };
    const inventory = { ...raw.inventory, ...Object.fromEntries(added.map(i => [i.id, 240])) };
    raw = { ...raw, version: 3, world, inventory };
  }
  if (raw.version === 3) {
    const world = migrateIngredients(raw.world);
    raw = { ...raw, version: 4, world, mode: raw.mode === 'sandbox' ? 'sandbox' : 'shop',
      foraging: raw.foraging || createForaging(world), experiments: raw.experiments || createExperimentState(),
      pendingBottle: migrateSample(raw.pendingBottle),
      discoveries: (raw.discoveries || []).map(discovery => ({ ...discovery, sample: migrateSample(discovery.sample) })),
      lastSale: raw.lastSale ? { ...raw.lastSale, sample: migrateSample(raw.lastSale.sample) } : null };
  }
  if (raw.version === 4) {
    const world = migrateIngredients(raw.world);
    const garden = createForaging(world);
    const nodes = garden.nodes.map(node => { const old = raw.foraging?.nodes?.find(n => n.id === node.id); return old ? { ...node, stock: Math.min(node.capacity, old.stock), updatedAt: old.updatedAt } : node; });
    raw = { ...raw, version: 5, world, gameplayVersion: 2, inventory: { ...Object.fromEntries(world.ingredients.map(i => [i.id,0])), ...raw.inventory },
      foraging: { ...garden, ...raw.foraging, nodes }, potionIds: [], certificates: [], deliveries: [], complaints: [], negotiation: null, purchases: {} };
  }
  if (raw.version !== SAVE_VERSION) throw new Error('Unsupported shop save. It has been preserved.');
  if (raw.world?.ingredients?.length)
    raw = { ...raw, world: migrateIngredients(raw.world) };
  // Switch an untouched commission to the effects concept without replacing an
  // in-progress brew, bottled potion, inventory, or completed customer sale.
  if (raw.mode === 'shop' && !raw.world?.legacyCommissions && raw.order?.conceptVersion !== 3 && raw.stage === 'brewing' && !raw.pendingBottle && !raw.brew?.count && raw.world?.ingredients?.length)
    raw = { ...raw, order: generateOrder(raw.world, raw.completed, raw.equipment) };
  raw = { ...raw, experiments: migrateRabbitColony(raw.experiments || createExperimentState(), Date.now()) };
  raw.discoveries = (raw.discoveries || []).map(discovery => discovery.tested === undefined ? { ...discovery,
    tested: Boolean(observedPotion(raw, discovery.sample)), observations: observedPotion(raw, discovery.sample)?.observations || [] } : discovery);
  return raw;
}

export function validateSave(state) {
  const nonnegative = n => Number.isFinite(n) && n >= 0;
  const validEffects = source => EFFECT_PROPERTIES.every(key => Number.isFinite(source?.[key]) && source[key] >= 0 && source[key] <= 1);
  const validBatch = source => source.batchId === undefined || typeof source.batchId === 'string' && source.batchId.length > 0 && source.batchId.length <= 80;
  const validSample = sample => sample && validBatch(sample) && nonnegative(sample.volume) && sample.volume > 0 && nonnegative(sample.mass) && sample.mass > 0 &&
    sample.cost && Object.values(sample.cost).every(nonnegative) && Number.isFinite(sample.temperature) && validEffects(sample);
  if (typeof state.seed !== 'string' || !state.seed || !nonnegative(state.coins) || !nonnegative(state.reputation) || state.reputation > 100 || !Number.isInteger(state.completed) || state.completed < 0) throw new Error('Invalid shop totals.');
  if (!state.world?.ingredients?.length || state.world.seed !== state.seed) throw new Error('Missing world ingredients.');
  const ids = new Set();
  for (const ingredient of state.world.ingredients) {
    const material = ingredient?.material;
    if (!Number.isInteger(ingredient?.id) || ids.has(ingredient.id) || material?.id !== ingredient.id || !nonnegative(ingredient.price) || typeof ingredient.name !== 'string') throw new Error('Invalid saved ingredient.');
    ids.add(ingredient.id);
    for (const key of ['density', 'viscosity', 'cohesion', 'miscibility', 'meltingTemperature', 'boilingTemperature', 'heatCapacity', 'thermalConductivity', 'volatility', 'reactionPotential', 'reactionHeat', 'opacity']) if (!Number.isFinite(material[key])) throw new Error('Invalid saved material.');
    if (!(material.density > 0) || !(material.heatCapacity > 0) || !/^#[a-f0-9]{6}$/i.test(material.color)) throw new Error('Invalid saved material.');
    if (!validEffects(material)) throw new Error('Invalid saved material effects.');
  }
  if (!state.inventory || Object.values(state.inventory).some(v => !nonnegative(v))) throw new Error('Invalid ingredient stock.');
  if (!state.equipment || !state.settings || !Array.isArray(state.discoveries) || !Array.isArray(state.soldOrderIds)) throw new Error('Incomplete shop records.');
  for (const [key, max] of [['cauldron', 2], ['reagents', 3], ['furnace', 1]]) if (!Number.isInteger(state.equipment[key]) || state.equipment[key] < 0 || state.equipment[key] > max) throw new Error('Invalid equipment.');
  if (!state.order?.requirements?.length || !(state.order.volume > 0) || !(state.order.budget > 0)) throw new Error('Missing customer order.');
  for (const r of state.order.requirements) {
    if (!Object.hasOwn(PROPERTIES, r.property) || !(r.tolerance > 0) || !(r.weight > 0) || (r.property === 'color' ? !/^#[a-f0-9]{6}$/i.test(r.target) : !Number.isFinite(r.target))) throw new Error('Invalid order target.');
    if (r.comparison !== undefined && !['target', 'maximum'].includes(r.comparison) || r.minimum !== undefined && (!nonnegative(r.minimum) || r.minimum > Number(r.target))) throw new Error('Invalid effect requirement.');
  }
  if (state.pendingBottle && !validSample(state.pendingBottle)) throw new Error('Invalid saved vial.');
  if (state.pendingBottle) validatePotionContents(state.pendingBottle);
  for (const discovery of state.discoveries) if (!validSample(discovery.sample) || typeof discovery.tested !== 'boolean' || !Array.isArray(discovery.observations) || discovery.observations.some(line => typeof line !== 'string')) throw new Error('Invalid saved discovery.');
  if (!['brewing', 'inspection', 'sale'].includes(state.stage)) throw new Error('Invalid shop state.');
  if (!['shop', 'sandbox'].includes(state.mode)) throw new Error('Invalid game mode.');
  if (state.mode === 'sandbox' && (state.coins !== 0 || state.reputation !== 0 || state.completed !== 0 || state.debt !== 0 || state.soldOrderIds.length)) throw new Error('Sandbox experiments cannot contain shop progression.');
  if (state.foraging?.seed !== state.seed || !Array.isArray(state.foraging.nodes) || !nonnegative(state.foraging.collectedTotal)) throw new Error('Invalid saved gathering area.');
  const nodeIds = new Set();
  for (const node of state.foraging.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id || nodeIds.has(node.id) || !ids.has(node.ingredientId) ||
      !nonnegative(node.capacity) || !nonnegative(node.stock) || node.stock > node.capacity || !Number.isFinite(node.regrowMs) || (node.unlimited ? node.regrowMs < 0 : node.regrowMs <= 0) ||
      !nonnegative(node.updatedAt) || !Number.isFinite(node.x) || node.x < 0 || node.x > 1 || !Number.isFinite(node.y) || node.y < 0 || node.y > 1 || typeof node.unlimited !== 'boolean') throw new Error('Invalid saved resource patch.');
    nodeIds.add(node.id);
  }
  const experiments = state.experiments;
  const validStats = stats => stats && typeof stats.alive === 'boolean' && ['health', 'vitality', 'growth', 'strength', 'love', 'transformation', 'burning', 'freezing'].every(key => nonnegative(stats[key]) && stats[key] <= 100);
  const safeIdentity = id => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(id);
  const validExposure = source => source && EFFECT_PROPERTIES.every(key => nonnegative(source[key]) && source[key] <= 1e9);
  const rabbitIds = new Set();
  if (!Array.isArray(experiments?.rabbits) || !experiments.rabbits.length || experiments.rabbits.length > 36 || experiments.capacity !== 12 ||
    !Array.isArray(experiments.records) || experiments.records.length > EXPERIMENT_RECORD_LIMIT || !Number.isInteger(experiments.serial) || experiments.serial < 0 ||
    !Number.isSafeInteger(experiments.rabbitSerial) || experiments.rabbitSerial < 4 || !nonnegative(experiments.lastAdvancedAt) ||
    !Number.isSafeInteger(experiments.eventSerial) || experiments.eventSerial < 0 || !Array.isArray(experiments.events) || experiments.events.length > RABBIT_EVENT_LIMIT) throw new Error('Invalid saved experiments.');
  const validRabbit = rabbit => rabbit && /^rabbit-[1-9]\d{0,14}$/.test(rabbit.id) && Number(rabbit.id.slice(7)) <= experiments.rabbitSerial &&
    typeof rabbit.name === 'string' && rabbit.name.length > 0 && rabbit.name.length <= 80 && rabbit.kind === 'animal' && rabbit.species === 'rabbit' &&
    validStats(rabbit.stats) && validExposure(rabbit.exposure) && ['baby', 'adult'].includes(rabbit.age) && ['male', 'female'].includes(rabbit.sex) &&
    ['pen', 'cage'].includes(rabbit.location) && Number.isSafeInteger(rabbit.trials) && rabbit.trials >= 0 &&
    ['bornAt', 'adultAt', 'lastTestAt', 'readyAt', 'activeFireUntil', 'attackReadyAt', 'nextAttackAt', 'nextBreedAt', 'deathAt', 'courtshipUntil'].every(key => nonnegative(rabbit[key])) &&
    rabbit.adultAt >= rabbit.bornAt && typeof rabbit.dangerous === 'boolean' && typeof rabbit.transformed === 'boolean' && nonnegative(rabbit.infantDoseMl) &&
    (rabbit.courtingWith === null || safeIdentity(rabbit.courtingWith)) &&
    (rabbit.causeOfDeath === null || typeof rabbit.causeOfDeath === 'string' && rabbit.causeOfDeath.length <= 100) &&
    (rabbit.deathAppearance === null || ['collapsed', 'dissolved', 'charred', 'deformed', 'culled'].includes(rabbit.deathAppearance)) &&
    (rabbit.remainsRecovered === undefined || typeof rabbit.remainsRecovered === 'boolean' && (!rabbit.remainsRecovered || !rabbit.stats.alive)) &&
    (rabbit.recoveredAt === undefined || nonnegative(rabbit.recoveredAt)) &&
    rabbit.mutation && Number.isSafeInteger(rabbit.mutation.seed) && rabbit.mutation.seed >= 0 && rabbit.mutation.seed <= 4294967295 &&
    ['creature', 'deformation'].includes(rabbit.mutation.outcome) &&
    rabbit.mutation.traits && ['ears', 'horns', 'limbs', 'eyes', 'spine', 'tail', 'asymmetry'].every(key => nonnegative(rabbit.mutation.traits[key]) && rabbit.mutation.traits[key] <= 1) &&
    /^#[a-f0-9]{6}$/i.test(rabbit.mutation.hue) &&
    ['muscleMass', 'corrosion', 'scorch', 'aggression', 'mutationStage'].every(key => nonnegative(rabbit.stats[key]) && rabbit.stats[key] <= 100) &&
    nonnegative(rabbit.stats.totalDoseMl) && rabbit.stats.totalDoseMl <= 1e9 &&
    Number.isSafeInteger(rabbit.stats.doseCount) && rabbit.stats.doseCount >= 0;
  for (const rabbit of experiments.rabbits) {
    if (!validRabbit(rabbit) || rabbitIds.has(rabbit.id)) throw new Error('Invalid saved rabbit.');
    rabbitIds.add(rabbit.id);
  }
  if (experiments.rabbits.filter(rabbit => rabbit.stats.alive).length > experiments.capacity ||
    experiments.rabbits.filter(rabbit => rabbit.stats.alive && rabbit.location === 'cage').length > 1) throw new Error('Invalid rabbit enclosure.');
  const validEvent = event => event && /^rabbit-event-[1-9]\d{0,14}$/.test(event.id) && Number(event.id.slice(13)) <= experiments.eventSerial &&
    nonnegative(event.at) && typeof event.type === 'string' && event.type.length > 0 && event.type.length <= 40 &&
    safeIdentity(event.rabbitId) && typeof event.message === 'string' && event.message.length <= 8000 &&
    (event.relatedRabbitId == null || safeIdentity(event.relatedRabbitId));
  const eventIds = new Set();
  for (const event of experiments.events) {
    if (!validEvent(event) || eventIds.has(event.id)) throw new Error('Invalid saved rabbit event.');
    eventIds.add(event.id);
  }
  const recordIds = new Set();
  for (const record of experiments.records) {
    if (!record || !safeIdentity(record.subjectId) || typeof record.id !== 'string' || recordIds.has(record.id) ||
      !Number.isInteger(record.serial) || record.serial < 1 || record.serial > experiments.serial || !nonnegative(record.at) ||
      !Number.isFinite(record.volume) || record.volume <= 0 || !validSample(record.sample) || Math.abs(record.sample.volume - record.volume) > .00001 ||
      !validEffects(record.effects) || typeof record.safe !== 'boolean' || !Number.isFinite(record.doseMl) || record.doseMl <= 0 || record.doseMl > 50 ||
      Math.abs(record.doseMl - record.volume) > .00001 ||
      !validStats(record.before) || !validStats(record.after) || !Array.isArray(record.observations) || record.observations.some(text => typeof text !== 'string')) throw new Error('Invalid saved experiment record.');
    recordIds.add(record.id);
    if (record.doseExposure !== undefined && !validExposure(record.doseExposure) ||
      record.beforeRabbit !== undefined && (!validRabbit(record.beforeRabbit) || record.beforeRabbit.id !== record.subjectId) ||
      record.afterRabbit !== undefined && (!validRabbit(record.afterRabbit) || record.afterRabbit.id !== record.subjectId) ||
      record.events !== undefined && (!Array.isArray(record.events) || record.events.length > RABBIT_EVENT_LIMIT || record.events.some(event => !validEvent(event)))) throw new Error('Invalid saved rabbit trial snapshot.');
    if (record.beforeRabbit && Object.keys(record.before).some(key => record.beforeRabbit.stats[key] !== record.before[key]) ||
      record.afterRabbit && (Object.keys(record.after).some(key => record.afterRabbit.stats[key] !== record.after[key]) || record.afterRabbit.lastTestAt !== record.at) ||
      record.beforeRabbit && record.afterRabbit && record.afterRabbit.trials !== record.beforeRabbit.trials + 1) throw new Error('Inconsistent saved rabbit trial snapshot.');
    if (record.preparation?.mass && (!validSample(record.preparation) || !Array.isArray(record.preparation.portions) || record.preparation.portions.some(portion => !ids.has(portion.ingredientId) || !nonnegative(portion.ml)))) throw new Error('Invalid tested formula.');
  }
  if (!Array.isArray(state.potionIds) || state.potionIds.length > 80 || !Array.isArray(state.certificates) || state.certificates.length > 80 || !Array.isArray(state.deliveries) || state.deliveries.length > 100 || !Array.isArray(state.complaints) || state.complaints.length > 100 || !state.purchases) throw new Error('Missing magical shop records.');
  const validFingerprint = text => typeof text === 'string' && text.length > 0 && text.length < 4000;
  for (const document of state.potionIds) if (!document || !validFingerprint(document.fingerprint) || !validSample(document.sample) || !validEffects(document.estimates) || typeof document.name !== 'string' || typeof document.id !== 'string' || !nonnegative(document.at) || !Array.isArray(document.trials)) throw new Error('Invalid potion ID.');
  for (const seal of state.certificates) if (!validFingerprint(seal.fingerprint) || !nonnegative(seal.cost) || !nonnegative(seal.at)) throw new Error('Invalid expert seal.');
  for (const receipt of [...state.deliveries,...state.complaints]) if (!validFingerprint(receipt.fingerprint) || !nonnegative(receipt.payment) || !nonnegative(receipt.dueAt) || !Number.isInteger(receipt.dueCompleted) || receipt.dueCompleted < 0 || !['delivered','reviewed','pending','dismissed','refunded'].includes(receipt.status) || typeof receipt.certified !== 'boolean' || typeof receipt.met !== 'boolean' || typeof receipt.bluff !== 'boolean' || typeof receipt.genuine !== 'boolean') throw new Error('Invalid customer receipt.');
  const negotiation = state.negotiation;
  if (negotiation && (!state.pendingBottle || !validFingerprint(negotiation.fingerprint) || !Number.isInteger(negotiation.offer) || negotiation.offer < 1 || !Number.isInteger(negotiation.ceiling) || negotiation.ceiling < negotiation.offer || !Number.isInteger(negotiation.round) || negotiation.round < 0 || negotiation.round > 4 || typeof negotiation.agreed !== 'boolean' || negotiation.orderId !== state.order.id || !Array.isArray(negotiation.history))) throw new Error('Invalid negotiation.');
  if (Object.values(state.purchases).some(value => !nonnegative(value)) || !nonnegative(state.debt) || !nonnegative(state.foraging.stamina ?? 100) || (state.foraging.stamina ?? 100) > 100) throw new Error('Invalid garden or shop balances.');
  return state;
}

export function encodeSave(state, brew) {
  const data = { ...state, version: SAVE_VERSION, brew: brew.snapshot() };
  validateSave(data); return JSON.stringify(data);
}

export function decodeSave(text) { return validateSave(migrateSave(JSON.parse(text))); }

export function saveShop(storage, state, brew, key = state.mode === 'sandbox' ? SANDBOX_SAVE_KEY : SAVE_KEY) {
  const text = encodeSave(state, brew), previous = storage.getItem(key);
  if (previous) { try { decodeSave(previous); storage.setItem(key + '-backup', previous); } catch { /* Keep the last good backup. */ } }
  storage.setItem(key, text);
  // Return the exact independent snapshot written to storage. The menu must
  // resume this physical state rather than an older state.brew reference.
  return JSON.parse(text);
}

export function loadShop(storage, saveKey = SAVE_KEY) {
  let error = '';
  for (const key of [saveKey, saveKey + '-backup']) {
    const text = storage.getItem(key); if (!text) continue;
    try { return { state: decodeSave(text), error: key === saveKey + '-backup' ? 'Recovered your last good save.' : '' }; }
    catch (err) {
      error = err.message;
      // Do not load an older backup over a future-version primary save.
      try { if (JSON.parse(text).version > SAVE_VERSION) return { state: null, error }; } catch { /* Corrupt JSON may have a backup. */ }
    }
  }
  return { state: null, error };
}
