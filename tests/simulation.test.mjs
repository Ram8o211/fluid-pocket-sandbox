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

test('completed miscible fusion creates a new emergent material identity',()=>{
  const sim=new SimulationEngine(12),a=generateMaterial(901,1),b=generateMaterial(902,2);Object.assign(a,{miscibility:.5,density:1,viscosity:.5,color:'#ff0000'});Object.assign(b,{miscibility:.51,density:1.01,viscosity:.51,color:'#fe0100'});sim.registerMaterial(a);sim.registerMaterial(b);sim.rules.canonicalizationDistance=1;
  const i=sim.ps.add({x:0,y:0,z:0},a),j=sim.ps.add({x:.1,y:0,z:0},b);sim.grid.rebuild(sim.ps,sim.env.box);sim.reactions.step(sim.ps,sim.grid,sim.rules,1/30,(ps,pi,pj,ai,bi)=>sim.resolveFusion(ps,pi,pj,ai,bi));
  assert.equal(sim.ps.materialId[i],sim.ps.materialId[j]);assert.notEqual(sim.ps.materialId[i],1);assert.notEqual(sim.ps.materialId[i],2);const mixed=sim.materials.get(sim.ps.materialId[i]);assert.equal(mixed.emergent,true);assert.equal(mixed.reusable,false);assert.deepEqual(mixed.sourceMaterialIds,[1,2]);
});

test('same ingredient lineage reuses emergent identity instead of exploding material count',()=>{
  const sim=new SimulationEngine(12),a=generateMaterial(903,1),b=generateMaterial(904,2);sim.registerMaterial(a);sim.registerMaterial(b);const i=sim.ps.add({x:0,y:0,z:0},a),j=sim.ps.add({x:.1,y:0,z:0},b),k=sim.ps.add({x:.2,y:0,z:0},a);const ab=sim.resolveFusion(sim.ps,i,j,1,2);sim.ps.materialId[i]=ab;const again=sim.resolveFusion(sim.ps,i,k,ab,1);assert.equal(again,ab);assert.equal(sim.stats.generatedMaterials,1);
});

test('freezing beside a wall cannot pump a solid cluster upward',()=>{
  const sim=new SimulationEngine(220),m=generateMaterial(990,1);
  Object.assign(m,{density:1.1,temperature:.5,meltingTemperature:.3,boilingTemperature:.9,phaseTransitionHysteresis:.01,volatility:.2,cohesion:.9,viscosity:.2});
  sim.registerMaterial(m);
  sim.emit(1,{x:sim.env.box.width/2-.15,y:0,z:0},80,.5,1.5);
  for(let k=0;k<60;k++)sim.step(1/40);
  let startCom=0;for(let i=0;i<sim.ps.count;i++){startCom+=sim.ps.y[i];sim.ps.temperature[i]=.05;}startCom/=sim.ps.count;
  let maxCom=-Infinity;
  for(let k=0;k<160;k++){sim.step(1/40);let com=0;for(let i=0;i<sim.ps.count;i++)com+=sim.ps.y[i];com/=sim.ps.count;maxCom=Math.max(maxCom,com);}
  assert.equal(sim.ps.phaseCounts()[Phase.SOLID],sim.ps.count,'cluster completes freezing');
  assert.ok(maxCom<startCom+.55,`solid wall contact must not ratchet upward: start=${startCom}, max=${maxCom}`);
});


test('heat and cool tools change only local particle temperature and report affected particles',()=>{
  const sim=new SimulationEngine(12),m=generateMaterial(991,1);sim.registerMaterial(m);
  const near=sim.ps.add({x:0,y:0,z:0,temperature:.5},m),far=sim.ps.add({x:2.5,y:0,z:0,temperature:.5},m);
  const heated=sim.applyHeat({x:0,y:0,z:0},.8,.2);
  assert.equal(heated.affected,1);assert.ok(heated.totalDelta>0);assert.ok(sim.ps.temperature[near]>.5);assert.ok(Math.abs(sim.ps.temperature[far]-.5)<1e-6);
  const before=sim.ps.temperature[near],cooled=sim.applyHeat({x:0,y:0,z:0},.8,-.25);
  assert.equal(cooled.affected,1);assert.ok(cooled.totalDelta<0);assert.ok(sim.ps.temperature[near]<before);assert.ok(Math.abs(sim.ps.temperature[far]-.5)<1e-6);
});

test('2D mode flattens particles, gravity and spatial grid to one plane',()=>{
  const sim=new SimulationEngine(64),m=generateMaterial(1201,1);sim.registerMaterial(m);sim.setDimensionMode('2D');
  sim.setGravity(.4,-.8,.7);assert.equal(sim.gravity.z,0);assert.equal(sim.grid.dimensionMode,'2D');
  sim.emit(1,{x:0,y:.8,z:2},30,.5,1.2);assert.equal(sim.grid.nz,1);
  let distinctY=false;for(let i=0;i<sim.ps.count;i++){assert.equal(sim.ps.z[i],0);if(Math.abs(sim.ps.y[i]-.8)>.05)distinctY=true;}
  assert.ok(distinctY,'2D emitter spreads matter across the visible plane');
  for(let k=0;k<25;k++)sim.step(1/40);
  for(let i=0;i<sim.ps.count;i++){assert.equal(sim.ps.z[i],0);assert.equal(sim.ps.vz[i],0);}
  assert.equal(sim.grid.nz,1,'2D neighbor grid keeps a single z layer');
});

test('switching from 3D to 2D removes existing depth momentum deterministically',()=>{
  const sim=new SimulationEngine(8),m=generateMaterial(1202,1);sim.registerMaterial(m);const i=sim.ps.add({x:0,y:0,z:1.7,vz:3},m);sim.setDimensionMode('2D');assert.equal(sim.ps.z[i],0);assert.equal(sim.ps.pz[i],0);assert.equal(sim.ps.vz[i],0);sim.setDimensionMode('3D');assert.equal(sim.env.dimensionMode,'3D');assert.equal(sim.grid.dimensionMode,'3D');
});
