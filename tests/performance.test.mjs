import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';
import { SpatialGrid } from '../src/simulation/SpatialGrid.mjs';
import { generateMaterial } from '../src/materials/MaterialGenerator.mjs';
import { performanceProfileFor } from '../src/simulation/SimulationEngine.mjs';

test('pair grid visits each candidate pair once without mirrored duplicates',()=>{
  const ps=new ParticleSystem(8),m=generateMaterial(321,1);for(let i=0;i<4;i++)ps.add({x:i*.08,y:0,z:0},m);
  const grid=new SpatialGrid(8);grid.rebuild(ps,{width:5,height:5,depth:5});const seen=new Set(),pairs=[];
  grid.forEachPair(ps,.55,(a,b)=>{const key=a<b?`${a}:${b}`:`${b}:${a}`;pairs.push(key);seen.add(key);});
  assert.equal(pairs.length,6);assert.equal(seen.size,6);
});

test('large-particle scheduler preserves full fidelity at normal counts and decimates expensive passes only when needed',()=>{
  const normal=performanceProfileFor(1500,'3D'),large=performanceProfileFor(2000,'3D'),huge=performanceProfileFor(3200,'3D'),massive=performanceProfileFor(6000,'3D'),planar=performanceProfileFor(3000,'2D');
  assert.equal(normal.tier,'FULL');assert.equal(normal.thermalStride,1);assert.equal(normal.reactionStride,1);assert.equal(normal.electricalStride,1);
  assert.equal(large.tier,'LARGE');assert.equal(large.fluidIterations,1);assert.ok(large.electricalStride>1);
  assert.equal(huge.tier,'HUGE');assert.ok(huge.thermalStride>=large.thermalStride);
  assert.equal(massive.tier,'MASSIVE');assert.ok(massive.reactionStride>1);assert.ok(massive.clampStride>huge.clampStride);
  assert.equal(planar.tier,'LARGE','2D gets a higher particle budget before stronger decimation');
});
