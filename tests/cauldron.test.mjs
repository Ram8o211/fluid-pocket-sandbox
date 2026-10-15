import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLiquidWorld as generateWorld } from './helpers/liquid-world.mjs';
import { BrewingSession } from '../src/game/brewing.mjs';
import { CAULDRON_INTERIOR, PARTICLE_ML, insideCauldron, cauldronParticlePadding } from '../src/game/cauldron.mjs';
import { effectiveParticleRadius } from '../src/simulation/FluidSolver.mjs';
import { Phase } from '../src/simulation/Phase.mjs';
import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';
import { SpatialGrid } from '../src/simulation/SpatialGrid.mjs';
import { ReactionEngine } from '../src/reactions/ReactionEngine.mjs';
import { DEFAULT_RULES } from '../src/simulation/SimulationEngine.mjs';
import { sanitizeMaterial } from '../src/materials/MaterialDefinition.mjs';

const close = (a, b, tolerance = .001) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function setup() {
  const world = generateWorld('sealed-lid'), brew = new BrewingSession(world.ingredients, { cauldron: 2 });
  // Isolate reversible boiling/condensation from the separate burning mechanic.
  brew.engine.rules.combustionRate = 0;
  brew.engine.rules.combustionHeatScale = 0;
  return { world, brew, inventory: { 1: 600, 2: 600 } };
}
function contained(brew) {
  const ps = brew.engine.ps;
  for (let i = 0; i < ps.count; i++) assert.ok(insideCauldron(ps.x[i], ps.y[i], cauldronParticlePadding(ps, i)), `Particle ${i} overlaps a wall or lid`);
}
function boil(brew, inventory) {
  brew.pour(1, 20, inventory); brew.setThermal(1);
  for (let i = 0; i < 600 && brew.vaporVolume < 1; i++) brew.step();
  assert.ok(brew.vaporVolume >= 1, 'Flame must cause a real phase transition');
  brew.setThermal(0);
}

test('fine particles preserve ml, cost and mass and are much smaller than the old droplets', () => {
  const { world, brew, inventory } = setup(); brew.pour(1, 40, inventory);
  const ps = brew.engine.ps;
  assert.equal(PARTICLE_ML, .5, 'new brews use two parcels per ml');
  assert.equal(ps.count, 40 / PARTICLE_ML); close(brew.liquidVolume, 40);
  close(ps.totalMass(), world.ingredients[0].material.density * 40);
  close(brew.cost.ingredients, world.ingredients[0].price * 40); assert.equal(inventory[1], 560);
  for (let i = 0; i < ps.count; i++) assert.ok(effectiveParticleRadius(ps, i, true) < .065);
  contained(brew);
});

test('all phases collide by their full radius with the lid, floor, walls and corners', () => {
  const { brew, inventory } = setup(); brew.pour(1, 10, inventory);
  const ps = brew.engine.ps;
  for (const phase of [Phase.LIQUID, Phase.GAS, Phase.SOLID]) {
    for (let i = 0; i < ps.count; i++) {
      const [x, y] = CAULDRON_INTERIOR[i % CAULDRON_INTERIOR.length];
      ps.x[i] = x * 1.5; ps.y[i] = y * 1.5; ps.vx[i] = x * 5; ps.vy[i] = y * 5;
      ps.setPhase(i, phase);
    }
    const mass = ps.totalMass(); brew.confineCauldron(); contained(brew); close(ps.totalMass(), mass);
    assert.equal(ps.count, 10 / PARTICLE_ML); assert.equal(brew.history.evaporated, 0);
  }
});

test('maximum-capacity fluid remains visibly contained under sustained stirring', () => {
  const { brew, inventory } = setup(); brew.pour(1, 220, inventory); brew.pour(2, 220, inventory);
  const mass = brew.engine.ps.totalMass();
  assert.equal(brew.engine.ps.count, 440 / PARTICLE_ML);
  assert.equal(brew.engine.ps.count, 880, 'full batch runs with half the old particle budget');
  for (let i = 0; i < 120; i++) { brew.assistStir(); brew.step(); contained(brew); }
  close(brew.engine.ps.totalMass(), mass, .01);
});

test('boiling retains ingredients and blocks bottling until real condensation restores liquid', () => {
  const { world, brew, inventory } = setup(); boil(brew, inventory);
  const ps = brew.engine.ps, mass = ps.totalMass(), count = ps.count;
  close(mass, 20 * world.ingredients[0].material.density);
  assert.throws(() => brew.bottle(20), /wait.*condense/i);
  const steam = brew.vaporVolume;
  brew.step(); assert.ok(brew.vaporVolume > 0, 'Condensation must take time');
  for (let i = 0; i < 1000 && brew.vaporVolume > .01; i++) { brew.step(); contained(brew); }
  close(brew.vaporVolume, 0); close(brew.liquidVolume, 20);
  assert.equal(ps.count, count); close(ps.totalMass(), mass); assert.equal(brew.history.evaporated, 0);
  assert.ok(brew.history.condensed >= steam - .001); assert.ok(brew.history.lidCoolingEnergy > 0);
  close(brew.bottle(20).volume, 20); assert.equal(ps.count, 0);
});

test('steam reserves capacity so a hot refill cannot overfill the cauldron', () => {
  const { brew, inventory } = setup(); brew.equipment.cauldron = 0; brew.pour(1, 200, inventory);
  const ps = brew.engine.ps;
  for (let i = 0; i < ps.count; i++) ps.setPhase(i, Phase.GAS);
  close(brew.occupiedVolume, 200); close(brew.vaporVolume, 200);
  assert.equal(brew.pour(1, 20, inventory), 0); assert.equal(inventory[1], 400);
});

test('Frost accelerates the same retained-steam condensation loop', () => {
  const source = setup(); boil(source.brew, source.inventory); const snapshot = source.brew.snapshot();
  const slow = new BrewingSession(source.world.ingredients), fast = new BrewingSession(source.world.ingredients);
  slow.restore(snapshot); fast.restore(snapshot); slow.engine.rules.combustionRate = fast.engine.rules.combustionRate = 0;
  slow.engine.rules.combustionHeatScale = fast.engine.rules.combustionHeatScale = 0;
  fast.setThermal(0, .35);
  const duration = brew => { let ticks = 0; while (brew.vaporVolume > .01 && ticks < 1000) { brew.step(); ticks++; } assert.equal(brew.vaporVolume, 0); return ticks; };
  const passive = duration(slow), frost = duration(fast);
  assert.ok(frost < passive, `${frost} ticks with Frost should be faster than ${passive} passively`);
});

test('warmth speeds up compatible contact mixing without blending incompatible liquids', () => {
  function residual(temperature, miscibility = .4, coefficient = 3.5) {
    const ps = new ParticleSystem(2), grid = new SpatialGrid(2), reactions = new ReactionEngine();
    const a = sanitizeMaterial({ id: 1, color: '#ff3300', miscibility: .4, meltingTemperature: .05, boilingTemperature: 1 });
    const b = sanitizeMaterial({ ...a, id: 2, color: '#0055ff', miscibility });
    ps.add({ x: -.05, y: 0, z: 0, mass: 1, temperature }, a, Phase.LIQUID);
    ps.add({ x: .05, y: 0, z: 0, mass: 1, temperature }, b, Phase.LIQUID);
    grid.setDimensionMode('2D'); grid.rebuild(ps, { width: 3, height: 3, depth: 3 });
    for (let i = 0; i < 15; i++) reactions.step(ps, grid, { ...DEFAULT_RULES, canonicalizationDistance: 0, mixingTemperatureCoefficient: coefficient }, .025);
    return Math.abs(ps.r[0] - ps.r[1]);
  }
  assert.ok(residual(.65) < residual(.33) * .4);
  close(residual(.65, .9), residual(.33, .9));
  close(residual(.65, .4, 0), residual(.33, .4, 0)); // Legacy sandbox rule.
});

test('steam and condensation progress survive reloading without losing trapped mass', () => {
  const { world, brew, inventory } = setup(); boil(brew, inventory);
  const restored = new BrewingSession(world.ingredients); restored.restore(brew.snapshot());
  restored.engine.rules.combustionRate = restored.engine.rules.combustionHeatScale = 0;
  close(restored.vaporVolume, brew.vaporVolume); close(restored.engine.ps.totalMass(), brew.engine.ps.totalMass());
  assert.deepEqual(restored.history, brew.history); assert.equal(restored.heat, 0); contained(restored);
  assert.throws(() => restored.bottle(20), /Steam/);
  for (let i = 0; i < 1000 && restored.vaporVolume > .01; i++) restored.step();
  close(restored.bottle(20).volume, 20);
});

test('legacy large-particle saves refine once while preserving all sampled properties', () => {
  const { world, brew, inventory } = setup(); brew.pour(1, 5, inventory);
  const legacy = brew.snapshot(); delete legacy.particleMl;
  legacy.count = 5;
  for (const key of Object.keys(legacy.particles)) legacy.particles[key] = legacy.particles[key].slice(0, 5);
  legacy.particles.mass.fill(world.ingredients[0].material.density);
  legacy.particles.particleRadius.fill(.19);
  const restored = new BrewingSession(world.ingredients); restored.restore(legacy);
  assert.equal(restored.engine.ps.count, 5 / PARTICLE_ML); close(restored.liquidVolume, 5);
  close(restored.inspect().density, world.ingredients[0].material.density); close(restored.inspect().temperature, .33);
  assert.equal(restored.inspect().color, brew.inspect().color); contained(restored);
  const again = new BrewingSession(world.ingredients); again.restore(restored.snapshot());
  assert.equal(again.engine.ps.count, 5 / PARTICLE_ML); close(again.liquidVolume, 5);
});
