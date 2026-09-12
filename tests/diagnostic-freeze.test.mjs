import test from 'node:test';
import { SimulationEngine } from '../src/simulation/SimulationEngine.mjs';
import { generateMaterial } from '../src/materials/MaterialGenerator.mjs';
import { Phase } from '../src/simulation/Phase.mjs';

test('diagnostic freeze wall trajectory',()=>{
  const sim=new SimulationEngine(220),m=generateMaterial(990,1);
  Object.assign(m,{density:1.1,temperature:.5,meltingTemperature:.3,boilingTemperature:.9,phaseTransitionHysteresis:.01,volatility:.2,cohesion:.9,viscosity:.2});
  sim.registerMaterial(m);sim.emit(1,{x:sim.env.box.width/2-.15,y:0,z:0},80,.5,1.5);
  for(let k=0;k<60;k++)sim.step(1/40);
  for(let i=0;i<sim.ps.count;i++)sim.ps.temperature[i]=.05;
  const report=(k)=>{let com=0,vy=0,prog=0,min=Infinity,max=-Infinity;for(let i=0;i<sim.ps.count;i++){com+=sim.ps.y[i];vy+=sim.ps.vy[i];prog+=sim.ps.phaseProgress[i];min=Math.min(min,sim.ps.y[i]);max=Math.max(max,sim.ps.y[i]);}const c=sim.ps.phaseCounts();console.log(`FREEZE_DIAG k=${k} com=${(com/sim.ps.count).toFixed(4)} y=[${min.toFixed(3)},${max.toFixed(3)}] vy=${(vy/sim.ps.count).toFixed(4)} prog=${(prog/sim.ps.count).toFixed(3)} phases=${c[Phase.LIQUID]||0}/${c[Phase.SOLID]||0}/${c[Phase.GAS]||0}`);};
  report(0);for(let k=1;k<=160;k++){sim.step(1/40);if(k<=12||k%10===0)report(k);}
});
