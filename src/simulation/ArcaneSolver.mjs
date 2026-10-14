import { EFFECT_PROPERTIES } from '../materials/MaterialDefinition.mjs';

/** Warm contacts can blend without needing a phase transition. */
export function warmedMiscibility(ps, i, j, base, rules) {
  return base + Math.max(0, (ps.temperature[i] + ps.temperature[j]) * .5 - .33) * (rules?.heatSolubility || 0);
}

/** Original ingredient contribution rule. Portion ratios are reduced so
 * scaling a recipe (10:20 => 1:2) never alters its critical temperature.
 *
 * Intentionally follows the game's specified example, not the conventional
 * weighted mean: (-1000*1 + 800*2) / 2 = +300.
 * The divisor is the number of distinct components (not their total weight).
 */
export function arcaneRecipe(ingredients) {
  const sources = ingredients.filter(source => Number.isFinite(source.amount) && source.amount > 0 &&
    Number.isFinite(source.threshold));
  if (!sources.length) return null;
  const smallest = Math.min(...sources.map(source => source.amount));
  const total = sources.reduce((sum, source) => sum + source.amount, 0);
  const signedAverage = sources.reduce((sum, source) =>
    sum + source.threshold * (source.amount / smallest), 0) / sources.length;
  // Individual ingredients retain their signed cold/hot runes. A composed
  // potion always has a strictly positive *temperature magnitude*, including
  // cancellation (-1:+1 -> 0), without changing its ingredient proportions.
  const threshold = sources.length > 1
    ? Math.max(.001, Math.abs(signedAverage))
    : signedAverage;
  const effects = Object.fromEntries(EFFECT_PROPERTIES.map(key => [key, 0]));
  const single = sources.length === 1;
  for (const source of sources) {
    const effect = EFFECT_PROPERTIES.reduce((best, key) => {
      const value = source.effects?.[key] || 0;
      return value > (best ? source.effects[best] : .003) ? key : best;
    }, null);
    if (effect) effects[effect] += (single ? .98 : .99) * source.amount / total;
  }
  return { threshold, effects, sourceCount: sources.length };
}

/** Awaken based on each parcel's temperature even as gas or unmelted powder.
 * The mixture's recipe is fixed by the ORIGINAL ingredient contributions,
 * not by which of its intermediate live effects happens to be strongest.
 */
export function stepArcana(ps, dt, events = null, mixtures = null) {
  for (let i = 0; i < ps.count; i++) {
    const root = mixtures?.root?.(ps.mixtureGroup[i]);
    const recipe = root?.arcaneRecipe;
    const blended = recipe?.sourceCount > 1 && ps.mixtureProgress[i] >= .35;
    const temperature = ps.temperature[i];
    const threshold = blended ? recipe.threshold : ps.arcaneThreshold[i];
    if (blended) ps.arcaneThreshold[i] = threshold;
    // A newly formed compatible group must finish blending before it can
    // awaken; otherwise an old single-ingredient rune can fire first.
    const awaitingBlend = recipe?.sourceCount > 1 && !blended;
    if (awaitingBlend) ps.arcaneCharge[i] = 0;
    if (!awaitingBlend && ps.arcaneConverted[i] < .5) {
      const crossed = threshold >= .33 ? temperature > threshold + .015 : temperature < threshold - .015;
      ps.arcaneCharge[i] = crossed ? Math.min(1, ps.arcaneCharge[i] + dt * 2.5) : Math.max(0, ps.arcaneCharge[i] - dt * 4);
      if (ps.arcaneCharge[i] >= .999) {
        let dominant = null, maximum = .003;
        for (const key of EFFECT_PROPERTIES) {
          if (ps[key][i] > maximum) { maximum = ps[key][i]; dominant = key; }
        }
        const result = blended ? recipe.effects : (dominant ? { [dominant]: .98 } : null);
        if (result) {
          for (const key of EFFECT_PROPERTIES) ps[key][i] = result[key] ?? 0;
          ps.arcaneConverted[i] = 1;
          events?.pushEvent(ps.x[i], ps.y[i], ps.z[i], 1, 0);
        }
      }
    }
    const excess = temperature - ps.magicDecayTemperature[i];
    if (excess > 0) {
      const survival = Math.exp(-excess * dt * .7);
      for (const key of EFFECT_PROPERTIES) ps[key][i] *= survival;
    }
  }
}
