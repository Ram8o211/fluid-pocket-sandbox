import { EFFECT_PROPERTIES } from '../materials/MaterialDefinition.mjs';
import { ROOM_TEMPERATURE } from '../game/contracts.mjs';

// Arcane runes are signed degrees relative to the room-temperature reference.
// Unlike the normalized physical temperature (0.01–1.2), runes span -12..+12.
// Forty rune units per physical degree keeps both +1100°A and -1100°A
// reachable with the existing heater and frost tool, without changing
// the exact signed, portion-weighted mixing rule.
export const ARCANE_UNITS_PER_TEMPERATURE = 40;
export const ARCANE_MARGIN = .015;
export function arcaneTriggerTemperature(threshold) {
  return ROOM_TEMPERATURE + threshold / ARCANE_UNITS_PER_TEMPERATURE;
}
export function arcaneThresholdCrossed(temperature, threshold) {
  const trigger = arcaneTriggerTemperature(threshold);
  return threshold >= 0 ? temperature > trigger + ARCANE_MARGIN : temperature < trigger - ARCANE_MARGIN;
}


/** Warm contacts can blend without needing a phase transition. */
export function warmedMiscibility(ps, i, j, base, rules) {
  return base + Math.max(0, (ps.temperature[i] + ps.temperature[j]) * .5 - .33) * (rules?.heatSolubility || 0);
}

/** The signed critical temperature is the ordinary portion-weighted mean.
 * Dividing by the total amount keeps it inside the ingredient threshold range
 * and makes diluting/scaling recipes mathematically consistent.
 */
export function arcaneRecipe(ingredients) {
  const sources = ingredients.filter(source => Number.isFinite(source.amount) && source.amount > 0 &&
    Number.isFinite(source.threshold));
  if (!sources.length) return null;
  const total = sources.reduce((sum, source) => sum + source.amount, 0);
  // Preserve sign; never take abs(), clamp to positive, or divide by source count.
  const threshold = sources.reduce((sum, source) =>
    sum + source.threshold * source.amount, 0) / total;
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
    const authoritative = recipe?.sourceCount === 1 || blended;
    const temperature = ps.temperature[i];
    const threshold = authoritative ? recipe.threshold : ps.arcaneThreshold[i];
    if (authoritative) ps.arcaneThreshold[i] = threshold;
    // A newly formed compatible group must finish blending before it can
    // awaken; otherwise an old single-ingredient rune can fire first.
    const awaitingBlend = recipe?.sourceCount > 1 && !blended;
    if (awaitingBlend) ps.arcaneCharge[i] = 0;
    if (!awaitingBlend && ps.arcaneConverted[i] < .5) {
      const crossed = arcaneThresholdCrossed(temperature, threshold);
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
