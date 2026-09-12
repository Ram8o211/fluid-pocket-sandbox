import test from 'node:test';import assert from 'node:assert/strict';
import { gasBuoyancyAcceleration, condensationCooling } from '../src/simulation/BuoyancySolver.mjs';import { stratificationImpulse } from '../src/simulation/DensityStratification.mjs';import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';import { SpatialGrid } from '../src/simulation/SpatialGrid.mjs';import { SimulationEngine } from '../src/simulation/SimulationEngine.mjs';import { generateMaterial } from '../src/materials/MaterialGenerator.mjs';import { Phase } from '../src/simulation/Phase.mjs';

test('gas buoyancy is opposite gravity when gas is lighter',()=>{const a=gasBuoyancyAcceleration({x:0,y:-5,z:0},.6,.2,2);assert.ok(a.y>0);assert.ok(Math.abs(a.x)<1e-12);});
test('condensation cooling activates monotonically above threshold',()=>{assert.equal(condensationCooling(.4,.5,.8),0);assert.ok(condensationCooling(.9,.5,.8)>condensationCooling(.6,.5,.8));});
test('density stratification helper pushes denser matter along gravity',()=>{const i=stratificationImpulse(1.4,.6,{x:0,y:-1,z:0},1);assert.ok(i.y<0);});
test('spatial grid neighbor query returns nearby particles',()=>{const ps=new ParticleSystem(8),m=generateMaterial(1,1);const a=ps.add({x:0,y:0,z:0},m),b=ps.add({x:.2,y:0,z:0},m),c=ps.add({x:2,y:0,z:0},m);const g=new SpatialGrid(8);const box={width:5,height:5,depth:5};g.rebuild(ps,box);const near=g.neighborsArray(ps,a,.5,[]);assert.ok(near.includes(b));assert.ok(!near.includes(c));});
test('box resize clamps particles inside domain',()=>{const sim=new SimulationEngine(16),m=generateMaterial(1,1);sim.registerMaterial(m);sim.emit(1,{x:2.4,y:2.4,z:2.4},4);sim.resizeBox(3,3,3);for(let i=0;i<sim.ps.count;i++){assert.ok(Math.abs(sim.ps.x[i])<=1.5);assert.ok(Math.abs(sim.ps.y[i])<=1.5);assert.ok(Math.abs(sim.ps.z[i])<=1.5);}});
test('stress simulation stays finite',()=>{const sim=new SimulationEngine(700);const a=generateMaterial(11,1),b=generateMaterial(12,2);a.miscibility=.5;b.miscibility=.51;sim.registerMaterial(a);sim.registerMaterial(b);for(let k=0;k<10;k++){sim.emit(1,{x:-1+(k%5)*.18,y:1,z:0},25,.8);sim.emit(2,{x:.1+(k%5)*.18,y:1,z:0},25,.15);}for(let s=0;s<120;s++)sim.step(1/40);for(let i=0;i<sim.ps.count;i++)for(const key of ['x','y','z','vx','vy','vz','temperature','density'])assert.ok(Number.isFinite(sim.ps[key][i]),`${key}[${i}] finite`);});
test('causal thermal phase-buoyancy-condensation chain is mechanically consistent',()=>{const sim=new SimulationEngine(120);const m=generateMaterial(99,1);Object.assign(m,{density:1.2,temperature:.92,boilingTemperature:.52,meltingTemperature:.12,phaseTransitionHysteresis:.01,volatility:1,compressibility:.9,thermalConductivity:.9});sim.registerMaterial(m);sim.rules.condensationDensityThreshold=.2;sim.rules.condensationCoolingCoefficient=2.0;sim.env.ambientTemperature=.05;sim.emit(1,{x:0,y:-1,z:0},60,.92);for(let k=0;k<30;k++)sim.step(1/30);assert.ok(sim.ps.phaseCounts()[Phase.GAS]>0,'boils into gas');let upward=false;for(let i=0;i<sim.ps.count;i++)if(sim.ps.phase[i]===Phase.GAS&&sim.ps.vy[i]>0)upward=true;assert.ok(upward,'gas receives upward motion');for(let k=0;k<240;k++)sim.step(1/30);assert.ok(sim.ps.phaseCounts()[Phase.LIQUID]>0,'gas cools and recondenses');let liquidDense=false;for(let i=0;i<sim.ps.count;i++)if(sim.ps.phase[i]===Phase.LIQUID&&sim.ps.density[i]>sim.env.environmentDensity)liquidDense=true;assert.ok(liquidDense,'condensed liquid is denser than environment');});

test('mixing is contact-local and does not mutate remote same-material particles',()=>{
  const sim=new SimulationEngine(16);const a=generateMaterial(501,1),b=generateMaterial(502,2);
  Object.assign(a,{miscibility:.50,density:1.5,viscosity:.95,color:'#ff2020'});Object.assign(b,{miscibility:.51,density:.55,viscosity:.05,color:'#2040ff'});
  sim.registerMaterial(a);sim.registerMaterial(b);
  const i=sim.ps.add({x:0,y:0,z:0},a),j=sim.ps.add({x:.18,y:0,z:0},b),remote=sim.ps.add({x:2,y:0,z:0},a);
  const remoteViscosity=sim.ps.viscosity[remote],beforeI=sim.ps.viscosity[i],beforeJ=sim.ps.viscosity[j];
  sim.grid.rebuild(sim.ps,sim.env.box);sim.reactions.step(sim.ps,sim.grid,sim.rules,1/30);
  assert.ok(sim.ps.viscosity[i]<beforeI);assert.ok(sim.ps.viscosity[j]>beforeJ);assert.equal(sim.ps.viscosity[remote],remoteViscosity);
});

test('causal chain reaches locally dense gas before condensation',()=>{
  const sim=new SimulationEngine(140);const m=generateMaterial(777,1);Object.assign(m,{density:1.15,temperature:.95,boilingTemperature:.5,meltingTemperature:.1,phaseTransitionHysteresis:.01,volatility:1,compressibility:.9,thermalConductivity:.8});sim.registerMaterial(m);
  sim.rules.condensationDensityThreshold=.32;sim.rules.condensationCoolingCoefficient=1.4;sim.env.ambientTemperature=.08;sim.emit(1,{x:0,y:-1,z:0},100,.95);
  let maxLocal=0;for(let k=0;k<180;k++){sim.step(1/30);for(let i=0;i<sim.ps.count;i++)maxLocal=Math.max(maxLocal,sim.ps.localGasDensity[i]);}
  assert.ok(maxLocal>sim.rules.condensationDensityThreshold,`local gas density ${maxLocal} crossed threshold`);
  assert.ok(condensationCooling(maxLocal,sim.rules.condensationDensityThreshold,sim.rules.condensationCoolingCoefficient)>0);
});

test('eraser removes only particles inside its local sphere',()=>{
  const sim=new SimulationEngine(12),m=generateMaterial(888,1);sim.registerMaterial(m);
  sim.ps.add({x:0,y:0,z:0},m);sim.ps.add({x:.2,y:0,z:0},m);sim.ps.add({x:2,y:0,z:0},m);
  const removed=sim.erase({x:0,y:0,z:0},.4);
  assert.equal(removed,2);assert.equal(sim.ps.count,1);assert.ok(Math.abs(sim.ps.x[0]-2)<1e-6);
});
