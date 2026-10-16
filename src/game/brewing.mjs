import { stepArcana } from '../simulation/ArcaneSolver.mjs';
import { effectiveParticleRadius } from '../simulation/FluidSolver.mjs';
import { SimulationEngine } from '../simulation/SimulationEngine.mjs';
import { Phase } from '../simulation/Phase.mjs';
import { clamp } from '../simulation/math.mjs';
import { measurePotion } from './potion.mjs';
import { CAPACITY_ML, FIXED_STEP, ROOM_TEMPERATURE, ROOM_DENSITY } from './contracts.mjs';
import { confineCauldronBodies, confineCauldronParticle, cauldronGranularWallSupport, cauldronGasWallPressure, PARTICLE_CAPACITY, PARTICLE_ML } from './cauldron.mjs';
import { CauldronThermal } from './CauldronThermal.mjs';
import { MixtureSolver } from '../reactions/MixtureSolver.mjs';
import { LiquidFunFluid } from './LiquidFunFluid.mjs';
import { positionPouredParcels } from './cauldronPour.mjs';
import { EFFECT_PROPERTIES } from './effects.mjs';
import { capturePotionContents, restorePotionContents } from './potionTransfer.mjs';

const HISTORY = () => ({ elapsed: 0, heatEnergy: 0, coldEnergy: 0, lidCoolingEnergy: 0, condensed: 0, activation: 0, stirred: 0, peakTemperature: ROOM_TEMPERATURE, reactions: 0, evaporated: 0, discarded: 0 });
const SAVE_FIELDS = ['arcaneThreshold', 'magicDecayTemperature', 'arcaneCharge', 'arcaneConverted', 'x', 'y', 'vx', 'vy', 'mass', 'temperature', 'density', 'baseDensity', 'phase', 'phaseProgress', 'r', 'g', 'b', 'opacity', 'viscosity', 'cohesion', 'miscibility', 'particleRadius', 'incompressible', 'heatCapacity', 'thermalConductivity', 'meltingTemperature', 'boilingTemperature', 'phaseHysteresis', 'volatility', 'reactionPotential', 'reactionHeat', 'compressibility', 'crystallinity', 'solidSubdivision', 'electricalConductivity', 'electricPotential', 'combustionTemperature', 'combustionProgress', 'materialId', 'age', 'localGasDensity', 'mixtureGroup', 'mixtureProgress', 'mixtureAmount', 'powderContent', 'dissolutionProgress', 'solventMeltingTemperature', ...EFFECT_PROPERTIES];

/** Sole writer between game actions and the simulation. Renderers may read engine
 * buffers. UI handlers call this adapter, never write particle arrays themselves. */
export class BrewingSession {
  constructor(ingredients, equipment = {}) {
    this.ingredients = ingredients; this.equipment = equipment;
    this.engine = new SimulationEngine(PARTICLE_CAPACITY);
    // The browser loads Google's unmodified official LiquidFun runtime before
    // this module. Node/unit-only environments retain the old fallback engine.
    // Native contacts integrate liquids and solids, never magic or heat fields.
    if (typeof globalThis.b2World === 'function') {
      this.engine.liquidFun = new LiquidFunFluid();
      if (typeof document !== 'undefined') document.body.dataset.physicsEngine = 'liquidfun';
    }
    this.engine.ps.packingScale = .6;
    this.engine.ps.volumePacking = true;
    this.engine.setDimensionMode('2D'); this.engine.resizeBox(5.6, 3.2, 3);
    this.engine.env.environmentDensity = ROOM_DENSITY;
    this.engine.env.gasBuoyancyUsesMaterialDensity = true;
    this.engine.env.gasContactScale = 1.7;
    this.engine.env.gasContactStrength = 1.2;
    this.engine.env.gasConstraintVelocityShare = .1;
    this.engine.env.gasThermalMotion = .28;
    this.engine.env.gasDrag = .9;
    this.engine.env.gasFlowCoupling = 2.5;
    this.engine.env.gasWallPressure = cauldronGasWallPressure;
    this.engine.solid.compactFreezing = true;
    this.engine.rules.evaporationRate = .22;
    this.engine.rules.combustionRate = .22;
    this.engine.rules.combustionHeatScale = .3;
    this.engine.env.ambientTemperature = ROOM_TEMPERATURE;
    this.engine.env.gravityStrength = 4.5; this.engine.setGravity(0, -1, 0);
    this.engine.env.mobileContactBudget = true;
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
    this.engine.reactions.mixtures.materials = this.engine.materials;
    this.engine.iterations = 1;
    this.engine.boundaryCollider = () => this.confineCauldron();
    this.engine.env.granularWallSupport = cauldronGranularWallSupport;
    this.engine.rules.mixingTemperatureCoefficient = 3.5;
    this.engine.rules.heatSolubility = .95;
    // Keep the *relative* neighbour reach of the former fine-grained parcels.
    // Larger particles need proportionally wider contact to exchange density,
    // heat and colour; otherwise heavy liquids cannot pass light layers.
    // Contact pairs per particle stay similar while the particle count halves.
    this.engine.rules.interactionRadiusScale = .5 * Math.sqrt(PARTICLE_ML / .25);
    // Vapour condensation depends on density per support area: a liquid-only
    // resolution optimization must not change its saturation thresholds.
    this.engine.rules.gasInteractionRadiusScale = .5;
    this.engine.grid.cellSize = .15;
    this.engine.grid.configure(this.engine.env.box);
    this.previousPhases = new Int32Array(PARTICLE_CAPACITY);
    // Pinned ingredients in old saves retain all measured properties, with the
    // same fine packing scale as newly generated worlds.
    for (const ingredient of ingredients) this.engine.registerMaterial({ ...ingredient.material, particleRadius: clamp(ingredient.material.particleRadius, .10, .11) });
    this.history = HISTORY(); this.cost = { ingredients: 0, energy: 0 };
    this.portions = []; this.actions = []; this.heat = 0; this.cool = 0;
    this.bottles = 0; this.lastPour = null;
    this.batchId = crypto.randomUUID();
  }
  get capacity() { return CAPACITY_ML[clamp(this.equipment.cauldron || 0, 0, 2)]; }
  dispose() { this.engine.liquidFun?.dispose(); }
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
  pour(ingredientId, requestedMl, inventory, { crushed = false, infinite = false, point = null } = {}) {
    const ingredient = this.ingredients.find(i => i.id === ingredientId);
    if (!ingredient || !Number.isFinite(requestedMl) || requestedMl <= 0) return 0;
    // A recovered reagent can join this pinned world while a brew is already
    // open. Register it on first use without recreating or losing the potion.
    if (!this.engine.materials.has(ingredientId)) this.engine.registerMaterial({ ...ingredient.material,
      particleRadius: clamp(ingredient.material.particleRadius, .10, .11) });
    const ps = this.engine.ps;
    const quantity = Math.max(0, Math.floor(Math.min(requestedMl, infinite ? Infinity : inventory[ingredientId] || 0, this.capacity - this.occupiedVolume, (ps.capacity - ps.count) * PARTICLE_ML) + .00001));
    if (!quantity) return 0;
    if (!ps.count) this.batchId = crypto.randomUUID();
    const massBefore = ps.totalMass();
    const start = ps.count, x = Number.isFinite(point?.x) ? clamp(point.x, -2.2, 2.2) : (ingredientId % 2 ? -.55 : .55);
    const origin = { x, y: Number.isFinite(point?.y) ? point.y : .76 };
    const count = this.engine.emit(ingredientId, { x, y: 1, z: 0 }, quantity / PARTICLE_ML, ROOM_TEMPERATURE, .35);
    // Never allow an entire dose to start inside the same tiny sphere.
    // Space its parcels around the selected touch location, avoiding any
    // existing fluid or solid mass and without introducing an artificial kick.
    for (let i = start; i < ps.count; i++) {
      ps.mass[i] = ingredient.material.density * PARTICLE_ML;
      ps.mixtureAmount[i] = PARTICLE_ML;
    }
    positionPouredParcels(ps, start, origin);
    const solid = ingredient.form && ingredient.form !== 'liquid' && ingredient.form !== 'water';
    const loose = ingredient.form === 'powder' || (crushed && solid);
    for (let i = start; i < ps.count; i++) {
      if (solid) ps.setPhase(i, Phase.SOLID);
      if (loose) { ps.solidSubdivision[i] = 1; ps.powderContent[i] = 1; }
      if (ps.phase[i] === Phase.SOLID) {
        ps.solidBodyId[i] = 0;
        ps.solidLocalX[i] = ps.solidLocalY[i] = ps.solidLocalZ[i] = 0;
      }
    }
    if (solid && !loose) {
      this.engine.grid.rebuild(ps, this.engine.env.box);
      for (let i = start; i < ps.count; i++)
        if (ps.solidSubdivision[i] < .55) this.engine.solid.initializeParticle(ps, i, true, this.engine.grid);
    }
    this.confineCauldron();
    const pouredMl = count * PARTICLE_ML;
    this.history.activation *= massBefore / Math.max(.001, ps.totalMass());
    if (!infinite) inventory[ingredientId] = Math.max(0, (inventory[ingredientId] || 0) - pouredMl);
    this.cost.ingredients += infinite ? 0 : pouredMl * ingredient.price;
    this.portions.push({ ingredientId, ml: pouredMl, time: this.history.elapsed, crushed });
    this.lastPour = { x, color: ingredient.material.color, form: crushed ? 'powder' : ingredient.form, until: this.engine.time + .6 };
    return pouredMl;
  }
  setThermal(heat, cool = 0) {
    this.heat = clamp(Number(heat) || 0, 0, 1); this.cool = this.heat > 0 ? 0 : clamp(Number(cool) || 0, 0, 1);
  }
  stir(point, velocity, dt = FIXED_STEP, fromPoint = point, intensity = 1) {
    const ps = this.engine.ps, speed = Math.hypot(velocity.x, velocity.y);
    if (speed < .02 || !Number.isFinite(speed)) return 0;
    // Wider spoon catches a meaningful cross-section of both liquids and
    // loose powders. Sweep its footprint along the entire touch movement:
    // frame-rate-dependent pointer gaps must not leave un-stirred strips.
    const vx = clamp(velocity.x, -6, 6), vy = clamp(velocity.y, -6, 6), radius = .42;
    const sx = Number.isFinite(fromPoint?.x) ? fromPoint.x : point.x;
    const sy = Number.isFinite(fromPoint?.y) ? fromPoint.y : point.y;
    const dx = point.x - sx, dy = point.y - sy, lengthSquared = dx * dx + dy * dy;
    let affected = 0;
    for (let i = 0; i < ps.count; i++) {
      if (ps.phase[i] !== Phase.LIQUID && ps.phase[i] !== Phase.GAS &&
          !(ps.phase[i] === Phase.SOLID && ps.solidSubdivision[i] >= .55)) continue;
      const projection = lengthSquared > 1e-8
        ? clamp(((ps.x[i] - sx) * dx + (ps.y[i] - sy) * dy) / lengthSquared, 0, 1)
        : 1;
      const closestX = sx + projection * dx, closestY = sy + projection * dy;
      const distance = Math.hypot(ps.x[i] - closestX, ps.y[i] - closestY);
      const contact = radius + effectiveParticleRadius(ps, i, true);
      if (distance >= contact) continue;
      // Smooth nonzero peripheral influence allows several grains to move
      // together while keeping strong impulses centered under the spoon.
      const falloff = Math.sqrt(Math.max(0, 1 - distance / contact));
      const amount = falloff * Math.min(.52, Math.max(.015, dt) * 9) * clamp(intensity, 0, 1);
      ps.vx[i] += (vx - ps.vx[i]) * amount; ps.vy[i] += (vy - ps.vy[i]) * amount;
      ps.stirActivity[i] = Math.max(ps.stirActivity[i], falloff * Math.min(1, speed) * Math.sqrt(clamp(intensity, 0, 1)));
      ps.grainRest[i] = 0;
      affected++;
    }
    if (affected) this.history.stirred += Math.min(6, speed) * dt;
    return affected;
  }
  crush(point) {
    const ps = this.engine.ps; let affected = 0;
    for (let i = 0; i < ps.count; i++) {
      if (ps.phase[i] !== Phase.SOLID || ps.solidSubdivision[i] >= .95) continue;
      if (Math.hypot(ps.x[i] - point.x, ps.y[i] - point.y) > .18 + effectiveParticleRadius(ps, i, true)) continue;
      ps.solidSubdivision[i] = 1; ps.solidBodyId[i] = 0; ps.powderContent[i] = 1; ps.dissolutionProgress[i] = 0;
      ps.solidLocalX[i] = ps.solidLocalY[i] = ps.solidLocalZ[i] = 0;
      ps.vx[i] *= .3; ps.vy[i] = Math.min(0, ps.vy[i]); affected++;
    }
    return affected;
  }
  assistStir(dt = FIXED_STEP) {
    const angle = this.history.elapsed * 3.5, radius = 1.15;
    // Continuous automatic stirring touches more particles with the wider spoon.
    // Scale down its per-particle impulse to avoid pumping the entire liquid
    // mass upward, while direct pointer stirring retains full control.
    this.stir({ x: Math.cos(angle) * radius, y: -.6 + Math.sin(angle) * .45 }, { x: -Math.sin(angle) * radius * 3.5, y: Math.cos(angle) * .45 * 3.5 }, dt, undefined, .16);
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
      stepArcana(ps, dt, this.engine.reactions, this.engine.reactions.mixtures);
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
    confineCauldronBodies(ps);
  }
  inspect() {
    const ps = this.engine.ps;
    const sample = measurePotion(this.engine, Array.from({ length: ps.count }, (_, index) => ({ index, mass: ps.mass[index] })), this.history, this.cost);
    return sample && { ...sample, batchId: this.batchId };
  }
  inspectLiquid() {
    const ps = this.engine.ps, selections = [];
    for (let index = 0; index < ps.count; index++) if (ps.phase[index] === Phase.LIQUID) selections.push({ index, mass: ps.mass[index] });
    const sample = measurePotion(this.engine, selections, this.history, this.cost);
    return sample && { ...sample, batchId: this.batchId, portions: this.portions.map(portion => ({ ...portion })) };
  }
  bottle(requestedMl) {
    return this.drainLiquid(requestedMl);
  }
  takeSample(requestedMl = 5) {
    return this.drainLiquid(requestedMl, true);
  }
  drainLiquid(requestedMl, experiment = false) {
    if (!Number.isFinite(requestedMl) || requestedMl <= 0) throw new Error('Choose a positive vial quantity.');
    if (!experiment && this.vaporVolume > .01) throw new Error('Steam is safely trapped under the lid. Turn off the flame or use Frost, then wait for it to condense before bottling.');
    const ps = this.engine.ps, before = this.liquidVolume;
    if (before < 1) throw new Error('The cauldron needs liquid before you can bottle.');
    const quantity = Math.min(requestedMl, before), fraction = quantity / before;
    // Drain a representative fraction from every liquid particle, preserving a
    // heterogeneous sample and exactly conserving mass even after reactions.
    const selections = [];
    for (let i = 0; i < ps.count; i++) if (ps.phase[i] === Phase.LIQUID) selections.push({ index: i, mass: ps.mass[i] * fraction });
    // Solids and trapped vapour keep their share of preparation expenses and
    // recipe portions. Only the mass actually transferred belongs to this dose.
    const withdrawnMass = selections.reduce((total, selection) => total + selection.mass, 0);
    const materialFraction = withdrawnMass / Math.max(.00001, ps.totalMass());
    const cost = { ingredients: this.cost.ingredients * materialFraction, energy: this.cost.energy * materialFraction };
    const sample = measurePotion(this.engine, selections, this.history, cost);
    const contents = experiment ? null : capturePotionContents(ps, selections, this.engine.reactions.mixtures, this.engine.materials);
    const bottledPortions = this.portions.map(p => ({ ...p, ml: p.ml * materialFraction }));
    for (let n = selections.length - 1; n >= 0; n--) { const { index, mass } = selections[n]; ps.mixtureAmount[index] *= 1 - fraction; ps.mass[index] -= mass; if (ps.mass[index] < .00001) ps.removeAt(index); }
    // Bottling removes volume immediately; update source quantities too, even
    // when the player returns the vial or adds new ingredients before a tick.
    // Otherwise the next recipe incorrectly includes already-removed stock.
    const mixtures = this.engine.reactions.mixtures, remaining = new Map();
    for (let i = 0; i < ps.count; i++) {
      const root = mixtures.root(ps.mixtureGroup[i]);
      if (root) remaining.set(root.id, (remaining.get(root.id) || 0) + ps.mixtureAmount[i]);
    }
    for (const root of mixtures.groups.values()) {
      if (root.parent !== root.id) continue;
      const amount = remaining.get(root.id) || 0;
      const scale = root.amount > 0 ? amount / root.amount : 0;
      if (root.sourceAmounts instanceof Map) for (const [id, value] of root.sourceAmounts)
        root.sourceAmounts.set(id, value * scale);
      root.amount = amount;
    }
    this.cost.ingredients -= cost.ingredients; this.cost.energy -= cost.energy;
    this.portions = this.portions.map(p => ({ ...p, ml: p.ml * (1 - materialFraction) })).filter(p => p.ml > .001);
    if (!experiment) this.heat = this.cool = 0;
    this.bottles++;
    const id = `vial-${this.bottles}-${Math.round(this.history.elapsed * 1000)}`;
    if (ps.count === 0) { this.engine.reset(); this.thermal.reset(); this.history = HISTORY(); this.cost = { ingredients: 0, energy: 0 }; }
    return { ...sample, id, batchId: this.batchId, portions: bottledPortions, ...(contents ? { contents } : {}) };
  }
  returnPotion(sample) {
    const beforeMass = this.engine.ps.totalMass();
    const volume = restorePotionContents(this.engine, sample, this.capacity, this.ingredients);
    const activation = ((this.history.activation || 0) * beforeMass + (sample.history?.activation || 0) * sample.mass) / (beforeMass + sample.mass);
    if (!beforeMass) this.history = { ...HISTORY(), ...sample.history };
    else for (const key of Object.keys(HISTORY())) this.history[key] = Math.max(this.history[key] || 0, sample.history?.[key] || 0);
    this.history.activation = activation;
    this.cost.ingredients += sample.cost.ingredients || 0; this.cost.energy += sample.cost.energy || 0;
    this.portions.push(...(sample.portions || []).map(portion => ({ ...portion })));
    this.heat = this.cool = 0;
    // Reopening a sealed potion creates a new preparation. Its old ID and seal
    // remain in the notebook, but cannot certify adjustments or a new sale.
    this.batchId = crypto.randomUUID();
    this.lastPour = { x: 0, color: sample.color, form: 'liquid', until: this.engine.time + .6 };
    this.confineCauldron();
    return volume;
  }
  clean() {
    const wasted = { ...this.cost, volume: this.occupiedVolume };
    this.engine.reset(); this.thermal.reset(); this.history = HISTORY(); this.cost = { ingredients: 0, energy: 0 };
    this.portions = []; this.actions = []; this.heat = this.cool = 0;
    this.batchId = crypto.randomUUID();
    return wasted;
  }
  snapshot() {
    const ps = this.engine.ps;
    return { batchId: this.batchId, particleMl: PARTICLE_ML, count: ps.count, particles: Object.fromEntries(SAVE_FIELDS.map(k => [k, Array.from(ps[k].subarray(0, ps.count))])), materials: [...this.engine.materials.values()], thermal: this.thermal.snapshot(), mixtures: this.engine.reactions.mixtures.snapshot(), history: { ...this.history }, cost: { ...this.cost }, portions: this.portions.map(p => ({ ...p })), bottles: this.bottles, time: this.engine.time, stepIndex: this.engine.stepIndex };
  }
  restore(saved) {
    if (saved?.batchId !== undefined && (typeof saved.batchId !== 'string' || !saved.batchId || saved.batchId.length > 80)) throw new Error('Invalid saved batch identity.');
    this.batchId = saved?.batchId || crypto.randomUUID();
    if (!saved) return;
    if (!Number.isInteger(saved.count) || saved.count < 0 || saved.count > this.engine.ps.capacity) throw new Error('Invalid saved cauldron.');
    if (!saved.particles || !saved.materials?.length) throw new Error('Incomplete saved cauldron.');
    if (!saved.cost || Object.values(saved.cost).some(v => !Number.isFinite(v) || Number(v) < 0) || !saved.history || Object.values(saved.history).some(v => !Number.isFinite(v) || Number(v) < 0)) throw new Error('Invalid saved brewing history.');
    const ps = this.engine.ps;
    for (const key of SAVE_FIELDS) {
      const values = saved.particles[key];
      if (values === undefined && ['arcaneThreshold','magicDecayTemperature','arcaneCharge','arcaneConverted'].includes(key)) { ps[key].fill(key === 'arcaneThreshold' ? 8 : key === 'magicDecayTemperature' ? 1.4 : 0); continue; }
      if (values === undefined && key === 'solventMeltingTemperature') { ps[key].set(ps.meltingTemperature); continue; }
      if (values === undefined && (EFFECT_PROPERTIES.includes(key) || key === 'mixtureGroup' || key === 'mixtureProgress' || key === 'mixtureAmount' || key === 'powderContent' || key === 'dissolutionProgress')) { ps[key].fill(0); continue; }
      if (!Array.isArray(values) || values.length !== saved.count || values.some(v => !Number.isFinite(v))) throw new Error('Invalid saved particle data.');
      ps[key].set(values);
    }
    for (let i = 0; i < saved.count; i++) if (ps.mass[i] <= 0 || ![0, 1, 2].includes(ps.phase[i])) throw new Error('Invalid saved particle mass or phase.');
    for (let i=0;i<saved.count;i++) if(ps.powderContent[i]<0||ps.powderContent[i]>1||ps.dissolutionProgress[i]<0||ps.dissolutionProgress[i]>1) throw new Error('Invalid saved powder wetness.');
    for (const key of EFFECT_PROPERTIES) for (let i = 0; i < saved.count; i++) if (ps[key][i] < 0 || ps[key][i] > 1) throw new Error('Invalid saved potion effect.');
    // Ingredient definitions in the saved world are the source of truth for
    // innate magic. Older cauldron snapshots can contain an obsolete +8
    // placeholder that must not overwrite a negative garden rune on resume.
    const ingredientMagic = new Map(this.ingredients.map(ingredient => [ingredient.material.id, ingredient.material]));
    for (const material of saved.materials) {
      const original = ingredientMagic.get(material.id);
      const canonicalMagic = original ? {
        arcaneThreshold: original.arcaneThreshold,
        magicDecayTemperature: original.magicDecayTemperature,
        ...Object.fromEntries(EFFECT_PROPERTIES.map(key => [key, original[key] ?? 0]))
      } : {};
      this.engine.registerMaterial({
        ...material, ...canonicalMagic, particleRadius: clamp(material.particleRadius, .10, .11)
      });
    }
    ps.count = saved.count;
    for (let i = 0; i < ps.count; i++) {
      if (saved.particles.mixtureAmount === undefined) ps.mixtureAmount[i] = ps.mass[i] / Math.max(.04, ps.baseDensity[i]);
      if (ps.mixtureAmount[i] <= 0) throw new Error('Invalid saved mixture amount.');
    }
    if (saved.particles.powderContent === undefined) for (let i=0;i<ps.count;i++) ps.powderContent[i]=ps.phase[i]===Phase.SOLID&&ps.solidSubdivision[i]>=.55?1:0;
    // Preserve heterogeneous .25 ml parcels from earlier versions as-is.
    // Only truly coarse pre-parcel saves require splitting.
    if (saved.particleMl == null || saved.particleMl > PARTICLE_ML) this.refineLegacyParticles();
    ps.px.set(ps.x); ps.py.set(ps.y);
    ps.stirActivity.fill(0); // Reload never supplies new spoon work.
    ps.grainRest.fill(0);
    this.history = { ...HISTORY(), ...saved.history }; this.cost = { ...saved.cost };
    this.portions = (saved.portions || []).map(p => ({ ...p })); this.bottles = saved.bottles || 0;
    this.engine.time = saved.time || 0; this.engine.stepIndex = saved.stepIndex || 0;
    this.engine.sanitize(); this.confineCauldron();
    this.thermal.restore(saved.thermal, ps);
    const mixtures = this.engine.reactions.mixtures;
    mixtures.restore(saved.mixtures, ps);
    // Repair stale parcel rune values in existing saves, not just the inspector.
    // Only pure ingredients are reset; mixed parcels retain their transition
    // state and acquire their new recipe threshold when blending completes.
    for (let i = 0; i < ps.count; i++) {
      const recipe = mixtures.root(ps.mixtureGroup[i])?.arcaneRecipe;
      if (recipe?.sourceCount === 1) ps.arcaneThreshold[i] = recipe.threshold;
      else if (ps.mixtureGroup[i] === 0) {
        const original = ingredientMagic.get(ps.materialId[i]);
        if (original) ps.arcaneThreshold[i] = original.arcaneThreshold;
      }
    }
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

