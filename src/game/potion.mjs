import { sampleParticleSet } from '../materials/MaterialSampler.mjs';
import { effectiveLiquidViscosity } from '../simulation/FluidSolver.mjs';
import { Phase } from '../simulation/Phase.mjs';
import { clamp, hexToRgb } from '../simulation/math.mjs';
import { EFFECT_DEFINITIONS, readEffects } from './effects.mjs';

/** Sampling is mass weighted and reads the selected actual particles, including
 * partial particles at a bottling boundary. No gameplay property sliders exist. */
export function measurePotion(engine, selections, history, cost = { ingredients: 0, energy: 0 }) {
  const ps = engine.ps;
  const sampled = sampleParticleSet(ps, selections.map(s => ({ index: s.index, weight: s.mass / ps.mass[s.index] })), 1, 'Cauldron sample');
  if (!sampled) return null;
  let mass = 0, volume = 0, liquidMass = 0, viscosity = 0, density = 0, arcana = 0;
  const composition = {}, means = [0, 0, 0, 0, 0], phases = [0, 0, 0], phaseMass = [0, 0, 0];
  for (const s of selections) {
    const i = s.index, m = s.mass;
    mass += m; volume += m / Math.max(.04, ps.density[i]);
    phases[ps.phase[i]]++; phaseMass[ps.phase[i]] += m;
    liquidMass += ps.phase[i] === Phase.LIQUID ? m : 0;
    viscosity += effectiveLiquidViscosity(ps, i) * m; density += ps.density[i] * m;
    const magic = Math.max(ps.strength[i], ps.love[i], ps.death[i], ps.transformation[i], ps.fire[i], ps.freeze[i]);
    arcana += Math.max(magic, .5 * Math.abs(ps.reactionPotential[i]) + .35 * ps.electricalConductivity[i] + .15 * ps.crystallinity[i]) * m;
    const keys = [ps.r[i], ps.g[i], ps.b[i], ps.baseDensity[i] / 1.65, ps.viscosity[i]];
    keys.forEach((v, k) => { means[k] += v * m; });
    const id = ps.materialId[i]; composition[id] = (composition[id] || 0) + m;
  }
  means.forEach((_, k) => { means[k] /= mass; });
  let variance = 0, miscibilityVariance = 0;
  for (const s of selections) {
    const i = s.index, values = [ps.r[i], ps.g[i], ps.b[i], ps.baseDensity[i] / 1.65, ps.viscosity[i]];
    variance += values.reduce((v, value, k) => v + (value - means[k]) ** 2, 0) / values.length * s.mass / mass;
    miscibilityVariance += (ps.miscibility[i] - sampled.material.miscibility) ** 2 * s.mass / mass;
  }
  const homogeneity = clamp(1 - Math.sqrt(variance) * 3, 0, 1);
  const stability = 100 * homogeneity * clamp(1 - Math.sqrt(miscibilityVariance) * 1.5, .2, 1) * liquidMass / mass;
  const activation = clamp(history.activation || 0, 0, 1);
  const potency = 100 * clamp(arcana / mass * (.8 + .2 * activation) * (.55 + .45 * stability / 100), 0, 1);
  const effects = readEffects(sampled.material);
  return {
    volume, mass, material: { ...sampled.material }, color: sampled.material.color, density: mass / volume,
    viscosity: viscosity / mass, temperature: sampled.temperature,
    volatility: sampled.material.volatility, stability, potency, ...effects, effects, liquidFraction: liquidMass / mass,
    homogeneity, composition, history: { ...history }, cost: { ...cost },
    phases, phaseMass, sourceMaterialIds: sampled.sourceMaterialIds
  };
}

export function propertyDescription(property, value) {
  if (property === 'color') return colourName(value);
  if (!Number.isFinite(value)) return 'Unmeasured';
  if (EFFECT_DEFINITIONS[property]) return `${value < .005 ? 'Inert' : value < .2 ? 'Trace' : value < .5 ? 'Gentle' : value < .8 ? 'Strong' : 'Intense'} · ${Math.round(value * 100)}%`;
  if (property === 'temperature') return `${value < .26 ? 'Cold' : value < .44 ? 'Room warm' : value < .68 ? 'Warm' : 'Hot'} · ${Math.round(value * 100)}°A`;
  if (property === 'density') return `${value < .9 ? 'Light' : value < 1.25 ? 'Balanced' : 'Heavy'} · ${value.toFixed(2)}`;
  if (property === 'viscosity') return `${value < .25 ? 'Watery' : value < .55 ? 'Silky' : value < .8 ? 'Syrupy' : 'Thick'} · ${Math.round(value * 100)}`;
  if (property === 'volatility') return `${value < .25 ? 'Quiet' : value < .55 ? 'Lively' : 'Volatile'} · ${Math.round(value * 100)}`;
  if (property === 'stability') return `${value > 85 ? 'Homogeneous' : value > 60 ? 'Settling' : 'Separated'} · ${Math.round(value)}%`;
  return `${value > 60 ? 'Radiant' : value > 35 ? 'Enchanted' : 'Gentle'} · ${Math.round(value)}`;
}

export function colourName(hex) {
  const [r, g, b] = hexToRgb(hex), max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < .11) return max > .7 ? 'Pearl' : 'Smoky';
  if (r > g * 1.12 && b > g * 1.12) return r > b * 1.15 ? 'Rose' : 'Violet';
  if (g > r && b > r) return b > g * 1.1 ? 'Azure' : 'Teal';
  if (r > b * 1.25 && g > b * 1.25) return r > g * 1.2 ? 'Amber' : 'Gold';
  return max === r ? 'Ruby' : max === g ? 'Jade' : 'Azure';
}
