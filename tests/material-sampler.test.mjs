import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';
import { generateMaterial } from '../src/materials/MaterialGenerator.mjs';
import { sampleMaterialAt } from '../src/materials/MaterialSampler.mjs';

test('material inspector samples local particle properties only',()=>{
  const ps=new ParticleSystem(8),a=generateMaterial(1,1),b=generateMaterial(2,2);a.color='#ff0000';b.color='#0000ff';a.density=.5;b.density=1.5;
  ps.add({x:0,y:0,z:0},a);ps.add({x:.1,y:0,z:0},b);ps.add({x:3,y:0,z:0},b);
  const s=sampleMaterialAt(ps,{x:0,y:0,z:0},.5,9,'Captured');
  assert.equal(s.count,2);assert.ok(s.material.density>.5&&s.material.density<1.5);assert.deepEqual(new Set(s.sourceMaterialIds),new Set([1,2]));
});
