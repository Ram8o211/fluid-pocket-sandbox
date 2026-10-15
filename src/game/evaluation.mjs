import { clamp, hexToRgb } from '../simulation/math.mjs';
import { PACKAGING_COST } from './contracts.mjs';
import { EFFECT_PROPERTIES } from './effects.mjs';
import { propertyDescription } from './potion.mjs';

export const UNWANTED_EFFECT_MAX = .012;
// Only absorb arithmetic roundoff at an inclusive boundary, never a visible
// fraction of a percentage point (1.20001% is already outside the limit).
const BOUNDARY_EPSILON = 1e-12;

export function requirementBounds(requirement) {
  const target = Number(requirement.target);
  return {
    minimum: requirement.comparison === 'maximum' ? 0
      : Math.max(target - requirement.tolerance, requirement.minimum ?? -Infinity),
    maximum: target + requirement.tolerance
  };
}

/** Shared by the request card, details sheet and persisted target descriptions. */
export function requirementDescription(requirement) {
  if (!EFFECT_PROPERTIES.includes(requirement.property))
    return propertyDescription(requirement.property, requirement.target);
  const { minimum, maximum } = requirementBounds(requirement);
  const percent = value => (value * 100).toFixed(1);
  return requirement.comparison === 'maximum' ? `At most ${percent(maximum)}%`
    : `${percent(Math.max(0, minimum))}–${percent(Math.min(1, maximum))}% · aim ${percent(requirement.target)}%`;
}

export function propertyError(property, actual, target) {
  if (property === 'color') {
    const a = hexToRgb(actual), b = hexToRgb(target);
    return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / 3);
  }
  return Math.abs(actual - target);
}

export function toleranceSimilarity(error, tolerance) {
  if (!Number.isFinite(error) || !(tolerance > 0)) return 0;
  const scaled = error / tolerance;
  return scaled <= 1 ? 1 - .1 * scaled ** 2 : .9 * Math.exp(-.5 * (scaled - 1) ** 2);
}

/** Pure, continuous, priority- and tolerance-aware, including exact vial volume. */
export function assessPotion(sample, order) {
  // Partial vials use floating-point mass fractions: a nominal 1 ml dose can
  // evaluate infinitesimally below 1 ml despite being a complete dose.
  if (!sample || sample.volume < 1 - 1e-6 || sample.mass <= 0 || !order.requirements.length)
    return { quality: 0, quantityRatio: 0, acceptable: false, breakdown: [], hardFailures: [] };
  const breakdown = order.requirements.map(r => {
    const actual = sample[r.property], error = r.comparison === 'maximum' ? Math.max(0, actual - r.target) : propertyError(r.property, actual, r.target);
    const bounds = requirementBounds(r);
    const met = r.property === 'color' ? error <= r.tolerance + BOUNDARY_EPSILON
      : Number.isFinite(actual) && actual >= bounds.minimum - BOUNDARY_EPSILON && actual <= bounds.maximum + BOUNDARY_EPSILON;
    return { ...r, actual, error, similarity: toleranceSimilarity(error, r.tolerance), met };
  });
  const weight = breakdown.reduce((s, r) => s + r.weight, 0);
  const match = breakdown.reduce((s, r) => s + r.weight * r.similarity, 0) / Math.max(.001, weight);
  const hardFailures = breakdown.filter(r => r.hard && !r.met || r.minimum !== undefined && (!Number.isFinite(r.actual) || r.actual < r.minimum - BOUNDARY_EPSILON)).map(r => r.property);
  const quantityRatio = clamp(sample.volume / order.volume, 0, 1);
  const quality = Math.round(1000 * match * quantityRatio * clamp(sample.liquidFraction, 0, 1) * (hardFailures.length ? .35 : 1)) / 10;
  return { quality, quantityRatio, acceptable: quality >= 25 && quantityRatio >= .5 && !hardFailures.length, breakdown, hardFailures };
}

export function priceSale(sample, order, reputation = 0) {
  const assessment = assessPotion(sample, order), q = assessment.quality / 100;
  const payment = assessment.acceptable ? Math.floor(Math.min(order.budget, order.budget * (.12 + .88 * q ** 1.8) * assessment.quantityRatio * (1 + clamp(reputation / 100, 0, 1) * .05))) : 0;
  const energy = Math.round((sample?.cost?.energy || 0) * 100) / 100;
  const expenses = PACKAGING_COST + energy;
  const profit = Math.round((payment - expenses - (sample?.cost?.ingredients || 0)) * 100) / 100;
  const reputationDelta = assessment.quality >= 90 ? 4 : assessment.quality >= 65 ? 2 : assessment.acceptable ? 0 : -3;
  return { orderId: order.id, ...assessment, payment, profit, expenses, reputationDelta,
    reaction: assessment.quality >= 90 ? 'A masterpiece! I shall tell the whole village.' : assessment.quality >= 65 ? 'Just what I needed. Your shop has a bright future.' : assessment.acceptable ? 'It will do, though a little more care would help.' : 'This is not quite safe for my needs. Try another commission.' };
}
