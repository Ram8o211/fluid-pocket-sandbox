import test from 'node:test';import assert from 'node:assert/strict';
import { Phase } from '../src/simulation/Phase.mjs';import { targetPhase, updatePhaseParticle, phaseAppearance } from '../src/simulation/PhaseSolver.mjs';import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';import { generateMaterial } from '../src/materials/MaterialGenerator.mjs';
const base={meltingTemperature:.3,boilingTemperature:.7,phaseTransitionHysteresis:.05};
test('phase transition hysteresis avoids threshold chatter',()=>{assert.equal(targetPhase(Phase.LIQUID,.33,base),Phase.LIQUID);assert.equal(targetPhase(Phase.LIQUID,.24,base),Phase.SOLID);assert.equal(targetPhase(Phase.SOLID,.36,base),Phase.LIQUID);assert.equal(targetPhase(Phase.LIQUID,.76,base),Phase.GAS);assert.equal(targetPhase(Phase.GAS,.64,base),Phase.LIQUID);});
test('liquid->gas, gas->liquid, solid->liquid, liquid->solid complete progressively',()=>{const m=generateMaterial(8,1);m.meltingTemperature=.3;m.boilingTemperature=.7;m.phaseTransitionHysteresis=.02;m.volatility=1;const ps=new ParticleSystem(4);const i=ps.add({x:0,y:0,z:0,temperature:.9},m,Phase.LIQUID);for(let k=0;k<60;k++)updatePhaseParticle(ps,i,1/30);assert.equal(ps.phase[i],Phase.GAS);ps.temperature[i]=.5;for(let k=0;k<60;k++)updatePhaseParticle(ps,i,1/30);assert.equal(ps.phase[i],Phase.LIQUID);ps.temperature[i]=.1;for(let k=0;k<60;k++)updatePhaseParticle(ps,i,1/30);assert.equal(ps.phase[i],Phase.SOLID);ps.temperature[i]=.5;for(let k=0;k<60;k++)updatePhaseParticle(ps,i,1/30);assert.equal(ps.phase[i],Phase.LIQUID);});

test('all four thermal transitions have continuous complementary appearance through the handoff', () => {
  const material = { ...generateMaterial(8, 1), meltingTemperature: .3, boilingTemperature: .7, phaseTransitionHysteresis: .02 };
  for (const [from, to, temperature] of [[Phase.LIQUID, Phase.GAS, .9], [Phase.GAS, Phase.LIQUID, .5],
    [Phase.SOLID, Phase.LIQUID, .5], [Phase.LIQUID, Phase.SOLID, .1]]) {
    const ps = new ParticleSystem(1);
    ps.add({ x: 0, y: 0, z: 0, temperature }, material, from);
    ps.phaseTarget[0] = to;
    const keys = ['solid', 'liquid', 'gas'];
    let previous = 0;
    for (let frame = 0; frame <= 100; frame++) {
      ps.phaseProgress[0] = frame / 100;
      const weights = phaseAppearance(ps, 0, {});
      assert.ok(Math.abs(weights.solid + weights.liquid + weights.gas - 1) < 1e-6);
      assert.ok(weights[keys[to]] >= previous);
      assert.ok(weights[keys[to]] - previous < .016, 'opacity must change smoothly');
      previous = weights[keys[to]];
    }
    const before = phaseAppearance(ps, 0, {});
    ps.setPhase(0, to);
    assert.deepEqual(phaseAppearance(ps, 0, {}), before, 'there must be no final opacity pop');
  }
});

test('reversing heat cannot turn almost-complete boiling into instant freezing', () => {
  const m = { ...generateMaterial(8, 1), meltingTemperature: .3, boilingTemperature: .7, phaseTransitionHysteresis: .02 };
  const ps = new ParticleSystem(1);
  ps.add({ x: 0, y: 0, z: 0, temperature: .9, vx: .4, vy: -.3 }, m, Phase.LIQUID);
  ps.phaseTarget[0] = Phase.GAS; ps.phaseProgress[0] = .99;
  ps.temperature[0] = .1;
  updatePhaseParticle(ps, 0, .025);
  assert.equal(ps.phase[0], Phase.LIQUID);
  assert.ok(ps.phaseProgress[0] < .99 && ps.phaseProgress[0] > .9, 'cancelled boiling fades out gradually');
  for (let k = 1; k < 20; k++) { updatePhaseParticle(ps, 0, .025); assert.equal(ps.phase[0], Phase.LIQUID); }
  updatePhaseParticle(ps, 0, .025);
  assert.ok(ps.phaseProgress[0] < .06, 'freezing starts with its own fresh progress');
  assert.equal(ps.phaseTarget[0], Phase.SOLID);
  assert.equal(ps.vx[0], Math.fround(.4)); assert.equal(ps.vy[0], Math.fround(-.3));
});
