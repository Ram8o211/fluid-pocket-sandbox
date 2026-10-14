import { EFFECT_PROPERTIES } from './effects.mjs';
import { observedPotion } from './knowledge.mjs';
import { potionRecord } from './potionTransfer.mjs';

/** Concentrations and source proportions identify an exact batch; draining a
 * dose changes quantity, not identity. A new brew always gets a new batchId. */
export function potionFingerprint(sample) {
  if (!sample?.batchId) return '';
  const portions = new Map();
  for (const p of sample.portions || []) {
    const key = `${p.ingredientId}:${Boolean(p.crushed)}`;
    portions.set(key, (portions.get(key) || 0) + p.ml);
  }
  const total = [...portions.values()].reduce((a, b) => a + b, 0) || 1;
  return JSON.stringify([sample.batchId, EFFECT_PROPERTIES.map(k => Math.round((sample[k] || 0) * 10000)),
    [...portions].sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => [k, Math.round(v / total * 10000)])]);
}
export function findPotionId(state, sample) {
  const fingerprint = potionFingerprint(sample);
  return fingerprint && (state.potionIds || []).find(id => {
    if (id.fingerprint === fingerprint) return true;
    if (id.batchId !== sample.batchId || !id.sample) return false;
    // A manual 1% estimate must survive sub-visible extraction/roundoff while
    // the observed liquid settles. Seals still use the exact sealed fingerprint.
    if (EFFECT_PROPERTIES.some(key => Math.abs((id.sample[key] || 0) - (sample[key] || 0)) > .0015)) return false;
    const proportions = source => {
      const values = new Map();
      for (const p of source.portions || []) { const key = `${p.ingredientId}:${Boolean(p.crushed)}`; values.set(key,(values.get(key)||0)+p.ml); }
      const total = [...values.values()].reduce((sum,value)=>sum+value,0) || 1;
      return new Map([...values].map(([key,value])=>[key,value/total]));
    };
    const a=proportions(id.sample),b=proportions(sample);
    return [...new Set([...a.keys(),...b.keys()])].every(key=>Math.abs((a.get(key)||0)-(b.get(key)||0))<=.002);
  }) || null;
}
export function compilePotionId(state, sample, estimates, name = '') {
  if (!observedPotion(state, sample)) throw new Error('Observe a real dose from this batch first.');
  if (!EFFECT_PROPERTIES.every(key => Number.isFinite(estimates[key]) && estimates[key] >= 0 && estimates[key] <= 1)) throw new Error('Estimate every magical property between 0 and 100.');
  const fingerprint = potionFingerprint(sample);
  if (!fingerprint) throw new Error('The batch has no identity.');
  state.potionIds ||= [];
  const old = findPotionId(state, sample);
  const document = { id: old?.id || `potion-${state.potionIds.length + 1}-${sample.batchId.slice(0,8)}`,
    fingerprint, batchId: sample.batchId, name: String(name || 'Unnamed potion').trim().slice(0,40),
    estimates: { ...estimates }, trials: (state.experiments?.records || []).filter(r => r.sample.batchId === sample.batchId).map(r => r.id).slice(0,20),
    sample: potionRecord(sample), at: Date.now() };
  if (old) state.potionIds.splice(state.potionIds.indexOf(old), 1);
  state.negotiation = null;
  state.potionIds.unshift(document); state.potionIds.length = Math.min(80, state.potionIds.length);
  return document;
}
