import { Phase } from '../simulation/Phase.mjs';
import { clamp } from '../simulation/math.mjs';

export const MIX_PROPERTIES = Object.freeze([
  'r', 'g', 'b', 'opacity', 'baseDensity', 'viscosity', 'cohesion', 'miscibility',
  'particleRadius', 'incompressible', 'heatCapacity', 'thermalConductivity',
  'meltingTemperature', 'boilingTemperature', 'phaseHysteresis', 'volatility',
  'reactionPotential', 'reactionHeat', 'compressibility', 'crystallinity',
  'solidSubdivision', 'electricalConductivity', 'combustionTemperature'
]);

/** Composition targets belong to a compatible mixture, never to a contacting
 * pair or a canonical material ID. Only the local contact front activates a
 * parcel's relaxation. Targets remain fixed while that front is propagating,
 * so a minority ingredient cannot bias the final mean by mixing earlier. */
export class MixtureSolver {
  constructor() { this.reset(); this.previous = this.signal = new Float32Array(0); }
  reset() { this.groups = new Map(); this.materialGroups = new Map(); this.nextId = 1; }
  root(id) {
    let group = this.groups.get(id);
    for (let n = 0; group && group.parent !== group.id && n < this.groups.size; n++) group = this.groups.get(group.parent);
    if (group && group.parent !== group.id) throw new Error('Invalid saved mixture membership.');
    return group;
  }
  beginFrame(ps) {
    if (this.previous.length < ps.capacity) { this.previous = new Float32Array(ps.capacity); this.signal = new Float32Array(ps.capacity); }
    this.previous.set(ps.mixtureProgress.subarray(0, ps.count)); this.signal.fill(0, 0, ps.count);
    for (const group of this.groups.values()) group.mass = 0;
    // Count remaining parcels before adding fresh stock; partial bottling and
    // combustion must affect the next mixture's proportions immediately.
    for (let i = 0; i < ps.count; i++) { const group = this.root(ps.mixtureGroup[i]); if (group) { ps.mixtureGroup[i] = group.id; group.mass += ps.mass[i]; } }
    for (let i = 0; i < ps.count; i++) {
      if (this.root(ps.mixtureGroup[i])) continue;
      let group = this.root(this.materialGroups.get(ps.materialId[i]));
      if (!group || group.mass === 0) {
        const id = this.nextId++;
        group = { id, parent: id, mass: 0, min: ps.miscibility[i], max: ps.miscibility[i], target: MIX_PROPERTIES.map(() => 0) };
        this.groups.set(id, group); this.materialGroups.set(ps.materialId[i], id);
      }
      const mass = group.mass + ps.mass[i];
      for (let k = 0; k < MIX_PROPERTIES.length; k++) group.target[k] = (group.target[k] * group.mass + ps[MIX_PROPERTIES[k]][i] * ps.mass[i]) / mass;
      group.mass = mass; group.min = Math.min(group.min, ps.miscibility[i]); group.max = Math.max(group.max, ps.miscibility[i]);
      ps.mixtureGroup[i] = group.id; ps.mixtureProgress[i] = this.previous[i] = 0;
    }
  }
  contact(ps, i, j, contact, threshold) {
    if (ps.phase[i] === Phase.SOLID || ps.phase[j] === Phase.SOLID) return 0;
    const a = this.root(ps.mixtureGroup[i]), b = this.root(ps.mixtureGroup[j]);
    const delta = Math.max(a.max, b.max) - Math.min(a.min, b.min);
    // Preserve the original affinity envelope. A bridging third ingredient or
    // an averaged affinity cannot quietly admit incompatible source fluids.
    if (delta >= threshold || threshold <= 0) return 0;
    const joined = a.id !== b.id;
    if (joined) {
      const mass = a.mass + b.mass;
      for (let k = 0; k < MIX_PROPERTIES.length; k++) a.target[k] = (a.target[k] * a.mass + b.target[k] * b.mass) / mass;
      a.mass = mass; a.min = Math.min(a.min, b.min); a.max = Math.max(a.max, b.max); b.parent = a.id;
    }
    const distinct = joined || ps.materialId[i] !== ps.materialId[j]
      || Math.abs(ps.r[i] - ps.r[j]) + Math.abs(ps.g[i] - ps.g[j]) + Math.abs(ps.b[i] - ps.b[j]) > .001;
    this.signal[i] = Math.max(this.signal[i], contact * (distinct ? 1 : this.previous[j]));
    this.signal[j] = Math.max(this.signal[j], contact * (distinct ? 1 : this.previous[i]));
    return clamp(1 - delta / threshold, 0, 1);
  }
  finishFrame(ps, rules, dt) {
    // These two channels are also consumed by reactive chemistry. Their target
    // follows the current conserved reaction state instead of restoring fuel.
    const reactive = [MIX_PROPERTIES.indexOf('reactionPotential'), MIX_PROPERTIES.indexOf('reactionHeat')];
    for (const group of this.groups.values()) if (group.id === group.parent) for (const k of reactive) group.target[k] = 0;
    for (let i = 0; i < ps.count; i++) {
      const group = this.root(ps.mixtureGroup[i]);
      for (const k of reactive) group.target[k] += ps[MIX_PROPERTIES[k]][i] * ps.mass[i] / Math.max(.00001, group.mass);
    }
    for (let i = 0; i < ps.count; i++) {
      if (ps.phase[i] === Phase.SOLID) continue;
      const group = this.root(ps.mixtureGroup[i]);
      ps.mixtureGroup[i] = group.id;
      const progress = ps.mixtureProgress[i] + (1 - ps.mixtureProgress[i]) * (1 - Math.exp(-4 * this.signal[i] * dt));
      ps.mixtureProgress[i] = progress;
      if (progress <= 0) continue;
      const warmth = Math.max(0, ps.temperature[i] - .33);
      const thermal = Math.exp(clamp(warmth * (rules.mixingTemperatureCoefficient ?? 0), 0, 1.4));
      const motion = 1 + Math.min(2, Math.hypot(ps.vx[i], ps.vy[i], ps.vz[i]) * .3);
      const fraction = 1 - Math.exp(-1.8 * Math.max(0, rules.baseMixingRate / 2.2) * progress * thermal * motion * dt);
      for (let k = 0; k < MIX_PROPERTIES.length; k++) { const values = ps[MIX_PROPERTIES[k]]; values[i] += (group.target[k] - values[i]) * fraction; }
      ps.density[i] = ps.effectiveDensityAt(i);
    }
  }
  snapshot() {
    return { nextId: this.nextId, groups: [...this.groups.values()].map(g => ({ ...g, target: [...g.target] })), materialGroups: [...this.materialGroups] };
  }
  restore(saved, ps) {
    this.reset();
    if (!saved) { ps.mixtureGroup.fill(0); ps.mixtureProgress.fill(0); return; }
    if (!Number.isInteger(saved.nextId) || saved.nextId < 1 || !Array.isArray(saved.groups) || !Array.isArray(saved.materialGroups)) throw new Error('Invalid saved mixtures.');
    for (const g of saved.groups) {
      if (!Number.isInteger(g.id) || g.id < 1 || g.id >= saved.nextId || this.groups.has(g.id) || !Number.isInteger(g.parent) || !Number.isFinite(g.mass) || g.mass < 0 || !Number.isFinite(g.min) || !Number.isFinite(g.max) || g.min < 0 || g.max > 1 || g.max < g.min || !Array.isArray(g.target) || g.target.length !== MIX_PROPERTIES.length || g.target.some(v => !Number.isFinite(v))) throw new Error('Invalid saved mixture target.');
      this.groups.set(g.id, { ...g, target: [...g.target] });
    }
    for (const [material, id] of saved.materialGroups) {
      if (!Number.isInteger(material) || material < 1 || !this.root(id)) throw new Error('Invalid saved mixture source.');
      this.materialGroups.set(material, id);
    }
    for (let i = 0; i < ps.count; i++) if ((ps.mixtureGroup[i] !== 0 && !this.root(ps.mixtureGroup[i])) || ps.mixtureProgress[i] < 0 || ps.mixtureProgress[i] > 1) throw new Error('Invalid saved mixture parcel.');
    this.nextId = saved.nextId;
  }
}
