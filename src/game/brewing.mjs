import { SimulationEngine } from '../simulation/SimulationEngine.mjs';
import { Phase } from '../simulation/Phase.mjs';
import { clamp } from '../simulation/math.mjs';
import { measurePotion } from './potion.mjs';
import { CAPACITY_ML, FIXED_STEP, ROOM_TEMPERATURE, ROOM_DENSITY } from './contracts.mjs';
import { confineCauldronParticle, PARTICLE_CAPACITY, PARTICLE_ML } from './cauldron.mjs';
import { CauldronThermal } from './CauldronThermal.mjs';
import { MixtureSolver } from '../reactions/MixtureSolver.mjs';

const HISTORY = () => ({ elapsed: 0, heatEnergy: 0, coldEnergy: 0, lidCoolingEnergy: 0, condensed: 0, activation: 0, stirred: 0, peakTemperature: ROOM_TEMPERATURE, reactions: 0, evaporated: 0, discarded: 0 });
const SAVE_FIELDS = ['x', 'y', 'vx', 'vy', 'mass', 'temperature', 'density', 'baseDensity', 'phase', 'phaseProgress', 'r', 'g', 'b', 'opacity', 'viscosity', 'cohesion', 'miscibility', 'particleRadius', 'incompressible', 'heatCapacity', 'thermalConductivity', 'meltingTemperature', 'boilingTemperature', 'phaseHysteresis', 'volatility', 'reactionPotential', 'reactionHeat', 'compressibility', 'crystallinity', 'solidSubdivision', 'electricalConductivity', 'electricPotential', 'combustionTemperature', 'combustionProgress', 'materialId', 'age', 'localGasDensity', 'mixtureGroup', 'mixtureProgress', 'mixtureAmount'];

/** Sole writer between game actions and the simulation. Renderers may read engine
 * buffers. UI handlers call this adapter, never write particle arrays themselves. */
export class BrewingSession {
  constructor(ingredients, equipment = {}) {
    this.ingredients = ingredients; this.equipment = equipment;
    this.engine = new SimulationEngine(PARTICLE_CAPACITY);
    this.engine.setDimensionMode('2D'); this.engine.resizeBox(5.6, 3.2, 3);
    this.engine.env.environmentDensity = ROOM_DENSITY;
    this.engine.env.gasBuoyancyUsesMaterialDensity = true;
    this.engine.env.ambientTemperature = ROOM_TEMPERATURE;
    this.engine.env.gravityStrength = 4.5; this.engine.setGravity(0, -1, 0);
    // Bulk reagents are electrically neutral fluids. Conductivity still drives
    // charge exchange and alchemy, but point-charge repulsion must not levitate
    // their small, low-mass parcels against gravity.
    this.engine.rules.electrostaticStrength = 0;
    this.engine.env.liquidConstraintVelocityShare = .15;
    this.engine.env.ambientThermalExchange = 1;
    this.engine.rules.densityDrivenCondensation = true;
    this.engine.rules.condensationDensityThreshold = 4;
    this.engine.rules.condensationCoolingCoefficient = 0;
    this.engine.rules.thermalDiffusionRate = 1.2;
    this.thermal = new CauldronThermal();
    this.engine.reactions.mixtures = new MixtureSolver();
    this.engine.iterations = 1;
    this.engine.boundaryCollider = () => this.confineCauldron();
    this.engine.rules.mixingTemperatureCoefficient = 3.5;
    // Contact ranges track the finer particle spacing. The sandbox defaults are
    // untouched; local neighbours keep full cauldrons within the mobile budget.
    this.engine.rules.interactionRadiusScale = .5;
    this.engine.grid.cellSize = .29;
    this.engine.grid.configure(this.engine.env.box);
    this.previousPhases = new Int32Array(PARTICLE_CAPACITY);
    // Pinned ingredients in old saves retain all measured properties, with the
    // same fine packing scale as newly generated worlds.
    for (const ingredient of ingredients) this.engine.registerMaterial({ ...ingredient.material, particleRadius: clamp(ingredient.material.particleRadius, .10, .11) });
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
    // Trapped steam still reserves ingredient capacity: boiling cannot create
    // room for a refill which would overflow when it condenses.
    for (let i = 0; i < ps.count; i++) ml += ps.mixtureAmount[i];
    return ml;
  }
  get vaporVolume() {
    const ps = this.engine.ps; let ml = 0;
    for (let i = 0; i < ps.count; i++) if (ps.phase[i] === Phase.GAS) ml += ps.mass[i] / Math.max(.04, ps.baseDensity[i]);
    return ml;
  }
  pour(ingredientId, requestedMl, inventory) {
    const ingredient = this.ingredients.find(i => i.id === ingredientId);
    if (!ingredient || !Number.isFinite(requestedMl) || requestedMl <= 0) return 0;
    const ps = this.engine.ps;
    const quantity = Math.max(0, Math.floor(Math.min(requestedMl, inventory[ingredientId] || 0, this.capacity - this.occupiedVolume, (ps.capacity - ps.count) * PARTICLE_ML) + .00001));
    if (!quantity) return 0;
    const massBefore = ps.totalMass();
    const start = ps.count, x = ingredientId % 2 ? -1.2 : 1.2;
    const count = this.engine.emit(ingredientId, { x, y: .95, z: 0 }, quantity / PARTICLE_ML, ROOM_TEMPERATURE, .35);
    for (let i = start; i < ps.count; i++) { ps.mass[i] = ingredient.material.density * PARTICLE_ML; ps.mixtureAmount[i] = PARTICLE_ML; ps.vy[i] = -1.3; }
    this.confineCauldron();
    const pouredMl = count * PARTICLE_ML;
    this.history.activation *= massBefore / Math.max(.001, ps.totalMass());
    inventory[ingredientId] = Math.max(0, (inventory[ingredientId] || 0) - pouredMl);
    this.cost.ingredients += pouredMl * ingredient.price;
    this.portions.push({ ingredientId, ml: pouredMl, time: this.history.elapsed });
    this.lastPour = { x, color: ingredient.material.color, until: this.engine.time + .6 };
    return pouredMl;
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
    if (!ps.count) this.heat = this.cool = 0;
    const power = (this.heat * 3.2 - this.cool * 3.8) * (1 + (this.equipment.furnace || 0) * .35);
    // Passive heat exchange is gradual in either direction. While powered,
    // source energy still enters only through bottom contacts and neighbours.
    this.engine.env.ambientThermalExchange = power ? 0 : 1;
    const thermal = this.thermal.step(ps, power, dt);
    if (ps.count) {
      const previousCount = ps.count;
      this.previousPhases.set(ps.phase.subarray(0, previousCount));
      if (thermal.supplied > 0) this.history.heatEnergy += thermal.supplied; else this.history.coldEnergy -= thermal.supplied;
      this.history.lidCoolingEnergy += thermal.lidCooling;
      this.cost.energy += Math.abs(thermal.supplied) * .025;
      this.engine.step(dt);
      for (let i = 0; i < previousCount; i++) if (this.previousPhases[i] === Phase.GAS && ps.phase[i] === Phase.LIQUID) this.history.condensed += ps.mass[i] / Math.max(.04, ps.baseDensity[i]);
      let mass = 0, activation = 0;
      for (let i = 0; i < ps.count; i++) { mass += ps.mass[i]; activation += Math.max(0, ps.temperature[i] - .42) * ps.mass[i]; this.history.peakTemperature = Math.max(this.history.peakTemperature, ps.temperature[i]); }
      this.history.activation = clamp(this.history.activation + activation / Math.max(.001, mass) * dt * .35, 0, 1);
      this.history.reactions += this.engine.stats.reactions;
    } else { this.heat = this.cool = 0; }
    this.history.elapsed += dt;
  }
  confineCauldron() {
    const ps = this.engine.ps;
    for (let i = 0; i < ps.count; i++) confineCauldronParticle(ps, i);
  }
  inspect() {
    const ps = this.engine.ps;
    return measurePotion(this.engine, Array.from({ length: ps.count }, (_, index) => ({ index, mass: ps.mass[index] })), this.history, this.cost);
  }
  bottle(requestedMl) {
    if (!Number.isFinite(requestedMl) || requestedMl <= 0) throw new Error('Choose a positive vial quantity.');
    if (this.vaporVolume > .01) throw new Error('Steam is safely trapped under the lid. Turn off the flame or use Frost, then wait for it to condense before bottling.');
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
    for (let n = selections.length - 1; n >= 0; n--) { const { index, mass } = selections[n]; ps.mixtureAmount[index] *= 1 - fraction; ps.mass[index] -= mass; if (ps.mass[index] < .00001) ps.removeAt(index); }
    this.cost.ingredients -= cost.ingredients; this.cost.energy -= cost.energy;
    this.portions = this.portions.map(p => ({ ...p, ml: p.ml * (1 - fraction) })).filter(p => p.ml > .001);
    this.heat = this.cool = 0; this.bottles++;
    const id = `vial-${this.bottles}-${Math.round(this.history.elapsed * 1000)}`;
    if (ps.count === 0) { this.engine.reset(); this.thermal.reset(); this.history = HISTORY(); this.cost = { ingredients: 0, energy: 0 }; }
    return { ...sample, id, portions: bottledPortions };
  }
  clean() {
    const wasted = { ...this.cost, volume: this.occupiedVolume };
    this.engine.reset(); this.thermal.reset(); this.history = HISTORY(); this.cost = { ingredients: 0, energy: 0 };
    this.portions = []; this.actions = []; this.heat = this.cool = 0;
    return wasted;
  }
  snapshot() {
    const ps = this.engine.ps;
    return { particleMl: PARTICLE_ML, count: ps.count, particles: Object.fromEntries(SAVE_FIELDS.map(k => [k, Array.from(ps[k].subarray(0, ps.count))])), materials: [...this.engine.materials.values()], thermal: this.thermal.snapshot(), mixtures: this.engine.reactions.mixtures.snapshot(), history: { ...this.history }, cost: { ...this.cost }, portions: this.portions.map(p => ({ ...p })), bottles: this.bottles, time: this.engine.time, stepIndex: this.engine.stepIndex };
  }
  restore(saved) {
    if (!saved) return;
    if (!Number.isInteger(saved.count) || saved.count < 0 || saved.count > this.engine.ps.capacity) throw new Error('Invalid saved cauldron.');
    if (!saved.particles || !saved.materials?.length) throw new Error('Incomplete saved cauldron.');
    if (!saved.cost || Object.values(saved.cost).some(v => !Number.isFinite(v) || Number(v) < 0) || !saved.history || Object.values(saved.history).some(v => !Number.isFinite(v) || Number(v) < 0)) throw new Error('Invalid saved brewing history.');
    const ps = this.engine.ps;
    for (const key of SAVE_FIELDS) {
      const values = saved.particles[key];
      if (values === undefined && (key === 'mixtureGroup' || key === 'mixtureProgress' || key === 'mixtureAmount')) { ps[key].fill(0); continue; }
      if (!Array.isArray(values) || values.length !== saved.count || values.some(v => !Number.isFinite(v))) throw new Error('Invalid saved particle data.');
      ps[key].set(values);
    }
    for (let i = 0; i < saved.count; i++) if (ps.mass[i] <= 0 || ![0, 1, 2].includes(ps.phase[i])) throw new Error('Invalid saved particle mass or phase.');
    for (const material of saved.materials) this.engine.registerMaterial({ ...material, particleRadius: clamp(material.particleRadius, .10, .11) });
    ps.count = saved.count;
    for (let i = 0; i < ps.count; i++) {
      if (saved.particles.mixtureAmount === undefined) ps.mixtureAmount[i] = ps.mass[i] / Math.max(.04, ps.baseDensity[i]);
      if (ps.mixtureAmount[i] <= 0) throw new Error('Invalid saved mixture amount.');
    }
    if (saved.particleMl !== PARTICLE_ML) this.refineLegacyParticles();
    ps.px.set(ps.x); ps.py.set(ps.y);
    this.history = { ...HISTORY(), ...saved.history }; this.cost = { ...saved.cost };
    this.portions = (saved.portions || []).map(p => ({ ...p })); this.bottles = saved.bottles || 0;
    this.engine.time = saved.time || 0; this.engine.stepIndex = saved.stepIndex || 0;
    this.engine.sanitize(); this.confineCauldron();
    this.thermal.restore(saved.thermal, ps);
    this.engine.reactions.mixtures.restore(saved.mixtures, ps);
    // Reconstruct rigid body membership if a save contained frozen liquid.
    this.engine.grid.rebuild(ps, this.engine.env.box);
    for (let i = 0; i < ps.count; i++) if (ps.phase[i] === Phase.SOLID) this.engine.solid.initializeParticle(ps, i, true, this.engine.grid);
  }
  refineLegacyParticles() {
    const ps = this.engine.ps, count = ps.count;
    for (let i = 0; i < count; i++) {
      const volume = ps.mass[i] / Math.max(.04, ps.baseDensity[i]);
      const pieces = Math.min(Math.max(1, Math.round(volume / PARTICLE_ML)), 1 + ps.capacity - ps.count);
      const mass = ps.mass[i] / pieces, x = ps.x[i], y = ps.y[i];
      ps.mixtureAmount[i] /= pieces;
      ps.particleRadius[i] = clamp(ps.particleRadius[i], .10, .11);
      ps.mass[i] = mass;
      for (let part = 1; part < pieces; part++) {
        const index = ps.count++;
        for (const key of SAVE_FIELDS) ps[key][index] = ps[key][i];
        const angle = part * 2.399963;
        ps.x[index] = x + Math.cos(angle) * .06;
        ps.y[index] = y + Math.sin(angle) * .06;
      }
    }
  }
}

