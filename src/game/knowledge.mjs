import { EFFECT_PROPERTIES, readEffects } from './effects.mjs';

/** Knowledge belongs to an observed batch. A smaller dose or sealed remainder
 * has the same concentrations; new ingredients, extraction, or heat can change
 * them. Never infer a discovery from an inspection, a sale, or a recipe name. */
export function observedPotion(state, sample) {
  if (!sample) return null;
  const effects = readEffects(sample);
  return (state.experiments?.records || []).find(report => {
    const tested = report.sample;
    if (!tested || (sample.batchId || tested.batchId) && sample.batchId !== tested.batchId) return false;
    const known = readEffects(tested);
    if (EFFECT_PROPERTIES.some(key => Math.abs(effects[key] - known[key]) > .0015)) return false;
    if (Math.abs(sample.temperature - tested.temperature) > .02 || Math.abs(sample.stability - tested.stability) > 2) return false;
    const amounts = source => {
      if (!source.portions?.length) return source.composition || {};
      const result = {};
      for (const portion of source.portions) {
        const key = `${portion.ingredientId}:${Boolean(portion.crushed)}`;
        result[key] = (result[key] || 0) + portion.ml;
      }
      return result;
    };
    // Source portions survive material canonicalization. Generated particle IDs
    // may change while a tested liquid continues settling without changing its
    // ingredient proportions or effect concentrations.
    const a = amounts(sample), b = amounts(tested);
    const total = values => Object.values(values).reduce((sum, amount) => sum + Number(amount), 0);
    const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...ids].every(id => Math.abs((a[id] || 0) / Math.max(total(a), .00001) - (b[id] || 0) / Math.max(total(b), .00001)) <= .002);
  }) || null;
}

export function discoveryKnowledge(discovery) {
  return discovery?.tested === true ? { sample: discovery.sample, observations: discovery.observations || [] } : null;
}
