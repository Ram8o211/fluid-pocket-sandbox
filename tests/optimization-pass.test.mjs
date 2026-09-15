import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMaterial } from '../src/materials/MaterialDefinition.mjs';
import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';
import { SpatialGrid } from '../src/simulation/SpatialGrid.mjs';
import { FluidSolver, particlePairRestDistance } from '../src/simulation/FluidSolver.mjs';
import { SimulationEngine, performanceProfileFor } from '../src/simulation/SimulationEngine.mjs';
import { sampleMaterialAt } from '../src/materials/MaterialSampler.mjs';
import { Phase } from '../src/simulation/Phase.mjs';

function material(overrides={}){return sanitizeMaterial({id:1,seed:11,name:'Test',color:'#55aaff',density:1,viscosity:.2,cohesion:.2,miscibility:.5,particleRadius:.16,meltingTemperature:.1,boilingTemperature:1,...overrides});}

test('incompressible material is opt-in and hard packing removes pair overlap',()=>{
  assert.equal(sanitizeMaterial({id:1}).incompressible,false);assert.equal(sanitizeMaterial({id:1,incompressible:true}).incompressible,true);
  const ps=new ParticleSystem(4),m=material({incompressible:true}),grid=new SpatialGrid(4,64),solver=new FluidSolver();
  const a=ps.add({x:-.04,y:0,z:0,mass:1,temperature:.5},m,Phase.LIQUID),b=ps.add({x:.04,y:0,z:0,mass:1,temperature:.5},m,Phase.LIQUID),env={maxVelocity:7,dimensionMode:'2D',box:{width:5,height:5,depth:4}},rules={miscibilityThreshold:.12};
  solver.step(ps,grid,{x:0,y:0,z:0},env,rules,1/40,1,{fluidRadius:.48,fluidPairStride:1});
  const d=Math.abs(ps.x[b]-ps.x[a]),rest=particlePairRestDistance(ps,a,b,true);assert.ok(d>=rest*.985,`expected ${d} >= ${rest*.985}`);
});

test('2D round trip restores existing depth and extrudes matter created in 2D',()=>{
  const sim=new SimulationEngine(16),m=material();sim.registerMaterial(m);const a=sim.ps.add({x:0,y:0,z:.72,mass:1,temperature:.5},m,Phase.LIQUID);
  sim.setDimensionMode('2D');assert.equal(sim.ps.z[a],0);const b=sim.ps.add({x:.21,y:.17,z:0,mass:1,temperature:.5},m,Phase.LIQUID);sim.setDimensionMode('3D');
  assert.ok(Math.abs(sim.ps.z[a]-.72)<.03);assert.ok(Math.abs(sim.ps.z[b])>.01,'2D-created particle should receive deterministic 3D depth');
});

test('2D and 3D box dimensions remain independent in the engine',()=>{
  const sim=new SimulationEngine(4);sim.resizeBox(6.2,8.1,5.1);sim.setDimensionMode('2D');assert.ok(sim.env.box.width>=18);sim.resizeBox(31,42,4);sim.setDimensionMode('3D');assert.ok(Math.abs(sim.env.box.width-6.2)<1e-6);assert.ok(Math.abs(sim.env.box.height-8.1)<1e-6);assert.ok(Math.abs(sim.env.box.depth-5.1)<1e-6);sim.setDimensionMode('2D');assert.equal(sim.env.box.width,31);assert.equal(sim.env.box.height,42);
});

test('material sampler exposes live indices and dominant share for scene linking',()=>{
  const ps=new ParticleSystem(8),a=material({id:1}),b=material({id:2,color:'#ff9955'});ps.add({x:0,y:0,z:0,mass:1,temperature:.4},a);ps.add({x:.1,y:0,z:0,mass:1,temperature:.4},a);ps.add({x:.2,y:0,z:0,mass:.2,temperature:.4},b);const s=sampleMaterialAt(ps,{x:0,y:0,z:0},.8);assert.ok(s.indices.length===3);assert.equal(s.dominantMaterialId,1);assert.ok(s.dominantShare>.7);
});

test('large 2D workloads receive stronger temporal pair decimation',()=>{
  const small=performanceProfileFor(1000,'3D'),large3=performanceProfileFor(5000,'3D'),large2=performanceProfileFor(5000,'2D');assert.equal(small.fluidPairStride,1);assert.ok(large3.fluidPairStride>=2);assert.ok(large2.fluidPairStride>=large3.fluidPairStride);assert.ok(large2.thermalStride>=large3.thermalStride);
});
