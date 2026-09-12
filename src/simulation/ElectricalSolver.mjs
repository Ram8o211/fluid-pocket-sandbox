import { clamp } from './math.mjs';

export function updateElectrical(ps,grid,rules,dt){
  const rate=Math.max(0,rules.electricalConductionRate??2.2),joule=Math.max(0,rules.jouleHeating??.025);
  for(let i=0;i<ps.count;i++) grid.forEachNeighbor(ps,i,.52,j=>{
    if(j<=i) return;
    const dx=ps.x[j]-ps.x[i],dy=ps.y[j]-ps.y[i],dz=ps.z[j]-ps.z[i];if(dx*dx+dy*dy+dz*dz>.2704)return;
    const conductivity=Math.sqrt(Math.max(0,ps.electricalConductivity[i]*ps.electricalConductivity[j]));
    if(conductivity<.015) return;
    const delta=ps.electricPotential[j]-ps.electricPotential[i],q=delta*conductivity*rate*dt*.32;
    ps.electricPotential[i]=clamp(ps.electricPotential[i]+q,-1.5,1.5);ps.electricPotential[j]=clamp(ps.electricPotential[j]-q,-1.5,1.5);
    const heat=Math.abs(delta*q)*joule;
    if(heat>0){ps.temperature[i]=clamp(ps.temperature[i]+heat/Math.max(.15,ps.heatCapacity[i]),0,1.2);ps.temperature[j]=clamp(ps.temperature[j]+heat/Math.max(.15,ps.heatCapacity[j]),0,1.2);}
  });
}
