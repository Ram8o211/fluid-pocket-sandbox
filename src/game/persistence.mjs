import { SAVE_VERSION } from './contracts.mjs';
import { generateWorld, generateStarterPowders, migrateIngredients } from './world.mjs';
import { newShop } from './economy.mjs';
import { PROPERTIES } from './contracts.mjs';
import { EFFECT_PROPERTIES } from './effects.mjs';
import { createForaging } from './gathering.mjs';
import { createExperimentState, EXPERIMENT_SUBJECTS, EXPERIMENT_RECORD_LIMIT } from './experiments.mjs';

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
    raw = { ...raw, version: SAVE_VERSION, world, mode: raw.mode === 'sandbox' ? 'sandbox' : 'shop',
      foraging: raw.foraging || createForaging(world), experiments: raw.experiments || createExperimentState(),
      pendingBottle: migrateSample(raw.pendingBottle),
      discoveries: (raw.discoveries || []).map(discovery => ({ ...discovery, sample: migrateSample(discovery.sample) })),
      lastSale: raw.lastSale ? { ...raw.lastSale, sample: migrateSample(raw.lastSale.sample) } : null };
  }
  if (raw.version !== SAVE_VERSION) throw new Error('Unsupported shop save. It has been preserved.');
  return raw;
}

export function validateSave(state) {
  const nonnegative = n => Number.isFinite(n) && n >= 0;
  const validEffects = source => EFFECT_PROPERTIES.every(key => Number.isFinite(source?.[key]) && source[key] >= 0 && source[key] <= 1);
  const validSample = sample => sample && nonnegative(sample.volume) && sample.volume > 0 && nonnegative(sample.mass) && sample.mass > 0 &&
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
  }
  if (state.pendingBottle && !validSample(state.pendingBottle)) throw new Error('Invalid saved vial.');
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
  if (!experiments?.subjects || !Array.isArray(experiments.records) || experiments.records.length > EXPERIMENT_RECORD_LIMIT || !Number.isInteger(experiments.serial) || experiments.serial < 0) throw new Error('Invalid saved experiments.');
  for (const definition of EXPERIMENT_SUBJECTS) {
    const subject = experiments.subjects[definition.id];
    if (!subject || subject.id !== definition.id || subject.kind !== definition.kind || !validStats(subject.stats) || !Number.isInteger(subject.trials) || subject.trials < 0 || !nonnegative(subject.lastTestAt)) throw new Error('Invalid saved experiment subject.');
  }
  const recordIds = new Set();
  for (const record of experiments.records) {
    if (!record || !experiments.subjects[record.subjectId] || typeof record.id !== 'string' || recordIds.has(record.id) ||
      !Number.isInteger(record.serial) || record.serial < 1 || record.serial > experiments.serial || !nonnegative(record.at) ||
      !Number.isFinite(record.volume) || record.volume <= 0 || !validSample(record.sample) || Math.abs(record.sample.volume - record.volume) > .00001 ||
      !validEffects(record.effects) || typeof record.safe !== 'boolean' || !Number.isFinite(record.doseMl) || record.doseMl <= 0 || record.doseMl > 50 ||
      !validStats(record.before) || !validStats(record.after) || !Array.isArray(record.observations) || record.observations.some(text => typeof text !== 'string')) throw new Error('Invalid saved experiment record.');
    recordIds.add(record.id);
  }
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
