import { Phase } from './Phase.mjs';
import { condensationCooling } from './BuoyancySolver.mjs';
import { clamp } from './math.mjs';

export function thermalConductionFraction(conductivityA,conductivityB,rate,dt){
  const a=Math.max(0,conductivityA),b=Math.max(0,conductivityB);
  if(a<=0||b<=0||rate<=0||dt<=0)return 0;
  const interfaceConductivity=2*a*b/Math.max(1e-6,a+b);
  return clamp(1-Math.exp(-interfaceConductivity*rate*dt*12),0,1);
}

export function updateThermal(ps,grid,rules,env,dt){
  const count=ps.count,temp=ps.temperature,conductivity=ps.thermalConductivity,heatCapacity=ps.heatCapacity,mass=ps.mass,phase=ps.phase,gasDensity=ps.localGasDensity;
  const ambient=env.ambientTemperature,diffusion=Math.max(0,rules.thermalDiffusionRate??.7);
  for(let i=0;i<count;i++){
    let t=temp[i];
    if(phase[i]===Phase.GAS)t-=condensationCooling(gasDensity[i],rules.condensationDensityThreshold,rules.condensationCoolingCoefficient)*dt;
    const ambientFraction=1-Math.exp(-Math.max(0,conductivity[i])*diffusion*dt*.08);t+=(ambient-t)*ambientFraction;temp[i]=clamp(t,0,1.2);
  }
  const x=ps.x,y=ps.y,z=ps.z,r2=.3025;
  grid.forEachPair(ps,.55,(i,j)=>{
    const dx=x[j]-x[i],dy=y[j]-y[i],dz=z[j]-z[i];if(dx*dx+dy*dy+dz*dz>r2)return;
    const f=thermalConductionFraction(conductivity[i],conductivity[j],diffusion,dt);if(f<=0)return;
    const ca=Math.max(.02,heatCapacity[i]*mass[i]),cb=Math.max(.02,heatCapacity[j]*mass[j]),eq=(temp[i]*ca+temp[j]*cb)/(ca+cb);
    temp[i]+=(eq-temp[i])*f;temp[j]+=(eq-temp[j])*f;
  });
}
