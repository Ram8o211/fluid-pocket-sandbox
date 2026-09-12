import { clamp, hexToRgb, rgbToHex } from '../simulation/math.mjs';

export const MATERIAL_RANGES = Object.freeze({
  density: [0.35, 1.65], viscosity: [0.02, 1], cohesion: [0, 1], miscibility: [0, 1],
  particleRadius: [0.065, 0.20],
  heatCapacity: [0.15, 1], thermalConductivity: [0.02, 1],
  meltingTemperature: [0.05, 0.75], boilingTemperature: [0.35, 1.05],
  phaseTransitionHysteresis: [0.005, 0.08], volatility: [0, 1], reactionPotential: [-1, 1],
  reactionHeat: [-1, 1], compressibility: [0.1, 1], opacity: [0.08, 1],
  crystallinity: [0, 1], solidSubdivision: [0, 1], electricalConductivity: [0, 1], electricPotential: [-1, 1],
  combustionTemperature: [0, 1.4]
});

export function sanitizeMaterial(input) {
  const m = {...input};
  if (!Number.isFinite(m.combustionTemperature)) m.combustionTemperature = 1.15;
  // Preserve the pre-feature packing of legacy saves instead of defaulting to the range midpoint.
  if (!Number.isFinite(m.particleRadius)) m.particleRadius = 0.13;
  for (const [key, range] of Object.entries(MATERIAL_RANGES)) {
    m[key] = clamp(Number.isFinite(m[key]) ? m[key] : (range[0] + range[1]) * 0.5, range[0], range[1]);
  }
  m.boilingTemperature = Math.max(m.meltingTemperature + 0.12, m.boilingTemperature);
  m.name = String(m.name || `Material ${m.id ?? 0}`).slice(0, 40);
  m.seed = Number.isFinite(m.seed) ? Math.floor(m.seed) : 1;
  m.color = /^#[0-9a-f]{6}$/i.test(m.color || '') ? m.color : '#55aaff';
  m.id = Number.isFinite(m.id) ? Math.max(1, Math.floor(m.id)) : 1;
  // Temperature is state, not an intrinsic material property. Drop legacy saved values.
  delete m.temperature;
  return m;
}

export function materialVector(m) {
  const [r,g,b] = hexToRgb(m.color);
  return [
    (m.density-0.35)/1.3, m.viscosity, m.cohesion, m.miscibility,
    (m.particleRadius-0.065)/0.135,
    m.heatCapacity, m.thermalConductivity, m.meltingTemperature, m.boilingTemperature,
    m.volatility, (m.reactionPotential+1)/2, (m.reactionHeat+1)/2,
    m.crystallinity, m.solidSubdivision, m.electricalConductivity, (m.electricPotential+1)/2, m.combustionTemperature/1.4,
    m.opacity, r,g,b
  ];
}

export function weightedMaterialMean(a, b, massA, massB, id) {
  const total = Math.max(1e-6, massA + massB);
  const wA = massA / total, wB = massB / total;
  const mean = (key) => a[key] * wA + b[key] * wB;
  const ar = hexToRgb(a.color), br = hexToRgb(b.color);
  return sanitizeMaterial({
    ...a, id, name: `${a.name} × ${b.name}`, seed: (a.seed ^ b.seed) >>> 0,
    color: rgbToHex(ar[0]*wA+br[0]*wB, ar[1]*wA+br[1]*wB, ar[2]*wA+br[2]*wB),
    opacity: mean('opacity'), density: mean('density'), viscosity: mean('viscosity'),
    cohesion: mean('cohesion'), miscibility: mean('miscibility'), particleRadius: mean('particleRadius'),
    heatCapacity: mean('heatCapacity'), thermalConductivity: mean('thermalConductivity'),
    meltingTemperature: mean('meltingTemperature'), boilingTemperature: mean('boilingTemperature'),
    phaseTransitionHysteresis: mean('phaseTransitionHysteresis'), volatility: mean('volatility'),
    reactionPotential: mean('reactionPotential'), reactionHeat: mean('reactionHeat'),
    compressibility: mean('compressibility'), crystallinity: mean('crystallinity'),
    solidSubdivision: mean('solidSubdivision'), electricalConductivity: mean('electricalConductivity'),
    electricPotential: mean('electricPotential'), combustionTemperature: mean('combustionTemperature')
  });
}
