import { sanitizeMaterial } from './MaterialDefinition.mjs';
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(rng, lo, hi) { return lo + (hi - lo) * rng(); }
function colorFrom(rng) {
  const hue = rng(); const s = 0.55 + rng()*0.35; const l = 0.38 + rng()*0.28;
  const a = s*Math.min(l,1-l); const f = (n) => { const k=(n+hue*12)%12; return l-a*Math.max(-1,Math.min(k-3,9-k,1)); };
  const to = x => Math.round(x*255).toString(16).padStart(2,'0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}
export function generateMaterial(seed = 1, id = 1) {
  const rng = mulberry32(seed);
  const melting = pick(rng, 0.08, 0.58);
  const boiling = pick(rng, Math.max(0.5, melting+0.16), 0.98);
  return sanitizeMaterial({
    id, seed, name: `Matter-${(seed>>>0).toString(36).slice(-4).toUpperCase()}`,
    color: colorFrom(rng), opacity: pick(rng,0.35,0.92), density: pick(rng,0.65,1.55),
    viscosity: pick(rng,0.04,0.9), cohesion: pick(rng,0.15,0.9), miscibility: rng(),
    heatCapacity: pick(rng,0.25,0.95), thermalConductivity: pick(rng,0.08,0.85),
    meltingTemperature: melting, boilingTemperature: boiling,
    phaseTransitionHysteresis: pick(rng,0.015,0.045), volatility: pick(rng,0.05,0.9),
    reactionPotential: pick(rng,-1,1), reactionHeat: pick(rng,-1,1), compressibility: pick(rng,0.25,0.9),
    crystallinity: rng(), solidSubdivision: rng(), electricalConductivity: Math.pow(rng(),1.4), electricPotential: pick(rng,-1,1),
    // Combustion is independent of phase boundaries: this may fall below melting, between melting/boiling, or above boiling.
    combustionTemperature: pick(rng,.12,1.18)
  });
}
export { mulberry32 };
