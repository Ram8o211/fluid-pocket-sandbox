import { EFFECT_PROPERTIES } from '../materials/MaterialDefinition.mjs';

/** The game opts in; sandbox solubility keeps its existing behavior. */
export function warmedMiscibility(ps, i, j, base, rules) {
  return base + Math.max(0, (ps.temperature[i] + ps.temperature[j]) * .5 - .33) * (rules?.heatSolubility || 0);
}

/** Local magic follows local temperature, independent of melting/boiling.
 * Thresholds diffuse conservatively with ingredient proportions. Awakening
 * needs sustained exposure and fires once; heat damage is irreversible. */
export function stepArcana(ps, dt, events = null) {
  for (let i = 0; i < ps.count; i++) {
    const temperature = ps.temperature[i], threshold = ps.arcaneThreshold[i];
    if (ps.arcaneConverted[i] < .5) {
      const crossed = threshold >= .33 ? temperature > threshold + .015 : temperature < threshold - .015;
      ps.arcaneCharge[i] = crossed ? Math.min(1, ps.arcaneCharge[i] + dt * 2.5) : Math.max(0, ps.arcaneCharge[i] - dt * 4);
      if (ps.arcaneCharge[i] >= .999) {
        let dominant = 0, maximum = 0;
        for (let k = 0; k < EFFECT_PROPERTIES.length; k++) {
          const value = ps[EFFECT_PROPERTIES[k]][i];
          if (value > maximum) { maximum = value; dominant = k; }
        }
        if (maximum > .003) {
          for (let k = 0; k < EFFECT_PROPERTIES.length; k++) ps[EFFECT_PROPERTIES[k]][i] = k === dominant ? .98 : .002;
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
