import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';
import { SpatialGrid } from '../src/simulation/SpatialGrid.mjs';
import { SolidSolver } from '../src/simulation/SolidSolver.mjs';
import { freezeConnectedLiquids } from '../src/simulation/CoherentFreezing.mjs';
import { Phase } from '../src/simulation/Phase.mjs';
import { phaseAppearance, updatePhaseParticle } from '../src/simulation/PhaseSolver.mjs';
import { generateMaterial } from '../src/materials/MaterialGenerator.mjs';

test('connected cold liquid freezes as one exact rigid silhouette, not scattered grains', () => {
  const ps = new ParticleSystem(16), solid = new SolidSolver(), grid = new SpatialGrid(16);
  const a = generateMaterial(1, 1), b = generateMaterial(2, 1);
  const positions = [[0, 0], [.09, .02], [.18, .04], [.12, -.08], [1.2, .4], [1.28, .4]];
  for (let i = 0; i < positions.length; i++) {
    const index = ps.add({ x: positions[i][0], y: positions[i][1], vx: i*.1, vy: -.2, temperature: .01 }, i%2?b:a, Phase.LIQUID);
    ps.meltingTemperature[index] = .3;
    ps.phaseHysteresis[index] = .01;
    ps.phaseTarget[index] = Phase.SOLID;
    ps.phaseProgress[index] = i===3 || i===5 ? .5 : 1;
  }
  const originalMass = ps.totalMass();
  ps.nativeLiquidRadius = .055;
  grid.setDimensionMode('2D');
  grid.rebuild(ps, { width: 5.6, height: 3.2, depth: 3 });
  assert.equal(freezeConnectedLiquids(ps, grid, solid, true), 0, 'no premature grain changes within either cluster');
  assert.equal(ps.phaseCounts()[Phase.LIQUID], 6);
  ps.phaseProgress[3] = 1;
  assert.equal(freezeConnectedLiquids(ps, grid, solid, true), 4);
  assert.equal(ps.phaseCounts()[Phase.SOLID], 4);
  const id = ps.solidBodyId[0];
  assert.ok(id > 0);
  for (let i = 0; i < 4; i++) {
    assert.equal(ps.solidBodyId[i], id);
    assert.equal(ps.solidSubdivision[i], 0);
    assert.ok(Math.abs(ps.frozenRadius[i] - .055) < .000001);
    assert.ok(Math.abs(ps.x[i] - positions[i][0]) < 1e-6);
    assert.ok(Math.abs(ps.y[i] - positions[i][1]) < 1e-6);
    assert.deepEqual(phaseAppearance(ps, i, {}), { solid: 1, liquid: 0, gas: 0 });
  }
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    assert.ok(Math.abs(ps.solidLocalX[i] - ps.solidLocalX[j] - (positions[i][0]-positions[j][0])) < 1e-6);
    assert.ok(Math.abs(ps.solidLocalY[i] - ps.solidLocalY[j] - (positions[i][1]-positions[j][1])) < 1e-6);
  }
  ps.phaseProgress[5] = 1;
  assert.equal(freezeConnectedLiquids(ps, grid, solid, true), 2);
  assert.equal(ps.solidBodyId[4], ps.solidBodyId[5]);
  assert.notEqual(ps.solidBodyId[4], id, 'distant droplets remain separate');
  assert.equal(ps.totalMass(), originalMass);
  ps.setPhase(0, Phase.LIQUID);
  solid.onMelt(ps, 0);
  assert.equal(ps.frozenRadius[0], 0);
  assert.equal(ps.solidBodyId[0], 0);
});

test('freezing handoff waits for the last nucleation clock without changing momentum or positions', () => {
  const material = generateMaterial(8, 2);
  const ps = new ParticleSystem(2), grid = new SpatialGrid(2), solid = new SolidSolver();
  for (let i = 0; i < 2; i++) {
    ps.add({ x: i*.1, y: -.2, vx: .3, vy: -.1, temperature: .1 }, material, Phase.LIQUID);
    ps.meltingTemperature[i] = .3; ps.phaseHysteresis[i] = .01;
    ps.volatility[i] = i===0 ? 1 : .1;
  }
  grid.setDimensionMode('2D');
  grid.rebuild(ps, { width: 5.6, height: 3.2, depth: 3 });
  let firstReady = false;
  for (let step = 0; step < 200; step++) {
    updatePhaseParticle(ps, 0, .025, null, null, true);
    updatePhaseParticle(ps, 1, .025, null, null, true);
    if (ps.phaseProgress[0] === 1 && ps.phaseProgress[1] < 1) {
      firstReady = true;
      assert.equal(freezeConnectedLiquids(ps, grid, solid, true), 0);
      assert.equal(ps.phaseCounts()[Phase.LIQUID], 2);
    }
    if (ps.phaseProgress[1] === 1) break;
  }
  assert.ok(firstReady);
  assert.equal(freezeConnectedLiquids(ps, grid, solid, true), 2);
  assert.equal(ps.solidBodyId[0], ps.solidBodyId[1]);
  assert.ok(Math.abs(ps.vx[0] - .3) < 1e-6);
  assert.ok(Math.abs(ps.vy[0] + .1) < 1e-6);
});
