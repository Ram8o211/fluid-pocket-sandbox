import { Phase } from './Phase.mjs';
import { condensationCooling } from './BuoyancySolver.mjs';
import { clamp } from './math.mjs';

export function updateThermal(ps,grid,rules,env,dt){
  const count=ps.count,temp=ps.temperature,conductivity=ps.thermalConductivity,heatCapacity=ps.heatCapacity,mass=ps.mass,phase=ps.phase,gasDensity=ps.localGasDensity;
  const ambient=env.ambientTemperature,diffusion=rules.thermalDiffusionRate;
  for(let i=0;i<count;i++){
    let t=temp[i];
    if(phase[i]===Phase.GAS)t-=condensationCooling(gasDensity[i],rules.condensationDensityThreshold,rules.condensationCoolingCoefficient)*dt;
    t+=(ambient-t)*conductivity[i]*diffusion*dt*.05;temp[i]=clamp(t,0,1.2);
  }
  const x=ps.x,y=ps.y,z=ps.z,r2=.3025;
  grid.forEachPair(ps,.55,(i,j)=>{
    const dx=x[j]-x[i],dy=y[j]-y[i],dz=z[j]-z[i];if(dx*dx+dy*dy+dz*dz>r2)return;
    const d=temp[j]-temp[i],k=Math.min(conductivity[i],conductivity[j])*diffusion*dt*.025,q=d*k;
    const ca=Math.max(.1,heatCapacity[i]*mass[i]),cb=Math.max(.1,heatCapacity[j]*mass[j]);temp[i]+=q/ca;temp[j]-=q/cb;
  });
}
