import { SAVE_VERSION } from './contracts.mjs';
import { generateWorld } from './world.mjs';
import { newShop } from './economy.mjs';
import { PROPERTIES } from './contracts.mjs';

export const SAVE_KEY = 'alchemists-shop-save';
const BACKUP_KEY = SAVE_KEY + '-backup';

export function migrateSave(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Unreadable shop save.');
  if (raw.version > SAVE_VERSION) throw new Error('This save belongs to a newer game. It has been preserved.');
  if (raw.version === 1) {
    const defaults = newShop(raw.world || generateWorld(raw.seed));
    return { ...defaults, ...raw, version: SAVE_VERSION, soldOrderIds: raw.soldOrderIds || [], debt: raw.debt || 0, settings: { ...defaults.settings, ...raw.settings } };
  }
  if (raw.version !== SAVE_VERSION) throw new Error('Unsupported shop save. It has been preserved.');
  return raw;
}

export function validateSave(state) {
  const nonnegative = n => Number.isFinite(n) && n >= 0;
  if (typeof state.seed !== 'string' || !state.seed || !nonnegative(state.coins) || !nonnegative(state.reputation) || state.reputation > 100 || !Number.isInteger(state.completed) || state.completed < 0) throw new Error('Invalid shop totals.');
  if (!state.world?.ingredients?.length || state.world.seed !== state.seed) throw new Error('Missing world ingredients.');
  const ids = new Set();
  for (const ingredient of state.world.ingredients) {
    const material = ingredient?.material;
    if (!Number.isInteger(ingredient?.id) || ids.has(ingredient.id) || material?.id !== ingredient.id || !nonnegative(ingredient.price) || typeof ingredient.name !== 'string') throw new Error('Invalid saved ingredient.');
    ids.add(ingredient.id);
    for (const key of ['density', 'viscosity', 'cohesion', 'miscibility', 'meltingTemperature', 'boilingTemperature', 'heatCapacity', 'thermalConductivity', 'volatility', 'reactionPotential', 'reactionHeat', 'opacity']) if (!Number.isFinite(material[key])) throw new Error('Invalid saved material.');
    if (!(material.density > 0) || !(material.heatCapacity > 0) || !/^#[a-f0-9]{6}$/i.test(material.color)) throw new Error('Invalid saved material.');
  }
  if (!state.inventory || Object.values(state.inventory).some(v => !nonnegative(v))) throw new Error('Invalid ingredient stock.');
  if (!state.equipment || !state.settings || !Array.isArray(state.discoveries) || !Array.isArray(state.soldOrderIds)) throw new Error('Incomplete shop records.');
  for (const [key, max] of [['cauldron', 2], ['reagents', 3], ['furnace', 1]]) if (!Number.isInteger(state.equipment[key]) || state.equipment[key] < 0 || state.equipment[key] > max) throw new Error('Invalid equipment.');
  if (!state.order?.requirements?.length || !(state.order.volume > 0) || !(state.order.budget > 0)) throw new Error('Missing customer order.');
  for (const r of state.order.requirements) {
    if (!Object.hasOwn(PROPERTIES, r.property) || !(r.tolerance > 0) || !(r.weight > 0) || (r.property === 'color' ? !/^#[a-f0-9]{6}$/i.test(r.target) : !Number.isFinite(r.target))) throw new Error('Invalid order target.');
  }
  if (state.pendingBottle && (!(state.pendingBottle.volume > 0) || !(state.pendingBottle.mass > 0) || !state.pendingBottle.cost || !Number.isFinite(state.pendingBottle.temperature))) throw new Error('Invalid saved vial.');
  if (!['brewing', 'inspection', 'sale'].includes(state.stage)) throw new Error('Invalid shop state.');
  return state;
}

export function encodeSave(state, brew) {
  const data = { ...state, version: SAVE_VERSION, brew: brew.snapshot() };
  validateSave(data); return JSON.stringify(data);
}

export function decodeSave(text) { return validateSave(migrateSave(JSON.parse(text))); }

export function saveShop(storage, state, brew) {
  const text = encodeSave(state, brew), previous = storage.getItem(SAVE_KEY);
  if (previous) { try { decodeSave(previous); storage.setItem(BACKUP_KEY, previous); } catch { /* Keep the last good backup. */ } }
  storage.setItem(SAVE_KEY, text);
  // Return the exact independent snapshot written to storage. The menu must
  // resume this physical state rather than an older state.brew reference.
  return JSON.parse(text);
}

export function loadShop(storage) {
  let error = '';
  for (const key of [SAVE_KEY, BACKUP_KEY]) {
    const text = storage.getItem(key); if (!text) continue;
    try { return { state: decodeSave(text), error: key === BACKUP_KEY ? 'Recovered your last good save.' : '' }; }
    catch (err) {
      error = err.message;
      // Do not load an older backup over a future-version primary save.
      try { if (JSON.parse(text).version > SAVE_VERSION) return { state: null, error }; } catch { /* Corrupt JSON may have a backup. */ }
    }
  }
  return { state: null, error };
}
