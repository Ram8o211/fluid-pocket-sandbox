import { performance } from 'node:perf_hooks';
import { SimulationEngine } from '../src/simulation/SimulationEngine.mjs';
import { generateMaterial } from '../src/materials/MaterialGenerator.mjs';

function fill(sim,m,count){
  const b=sim.env.box,hx=b.width*.42,hy=b.height*.42,hz=b.depth*.42;
  for(let i=0;i<count;i++){
    const u=((i*73)%997)/996,v=((i*193)%991)/990,w=((i*389)%983)/982;
    sim.ps.add({x:(u*2-1)*hx,y:(v*2-1)*hy,z:sim.env.dimensionMode==='2D'?0:(w*2-1)*hz,temperature:.4},m);
  }
}
async function bench(count,mode='3D'){
  const sim=new SimulationEngine(Math.max(6200,count+16));sim.setDimensionMode(mode);const m=generateMaterial(77,1);m.combustionTemperature=1.4;sim.registerMaterial(m);fill(sim,m,count);
  for(let i=0;i<6;i++)sim.step(1/40);const iterations=count>=4500?10:16,t=performance.now();for(let i=0;i<iterations;i++)sim.step(1/40);const ms=(performance.now()-t)/iterations;
  console.log(`${mode} ${count} particles [${sim.performance.tier}]: ${ms.toFixed(2)} ms/sim-step`);
}
for(const count of [500,1000,1500,3000,5000])await bench(count,'3D');
await bench(5000,'2D');
