import { isCoherentSolid, isPowder, wetPowderPair } from '../simulation/PowderSolver.mjs';
import { Phase } from '../simulation/Phase.mjs';
import { clamp } from '../simulation/math.mjs';
import { warmedMiscibility } from '../simulation/ArcaneSolver.mjs';
import { EFFECT_PROPERTIES } from '../materials/MaterialDefinition.mjs';

export const MIX_PROPERTIES = Object.freeze([
  'r', 'g', 'b', 'opacity', 'baseDensity', 'viscosity', 'cohesion', 'miscibility',
  'particleRadius', 'incompressible', 'heatCapacity', 'thermalConductivity',
  'meltingTemperature', 'boilingTemperature', 'phaseHysteresis', 'volatility',
  'reactionPotential', 'reactionHeat', 'compressibility', 'crystallinity',
  'solidSubdivision', 'electricalConductivity', 'combustionTemperature', ...EFFECT_PROPERTIES, 'arcaneThreshold', 'magicDecayTemperature'
]);
const FIELD_MASK=MIX_PROPERTIES.map(key=>key==='solidSubdivision'?1:['meltingTemperature','boilingTemperature','phaseHysteresis'].includes(key)?2:0);

// Groups retain the original affinity envelope and saved source proportions.
// Transport itself is local: no parcel ever relaxes to a batch-wide target.
// Double-buffered, conservative edge fluxes advance only one contact per tick.
export class MixtureSolver {
  constructor() {
    this.reset(); this.previous = this.signal = new Float32Array(0);
    this.channels = []; this.before = []; this.delta = []; this.weight = new Float64Array(0);
    this.left = this.right = new Uint32Array(0); this.fraction = new Float32Array(0); this.edgeCount = 0;
    this.rightFraction=new Float32Array(0);this.edgeMask=new Uint8Array(0);this.signature=new Int32Array(0);this.activeFields=[];this.bits=[];this.cachedPs=null;
  }
  reset() { this.groups = new Map(); this.materialGroups = new Map(); this.nextId = 1; }
  root(id) {
    let group = this.groups.get(id);
    for (let n = 0; group && group.parent !== group.id && n < this.groups.size; n++) group = this.groups.get(group.parent);
    if (group && group.parent !== group.id) throw new Error('Invalid saved mixture membership.');
    return group;
  }
  beginFrame(ps) {
    if (this.previous.length < ps.capacity) {
      this.previous = new Float32Array(ps.capacity); this.signal = new Float32Array(ps.capacity); this.weight = new Float64Array(ps.capacity);
      this.before = MIX_PROPERTIES.map(() => new Float32Array(ps.capacity));
      this.bits = this.before.map(values => new Int32Array(values.buffer));
      this.delta = MIX_PROPERTIES.map(() => new Float64Array(ps.capacity));
      this.left = new Uint32Array(ps.capacity * 12); this.right = new Uint32Array(ps.capacity * 12); this.fraction = new Float32Array(ps.capacity * 12);
      this.rightFraction=new Float32Array(ps.capacity*12);this.edgeMask=new Uint8Array(ps.capacity*12);this.signature=new Int32Array(ps.capacity);
    }
    if(this.cachedPs!==ps){this.channels=MIX_PROPERTIES.map(key=>ps[key]);this.cachedPs=ps;} this.weight.fill(0, 0, ps.count); this.edgeCount = 0;
    this.signature.fill(2166136261,0,ps.count);this.activeFields.length=0;
    for (let k = 0; k < MIX_PROPERTIES.length; k++) {
      const values=this.before[k];values.set(this.channels[k].subarray(0, ps.count));this.delta[k].fill(0,0,ps.count);
      const bits=this.bits[k];let first=values[0],varied=false;
      for(let i=0;i<ps.count;i++){this.signature[i]=Math.imul(this.signature[i]^bits[i],16777619);varied=varied||values[i]!==first;}
      if(varied)this.activeFields.push(k);
    }
    this.previous.set(ps.mixtureProgress.subarray(0, ps.count)); this.signal.fill(0, 0, ps.count);
    for (const group of this.groups.values()) group.amount = 0;
    // Count remaining parcels before adding fresh stock; partial bottling and
    // combustion must affect the next mixture's proportions immediately.
    for (let i = 0; i < ps.count; i++) { const group = this.root(ps.mixtureGroup[i]); if (group) { ps.mixtureGroup[i] = group.id; group.amount += ps.mixtureAmount[i]; } }
    for (let i = 0; i < ps.count; i++) {
      if (this.root(ps.mixtureGroup[i])) continue;
      let group = this.root(this.materialGroups.get(ps.materialId[i]));
      if (!group || group.amount === 0) {
        const id = this.nextId++;
        group = { id, parent: id, amount: 0, min: ps.miscibility[i], max: ps.miscibility[i], target: MIX_PROPERTIES.map(() => 0) };
        this.groups.set(id, group); this.materialGroups.set(ps.materialId[i], id);
      }
      const amount = group.amount + ps.mixtureAmount[i];
      for (let k = 0; k < MIX_PROPERTIES.length; k++) group.target[k] = (group.target[k] * group.amount + ps[MIX_PROPERTIES[k]][i] * ps.mixtureAmount[i]) / amount;
      group.amount = amount; group.min = Math.min(group.min, ps.miscibility[i]); group.max = Math.max(group.max, ps.miscibility[i]);
      ps.mixtureGroup[i] = group.id; ps.mixtureProgress[i] = this.previous[i] = 0;
    }
  }
  contact(ps, i, j, contact, threshold, dt=0, rules=null) {
    if (isCoherentSolid(ps,i) || isCoherentSolid(ps,j)) return 0;
    const a = this.root(ps.mixtureGroup[i]), b = this.root(ps.mixtureGroup[j]);
    const delta = Math.max(a.max, b.max) - Math.min(a.min, b.min);
    // Preserve the original affinity envelope. A bridging third ingredient or
    // an averaged affinity cannot quietly admit incompatible source fluids.
    threshold = warmedMiscibility(ps, i, j, threshold, rules);
    if (delta >= threshold || threshold <= 0) return 0;
    const compatibility=clamp(1-delta/threshold,0,1),work=Math.max(ps.stirActivity[i],ps.stirActivity[j]);
    // Resting solvent cannot convert sand into a suspension. Its grains keep
    // their phase properties until an actual spoon stroke kneads the contact.
    if (((isPowder(ps,i)&&ps.phase[j]===Phase.LIQUID)||(isPowder(ps,j)&&ps.phase[i]===Phase.LIQUID))&&work<.025)return 0;
    wetPowderPair(ps,i,j,contact,dt);
    const joined = a.id !== b.id;
    if (joined) {
      const amount = a.amount + b.amount;
      for (let k = 0; k < MIX_PROPERTIES.length; k++) a.target[k] = (a.target[k] * a.amount + b.target[k] * b.amount) / amount;
      a.amount = amount; a.min = Math.min(a.min, b.min); a.max = Math.max(a.max, b.max); b.parent = a.id;
    }
    const distinct = joined || this.signature[i]!==this.signature[j];
    this.signal[i] = Math.max(this.signal[i], contact * (distinct ? 1 : this.previous[j]));
    this.signal[j] = Math.max(this.signal[j], contact * (distinct ? 1 : this.previous[i]));
    if(this.signature[i]===this.signature[j])return compatibility;
    const warmth=Math.max(0,(ps.temperature[i]+ps.temperature[j])*.5-.33);
    const thermal=Math.exp(clamp(warmth*(rules?.mixingTemperatureCoefficient??0),0,1.4));
    const rate=(rules?.baseMixingRate??2.2)*Math.pow(compatibility,rules?.mixingExponent??1.7)*contact*thermal*(1+work*18);
    const fraction=1-Math.exp(-rate*dt);
    if(fraction>0){
      if(this.edgeCount===this.left.length){const grow=old=>{const next=new old.constructor(old.length*2);next.set(old);return next;};this.left=grow(this.left);this.right=grow(this.right);this.fraction=grow(this.fraction);this.rightFraction=grow(this.rightFraction);this.edgeMask=grow(this.edgeMask);}
      const n=this.edgeCount++,a=ps.mixtureAmount[i],b=ps.mixtureAmount[j],sum=Math.max(.00001,a+b);
      this.left[n]=i;this.right[n]=j;this.fraction[n]=fraction;
      this.edgeMask[n]=(ps.phase[i]===Phase.SOLID||ps.phase[j]===Phase.SOLID?1:0)|(isPowder(ps,i)||isPowder(ps,j)?2:0);
      this.weight[i]+=fraction*b/sum;this.weight[j]+=fraction*a/sum;
    }
    return compatibility;
  }
  finishFrame(ps, rules, dt) {
    for(let n=0;n<this.edgeCount;n++){
      const i=this.left[n],j=this.right[n],a=ps.mixtureAmount[i],b=ps.mixtureAmount[j],sum=Math.max(.00001,a+b);
      const f=this.fraction[n]/Math.max(1,this.weight[i],this.weight[j]);
      this.fraction[n]=b/sum*f;this.rightFraction[n]=a/sum*f;
    }
    // Add flux to the live fields so chemistry consumed during this tick is
    // preserved rather than replaced by an old reconstruction target.
    for(const k of this.activeFields){
      const before=this.before[k],values=this.channels[k],delta=this.delta[k],mask=FIELD_MASK[k];
      for(let n=0;n<this.edgeCount;n++){
        if(this.edgeMask[n]&mask)continue;
        const i=this.left[n],j=this.right[n],difference=before[j]-before[i];
        delta[i]+=difference*this.fraction[n];delta[j]-=difference*this.rightFraction[n];
      }
      for(let i=0;i<ps.count;i++)values[i]+=delta[i];
    }
    for (let i = 0; i < ps.count; i++) {
      const group = this.root(ps.mixtureGroup[i]);
      ps.mixtureGroup[i] = group.id;
      const progress = ps.mixtureProgress[i] + (1 - ps.mixtureProgress[i]) * (1 - Math.exp(-4 * this.signal[i] * dt));
      ps.mixtureProgress[i] = progress;
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
      // Old mixtures contain physical channels only. Their absent magical and
      // chemical concentrations remain inert when Continue upgrades the save.
      let target = g.target;
      const oldPhysical = MIX_PROPERTIES.length - EFFECT_PROPERTIES.length - 2;
      if (Array.isArray(target) && target.length === oldPhysical) target = [...target, ...EFFECT_PROPERTIES.map(() => 0)];
      if (Array.isArray(target) && target.length === MIX_PROPERTIES.length - 2) target = [...target, 8, 1.4];
      if (!Number.isInteger(g.id) || g.id < 1 || g.id >= saved.nextId || this.groups.has(g.id) || !Number.isInteger(g.parent) || !Number.isFinite(g.amount) || g.amount < 0 || !Number.isFinite(g.min) || !Number.isFinite(g.max) || g.min < 0 || g.max > 1 || g.max < g.min || !Array.isArray(target) || target.length !== MIX_PROPERTIES.length || target.some(v => !Number.isFinite(v))) throw new Error('Invalid saved mixture target.');
      this.groups.set(g.id, { ...g, target: [...target] });
    }
    for (const [material, id] of saved.materialGroups) {
      if (!Number.isInteger(material) || material < 1 || !this.root(id)) throw new Error('Invalid saved mixture source.');
      this.materialGroups.set(material, id);
    }
    for (let i = 0; i < ps.count; i++) if ((ps.mixtureGroup[i] !== 0 && !this.root(ps.mixtureGroup[i])) || ps.mixtureProgress[i] < 0 || ps.mixtureProgress[i] > 1) throw new Error('Invalid saved mixture parcel.');
    this.nextId = saved.nextId;
  }
}
