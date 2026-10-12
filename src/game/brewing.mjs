import { SimulationEngine } from '../simulation/SimulationEngine.mjs';
import { Phase } from '../simulation/Phase.mjs';
import { clamp } from '../simulation/math.mjs';
import { measurePotion } from './potion.mjs';
import { CAPACITY_ML, FIXED_STEP, ROOM_TEMPERATURE } from './contracts.mjs';

const HISTORY = () => ({ elapsed: 0, heatEnergy: 0, coldEnergy: 0, activation: 0, stirred: 0, peakTemperature: ROOM_TEMPERATURE, reactions: 0, evaporated: 0, discarded: 0 });
const SAVE_FIELDS = ['x', 'y', 'vx', 'vy', 'mass', 'temperature', 'density', 'baseDensity', 'phase', 'phaseProgress', 'r', 'g', 'b', 'opacity', 'viscosity', 'cohesion', 'miscibility', 'particleRadius', 'incompressible', 'heatCapacity', 'thermalConductivity', 'meltingTemperature', 'boilingTemperature', 'phaseHysteresis', 'volatility', 'reactionPotential', 'reactionHeat', 'compressibility', 'crystallinity', 'solidSubdivision', 'electricalConductivity', 'electricPotential', 'combustionTemperature', 'combustionProgress', 'materialId', 'age', 'localGasDensity'];

/** Sole writer between game actions and the simulation. Renderers may read engine
 * buffers. UI handlers call this adapter, never write particle arrays themselves. */
export class BrewingSession {
  constructor(ingredients, equipment = {}) {
    this.ingredients = ingredients; this.equipment = equipment;
    this.engine = new SimulationEngine(768);
    this.engine.setDimensionMode('2D'); this.engine.resizeBox(5.6, 3.2, 3);
    this.engine.env.environmentDensity = .22;
    this.engine.env.gravityStrength = 4.5; this.engine.setGravity(0, -1, 0);
    this.engine.iterations = 1;
    for (const ingredient of ingredients) this.engine.registerMaterial(ingredient.material);
    this.history = HISTORY(); this.cost = { ingredients: 0, energy: 0 };
    this.portions = []; this.actions = []; this.heat = 0; this.cool = 0;
    this.bottles = 0; this.lastPour = null;
  }
  get capacity() { return CAPACITY_ML[clamp(this.equipment.cauldron || 0, 0, 2)]; }
  get liquidVolume() {
    const ps = this.engine.ps; let ml = 0;
    for (let i = 0; i < ps.count; i++) if (ps.phase[i] === Phase.LIQUID) ml += ps.mass[i] / Math.max(.04, ps.density[i]);
    return ml;
  }
  get occupiedVolume() {
    const ps = this.engine.ps; let ml = 0;
    for (let i = 0; i < ps.count; i++) if (ps.phase[i] !== Phase.GAS) ml += ps.mass[i] / Math.max(.04, ps.baseDensity[i]);
    return ml;
  }
  pour(ingredientId, requestedMl, inventory) {
    const ingredient = this.ingredients.find(i => i.id === ingredientId);
    if (!ingredient || !Number.isFinite(requestedMl) || requestedMl <= 0) return 0;
    const ps = this.engine.ps;
    const quantity = Math.max(0, Math.floor(Math.min(requestedMl, inventory[ingredientId] || 0, this.capacity - this.occupiedVolume, ps.capacity - ps.count) + .00001));
    if (!quantity) return 0;
    const start = ps.count, x = ingredientId % 2 ? -1.2 : 1.2;
    const count = this.engine.emit(ingredientId, { x, y: 1.12, z: 0 }, quantity, ROOM_TEMPERATURE, .65);
    for (let i = start; i < ps.count; i++) { ps.mass[i] = ingredient.material.density; ps.vy[i] = -1.3; }
    inventory[ingredientId] = Math.max(0, (inventory[ingredientId] || 0) - count);
    this.cost.ingredients += count * ingredient.price;
    this.portions.push({ ingredientId, ml: count, time: this.history.elapsed });
    this.lastPour = { x, color: ingredient.material.color, until: this.engine.time + .6 };
    return count;
  }
  setThermal(heat, cool = 0) {
    this.heat = clamp(Number(heat) || 0, 0, 1); this.cool = this.heat > 0 ? 0 : clamp(Number(cool) || 0, 0, 1);
  }
  stir(point, velocity, dt = FIXED_STEP) {
    const ps = this.engine.ps, speed = Math.hypot(velocity.x, velocity.y);
    if (speed < .02 || !Number.isFinite(speed)) return 0;
    const vx = clamp(velocity.x, -6, 6), vy = clamp(velocity.y, -6, 6), radius = 1.55;
    let affected = 0;
    for (let i = 0; i < ps.count; i++) {
      if (ps.phase[i] !== Phase.LIQUID) continue;
      const distance = Math.hypot(ps.x[i] - point.x, ps.y[i] - point.y);
      if (distance >= radius) continue;
      const amount = (1 - distance / radius) * Math.min(.45, Math.max(.015, dt) * 8);
      ps.vx[i] += (vx - ps.vx[i]) * amount; ps.vy[i] += (vy - ps.vy[i]) * amount;
      affected++;
    }
    if (affected) this.history.stirred += Math.min(6, speed) * dt;
    return affected;
  }
  assistStir(dt = FIXED_STEP) {
    const angle = this.history.elapsed * 3.5, radius = 1.15;
    this.stir({ x: Math.cos(angle) * radius, y: -.6 + Math.sin(angle) * .45 }, { x: -Math.sin(angle) * radius * 3.5, y: Math.cos(angle) * .45 * 3.5 }, dt);
  }
  step(dt = FIXED_STEP) {
    const ps = this.engine.ps;
    if (ps.count) {
      const power = (this.heat * 3.2 - this.cool * 3.8) * (1 + (this.equipment.furnace || 0) * .35);
      if (power) {
        let sum = 0; const weights = [];
        for (let i = 0; i < ps.count; i++) { const proximity = this.heat ? 1 - (ps.y[i] + 1.4) / 3 : (ps.y[i] + 1.6) / 3.2; weights[i] = ps.mass[i] * (.15 + .85 * clamp(proximity, 0, 1)); sum += weights[i]; }
        let appliedEnergy = 0;
        for (let i = 0; i < ps.count; i++) {
          const energy = power * dt * weights[i] / Math.max(.0001, sum), capacity = Math.max(.02, ps.mass[i] * ps.heatCapacity[i]);
          const before = ps.temperature[i]; ps.temperature[i] = clamp(before + energy / capacity, .01, 1.2);
          appliedEnergy += (ps.temperature[i] - before) * capacity;
        }
        if (appliedEnergy > 0) this.history.heatEnergy += appliedEnergy; else this.history.coldEnergy -= appliedEnergy;
        this.cost.energy += Math.abs(appliedEnergy) * .025;
      }
      this.engine.step(dt); this.confineCauldron();
      let mass = 0, activation = 0;
      for (let i = 0; i < ps.count; i++) { mass += ps.mass[i]; activation += Math.max(0, ps.temperature[i] - .42) * ps.mass[i]; this.history.peakTemperature = Math.max(this.history.peakTemperature, ps.temperature[i]); }
      this.history.activation = clamp(this.history.activation + activation / Math.max(.001, mass) * dt * .35, 0, 1);
      this.history.reactions += this.engine.stats.reactions;
    } else { this.heat = this.cool = 0; }
    this.history.elapsed += dt;
  }
  confineCauldron() {
    const ps = this.engine.ps;
    for (let i = ps.count - 1; i >= 0; i--) {
      if (ps.phase[i] === Phase.GAS) {
        if (ps.y[i] > 1.3) { this.history.evaporated += ps.mass[i] / Math.max(.04, ps.baseDensity[i]); ps.removeAt(i); }
        continue;
      }
      const wall = clamp(1.48 + (ps.y[i] + 1.4) * .36, 1.48, 2.45);
      if (Math.abs(ps.x[i]) > wall) { const side = Math.sign(ps.x[i]); ps.x[i] = side * wall; if (ps.vx[i] * side > 0) ps.vx[i] *= -.08; }
      if (ps.y[i] < -1.34) { ps.y[i] = -1.34; if (ps.vy[i] < 0) ps.vy[i] *= -.08; ps.vx[i] *= .94; }
      if (ps.y[i] > 1.3) { ps.y[i] = 1.3; if (ps.vy[i] > 0) ps.vy[i] *= -.08; }
    }
  }
  inspect() {
    const ps = this.engine.ps;
    return measurePotion(this.engine, Array.from({ length: ps.count }, (_, index) => ({ index, mass: ps.mass[index] })), this.history, this.cost);
  }
  bottle(requestedMl) {
    if (!Number.isFinite(requestedMl) || requestedMl <= 0) throw new Error('Choose a positive vial quantity.');
    const ps = this.engine.ps, before = this.liquidVolume;
    if (before < 1) throw new Error('The cauldron needs liquid before you can bottle.');
    const quantity = Math.min(requestedMl, before), fraction = quantity / before;
    // Drain a representative fraction from every liquid particle, preserving a
    // heterogeneous sample and exactly conserving mass even after reactions.
    const selections = [];
    for (let i = 0; i < ps.count; i++) if (ps.phase[i] === Phase.LIQUID) selections.push({ index: i, mass: ps.mass[i] * fraction });
    const cost = { ingredients: this.cost.ingredients * fraction, energy: this.cost.energy * fraction };
    const sample = measurePotion(this.engine, selections, this.history, cost);
    const bottledPortions = this.portions.map(p => ({ ...p, ml: p.ml * fraction }));
    for (let n = selections.length - 1; n >= 0; n--) { const { index, mass } = selections[n]; ps.mass[index] -= mass; if (ps.mass[index] < .00001) ps.removeAt(index); }
    this.cost.ingredients -= cost.ingredients; this.cost.energy -= cost.energy;
    this.portions = this.portions.map(p => ({ ...p, ml: p.ml * (1 - fraction) })).filter(p => p.ml > .001);
    this.heat = this.cool = 0; this.bottles++;
    return { ...sample, id: `vial-${this.bottles}-${Math.round(this.history.elapsed * 1000)}`, portions: bottledPortions };
  }
  clean() {
    const wasted = { ...this.cost, volume: this.occupiedVolume };
    this.engine.reset(); this.history = HISTORY(); this.cost = { ingredients: 0, energy: 0 };
    this.portions = []; this.actions = []; this.heat = this.cool = 0;
    return wasted;
  }
  snapshot() {
    const ps = this.engine.ps;
    return { count: ps.count, particles: Object.fromEntries(SAVE_FIELDS.map(k => [k, Array.from(ps[k].subarray(0, ps.count))])), materials: [...this.engine.materials.values()], history: { ...this.history }, cost: { ...this.cost }, portions: this.portions.map(p => ({ ...p })), bottles: this.bottles, time: this.engine.time, stepIndex: this.engine.stepIndex };
  }
  restore(saved) {
    if (!saved) return;
    if (!Number.isInteger(saved.count) || saved.count < 0 || saved.count > this.engine.ps.capacity) throw new Error('Invalid saved cauldron.');
    if (!saved.particles || !saved.materials?.length) throw new Error('Incomplete saved cauldron.');
    const ps = this.engine.ps;
    for (const key of SAVE_FIELDS) {
      const values = saved.particles[key];
      if (!Array.isArray(values) || values.length !== saved.count || values.some(v => !Number.isFinite(v))) throw new Error('Invalid saved particle data.');
      ps[key].set(values);
    }
    for (let i = 0; i < saved.count; i++) if (ps.mass[i] <= 0 || ![0, 1, 2].includes(ps.phase[i])) throw new Error('Invalid saved particle mass or phase.');
    for (const material of saved.materials) this.engine.registerMaterial(material);
    ps.count = saved.count; ps.px.set(ps.x); ps.py.set(ps.y);
    this.history = { ...HISTORY(), ...saved.history }; this.cost = { ...saved.cost };
    this.portions = (saved.portions || []).map(p => ({ ...p })); this.bottles = saved.bottles || 0;
    this.engine.time = saved.time || 0; this.engine.stepIndex = saved.stepIndex || 0;
    // Reconstruct rigid body membership if a save contained frozen liquid.
    this.engine.grid.rebuild(ps, this.engine.env.box);
    for (let i = 0; i < ps.count; i++) if (ps.phase[i] === Phase.SOLID) this.engine.solid.initializeParticle(ps, i, true, this.engine.grid);
    this.engine.sanitize(); this.confineCauldron();
  }
}
