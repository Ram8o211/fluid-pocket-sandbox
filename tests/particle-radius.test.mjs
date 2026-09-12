import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMaterial } from '../src/materials/MaterialDefinition.mjs';
import { generateMaterial } from '../src/materials/MaterialGenerator.mjs';
import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';
import { SpatialGrid } from '../src/simulation/SpatialGrid.mjs';
import { FluidSolver, effectiveParticleRadius, particlePairRestDistance } from '../src/simulation/FluidSolver.mjs';
import { Phase } from '../src/simulation/Phase.mjs';

function material(radius,id=1){
  return sanitizeMaterial({id,seed:id,name:`R${radius}`,color:'#55aaff',particleRadius:radius,density:1,viscosity:.2,cohesion:.2,miscibility:.5,meltingTemperature:.1,boilingTemperature:1});
}

function relaxedDistance(radius){
  const ps=new ParticleSystem(4),m=material(radius),grid=new SpatialGrid(4,64),solver=new FluidSolver();
  ps.add({x:-.075,y:0,z:0,mass:1,temperature:.5},m,Phase.LIQUID);
  ps.add({x:.075,y:0,z:0,mass:1,temperature:.5},m,Phase.LIQUID);
  const env={maxVelocity:7,dimensionMode:'2D',box:{width:5,height:5,depth:4}},rules={miscibilityThreshold:.12};
  for(let n=0;n<8;n++)solver.step(ps,grid,{x:0,y:0,z:0},env,rules,1/40,2);
  return Math.abs(ps.x[1]-ps.x[0]);
}

test('particle volume radius defaults legacy materials to the old packing scale and randomizes deterministically',()=>{
  assert.equal(sanitizeMaterial({id:1}).particleRadius,.13);
  assert.equal(generateMaterial(123,1).particleRadius,generateMaterial(123,1).particleRadius);
  assert.ok(generateMaterial(123,1).particleRadius>=.065&&generateMaterial(123,1).particleRadius<=.2);
});

test('particle radius directly controls excluded volume / rest spacing',()=>{
  const ps=new ParticleSystem(4),small=material(.07,1),large=material(.20,2);
  const a=ps.add({x:0,y:0,z:0,mass:1,temperature:.5},small,Phase.LIQUID);
  const b=ps.add({x:.1,y:0,z:0,mass:1,temperature:.5},small,Phase.LIQUID);
  const c=ps.add({x:.2,y:0,z:0,mass:1,temperature:.5},large,Phase.LIQUID);
  const d=ps.add({x:.3,y:0,z:0,mass:1,temperature:.5},large,Phase.LIQUID);
  assert.ok(Math.abs(particlePairRestDistance(ps,a,b,true)-.14)<1e-5);
  assert.ok(Math.abs(particlePairRestDistance(ps,c,d,true)-.40)<1e-5);
  assert.ok(relaxedDistance(.20)>relaxedDistance(.07)+.03);
});

test('effective radius scales with particle mass so splitting mass does not create free volume',()=>{
  const ps=new ParticleSystem(2),m=material(.20);
  const whole=ps.add({x:0,y:0,z:0,mass:1,temperature:.5},m,Phase.LIQUID);
  const eighth=ps.add({x:0,y:0,z:0,mass:.125,temperature:.5},m,Phase.LIQUID);
  assert.ok(Math.abs(effectiveParticleRadius(ps,whole,false)-.20)<1e-6);
  assert.ok(Math.abs(effectiveParticleRadius(ps,eighth,false)-.10)<1e-6);
  assert.ok(Math.abs(effectiveParticleRadius(ps,eighth,true)-.20*Math.sqrt(.125))<1e-6);
});
