import test from 'node:test';
import assert from 'node:assert/strict';
import { updateElectrical, conductionFraction, electrostaticPairImpulse } from '../src/simulation/ElectricalSolver.mjs';
import { updateThermal, thermalConductionFraction } from '../src/simulation/ThermalSolver.mjs';
import { MoldSystem } from '../src/simulation/MoldSystem.mjs';
import { Phase } from '../src/simulation/Phase.mjs';

const pairGrid={forEachPair(_ps,_radius,cb){cb(0,1);}};
function electricalPs(a=1,b=-.2,ca=1,cb=1){return {x:new Float32Array([-.2,.2]),y:new Float32Array(2),z:new Float32Array(2),vx:new Float32Array(2),vy:new Float32Array(2),vz:new Float32Array(2),electricalConductivity:new Float32Array([ca,cb]),electricPotential:new Float32Array([a,b]),temperature:new Float32Array([.3,.3]),heatCapacity:new Float32Array([1,1]),mass:new Float32Array([1,1])};}

test('electrical conductivity controls rapid potential equilibration',()=>{
  assert.ok(conductionFraction(1,1,2.2,.025)>conductionFraction(.05,.05,2.2,.025));
  const high=electricalPs(),low=electricalPs(1,-.2,.03,.03),rules={electricalConductionRate:2.2,electrostaticStrength:0,jouleHeating:0};
  for(let k=0;k<20;k++){updateElectrical(high,pairGrid,rules,.025);updateElectrical(low,pairGrid,rules,.025);}
  const highGap=Math.abs(high.electricPotential[0]-high.electricPotential[1]),lowGap=Math.abs(low.electricPotential[0]-low.electricPotential[1]);
  assert.ok(highGap<.03,`high conductor should nearly equilibrate, gap=${highGap}`);assert.ok(lowGap>highGap*5,`low conductor should equilibrate much more slowly, gap=${lowGap}`);
  assert.ok(Math.abs(high.electricPotential[0]+high.electricPotential[1]-.8)<1e-4,'pairwise conduction preserves total potential for equal masses');
});

test('bipolar potential attracts opposite signs and repels equal signs',()=>{
  assert.ok(electrostaticPairImpulse(1,-1,.8,2.4,.025)>0);assert.ok(electrostaticPairImpulse(1,1,.8,2.4,.025)<0);
  const attract=electricalPs(1,-1),repel=electricalPs(1,1);attract.x[0]=repel.x[0]=-.4;attract.x[1]=repel.x[1]=.4;const rules={electricalConductionRate:0,electrostaticStrength:2.4,jouleHeating:0};
  updateElectrical(attract,pairGrid,rules,.025);updateElectrical(repel,pairGrid,rules,.025);
  assert.ok(attract.vx[0]>0&&attract.vx[1]<0,'opposite potentials move toward each other');assert.ok(repel.vx[0]<0&&repel.vx[1]>0,'equal-sign potentials move away from each other');
});

test('thermal conductivity controls temperature equilibration',()=>{
  assert.ok(thermalConductionFraction(1,1,1,.025)>thermalConductionFraction(.05,.05,1,.025));
  const make=k=>({count:2,temperature:new Float32Array([1,0]),thermalConductivity:new Float32Array([k,k]),heatCapacity:new Float32Array([1,1]),mass:new Float32Array([1,1]),phase:new Int32Array([Phase.LIQUID,Phase.LIQUID]),localGasDensity:new Float32Array(2),x:new Float32Array([0,.3]),y:new Float32Array(2),z:new Float32Array(2)});
  const high=make(1),low=make(.03),rules={thermalDiffusionRate:1,condensationDensityThreshold:.6,condensationCoolingCoefficient:0},env={ambientTemperature:.5};
  for(let k=0;k<20;k++){updateThermal(high,pairGrid,rules,env,.025);updateThermal(low,pairGrid,rules,env,.025);}
  const highGap=Math.abs(high.temperature[0]-high.temperature[1]),lowGap=Math.abs(low.temperature[0]-low.temperature[1]);assert.ok(highGap<.01,`high thermal conductor should equilibrate, gap=${highGap}`);assert.ok(lowGap>highGap*5,`low thermal conductor should remain less equilibrated, gap=${lowGap}`);
  assert.ok(Math.abs(high.temperature[0]+high.temperature[1]-1)<1e-4,'symmetric ambient and pair exchange preserve total thermal state here');
});

test('inert barrier brush collides with particles and eraser removes barrier cells',()=>{
  const molds=new MoldSystem(),box={width:6,height:6,depth:4};const added=molds.addBarrier({x:0,y:0,z:0},'M',box,true);assert.ok(added>0);assert.ok(molds.barriers.size>0);
  const ps={count:1,x:new Float32Array([.1]),y:new Float32Array([.03]),z:new Float32Array([0]),vx:new Float32Array([.2]),vy:new Float32Array([-.3]),vz:new Float32Array([0])};molds.collide(ps,true);assert.ok(Math.hypot(ps.x[0],ps.y[0])>.05,'barrier pushes an overlapping particle out');
  const before=molds.barriers.size,removed=molds.eraseBarrier({x:0,y:0,z:0},.8,true);assert.ok(removed>0&&molds.barriers.size<before,'eraser removes inert barrier cells');
});
