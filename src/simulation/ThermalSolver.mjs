import { Phase } from './Phase.mjs';
import { condensationCooling } from './BuoyancySolver.mjs';
import { clamp } from './math.mjs';
export function updateThermal(ps,grid,rules,env,dt){
  for(let i=0;i<ps.count;i++){
    if(ps.phase[i]===Phase.GAS){ const cool=condensationCooling(ps.localGasDensity[i],rules.condensationDensityThreshold,rules.condensationCoolingCoefficient); ps.temperature[i]-=cool*dt; }
    ps.temperature[i]+=(env.ambientTemperature-ps.temperature[i])*ps.thermalConductivity[i]*rules.thermalDiffusionRate*dt*.05;
    ps.temperature[i]=clamp(ps.temperature[i],0,1.2);
  }
  for(let i=0;i<ps.count;i++) grid.forEachNeighbor(ps,i,.55,(j)=>{ if(j<=i)return; const dx=ps.x[j]-ps.x[i],dy=ps.y[j]-ps.y[i],dz=ps.z[j]-ps.z[i];if(dx*dx+dy*dy+dz*dz>.3025)return;
    const d=ps.temperature[j]-ps.temperature[i],k=Math.min(ps.thermalConductivity[i],ps.thermalConductivity[j])*rules.thermalDiffusionRate*dt*.025,q=d*k;
    const ca=Math.max(.1,ps.heatCapacity[i]*ps.mass[i]),cb=Math.max(.1,ps.heatCapacity[j]*ps.mass[j]);ps.temperature[i]+=q/ca;ps.temperature[j]-=q/cb;
  });
}
