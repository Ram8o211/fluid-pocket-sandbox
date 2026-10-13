import { clamp, hexToRgb } from '../simulation/math.mjs';
import { PACKAGING_COST } from './contracts.mjs';

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
  if (!sample || sample.volume < 1 || sample.mass <= 0 || !order.requirements.length)
    return { quality: 0, quantityRatio: 0, acceptable: false, breakdown: [], hardFailures: [] };
  const breakdown = order.requirements.map(r => {
    const actual = sample[r.property], error = r.comparison === 'maximum' ? Math.max(0, actual - r.target) : propertyError(r.property, actual, r.target);
    return { ...r, actual, error, similarity: toleranceSimilarity(error, r.tolerance), met: error <= r.tolerance };
  });
  const weight = breakdown.reduce((s, r) => s + r.weight, 0);
  const match = breakdown.reduce((s, r) => s + r.weight * r.similarity, 0) / Math.max(.001, weight);
  const hardFailures = breakdown.filter(r => r.hard && !r.met || r.minimum !== undefined && (!Number.isFinite(r.actual) || r.actual < r.minimum)).map(r => r.property);
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
