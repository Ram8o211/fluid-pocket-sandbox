import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/SimulationEngine.mjs';
import { sanitizeMaterial } from '../src/materials/MaterialDefinition.mjs';
import { deriveCombustionProducts } from '../src/simulation/CombustionSolver.mjs';
import { Phase } from '../src/simulation/Phase.mjs';

function material(overrides={}){
  return sanitizeMaterial({id:1,seed:123,name:'Test matter',color:'#aa6633',opacity:.8,density:1,viscosity:.25,cohesion:.4,miscibility:.5,heatCapacity:.6,thermalConductivity:.5,meltingTemperature:.55,boilingTemperature:.9,phaseTransitionHysteresis:.02,volatility:.7,reactionPotential:.3,reactionHeat:.4,compressibility:.5,crystallinity:.8,solidSubdivision:.1,electricalConductivity:.75,electricPotential:.6,combustionTemperature:.3,...overrides});
}

test('temperature is scene state and legacy preset temperature is removed',()=>{
  const m=sanitizeMaterial({...material(),temperature:.99});
  assert.equal('temperature' in m,false);
});

test('ambient placement chooses the initial thermodynamic phase',()=>{
  const sim=new SimulationEngine(32),m=material({meltingTemperature:.6,boilingTemperature:.95});
  sim.registerMaterial(m);sim.env.ambientTemperature=.2;sim.emit(m.id,{x:0,y:0,z:0},1);
  assert.equal(sim.ps.phase[0],Phase.SOLID);
  sim.reset();sim.registerMaterial(m);sim.env.ambientTemperature=.75;sim.emit(m.id,{x:0,y:0,z:0},1);
  assert.equal(sim.ps.phase[0],Phase.LIQUID);
  sim.reset();sim.registerMaterial(m);sim.env.ambientTemperature=1.05;sim.emit(m.id,{x:0,y:0,z:0},1);
  assert.equal(sim.ps.phase[0],Phase.GAS);
});

test('solid subdivision separates rigid bodies from granular solids and melting consolidates grains',()=>{
  const rigidSim=new SimulationEngine(32),rigid=material({solidSubdivision:.1});rigidSim.registerMaterial(rigid);rigidSim.env.ambientTemperature=.2;rigidSim.emit(rigid.id,{x:0,y:0,z:0},1);assert.ok(rigidSim.ps.solidBodyId[0]>0);
  const sandSim=new SimulationEngine(32),sand=material({solidSubdivision:.9});sandSim.registerMaterial(sand);sandSim.env.ambientTemperature=.2;sandSim.emit(sand.id,{x:0,y:0,z:0},1);assert.equal(sandSim.ps.solidBodyId[0],0);sandSim.solid.onMelt(sandSim.ps,0);assert.ok(sandSim.ps.solidSubdivision[0]<=.08);
});

test('combustion products are deterministic, distinct, and preserve unit mass fractions',()=>{
  const m=material({combustionTemperature:.22});let id=100;const a=deriveCombustionProducts(m,()=>id++);id=100;const b=deriveCombustionProducts(m,()=>id++);
  assert.ok(a.length===2||a.length===3);assert.equal(a.length,b.length);assert.ok(Math.abs(a.reduce((s,p)=>s+p.fraction,0)-1)<1e-12);assert.deepEqual(a.map(p=>[p.material.name,p.material.color,p.fraction]),b.map(p=>[p.material.name,p.material.color,p.fraction]));assert.ok(new Set(a.map(p=>p.material.color)).size>1);
});

test('combustion in the simulation preserves total particle mass',()=>{
  const sim=new SimulationEngine(64),m=material({meltingTemperature:.15,boilingTemperature:1.0,combustionTemperature:.1,volatility:1});sim.registerMaterial(m);sim.env.ambientTemperature=.65;sim.emit(m.id,{x:0,y:0,z:0},1);const before=sim.ps.mass[0];for(let i=0;i<120&&sim.ps.count===1;i++)sim.step(1/40);assert.ok(sim.ps.count>=2&&sim.ps.count<=3);let after=0;for(let i=0;i<sim.ps.count;i++)after+=sim.ps.mass[i];assert.ok(Math.abs(after-before)<1e-5);
});

test('2D workspace can expand to 60 by 60 while remaining planar',()=>{
  const sim=new SimulationEngine(32);sim.setDimensionMode('2D');sim.resizeBox(60,60,18);assert.equal(sim.env.box.width,60);assert.equal(sim.env.box.height,60);const m=material();sim.registerMaterial(m);sim.emit(m.id,{x:5,y:5,z:7},1,.7);assert.equal(sim.ps.z[0],0);assert.equal(sim.ps.vz[0],0);
});
