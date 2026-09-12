import { clamp } from './math.mjs';

export function updateElectrical(ps,grid,rules,dt){
  const rate=Math.max(0,rules.electricalConductionRate??2.2),joule=Math.max(0,rules.jouleHeating??.025),r2=.2704;
  const x=ps.x,y=ps.y,z=ps.z,conductivity=ps.electricalConductivity,potential=ps.electricPotential,temp=ps.temperature,heatCapacity=ps.heatCapacity;
  grid.forEachPair(ps,.52,(i,j)=>{
    const dx=x[j]-x[i],dy=y[j]-y[i],dz=z[j]-z[i];if(dx*dx+dy*dy+dz*dz>r2)return;
    const c=Math.sqrt(Math.max(0,conductivity[i]*conductivity[j]));if(c<.015)return;
    const delta=potential[j]-potential[i],q=delta*c*rate*dt*.32;
    potential[i]=clamp(potential[i]+q,-1.5,1.5);potential[j]=clamp(potential[j]-q,-1.5,1.5);
    const heat=Math.abs(delta*q)*joule;if(heat<=0)return;
    temp[i]=clamp(temp[i]+heat/Math.max(.15,heatCapacity[i]),0,1.2);temp[j]=clamp(temp[j]+heat/Math.max(.15,heatCapacity[j]),0,1.2);
  });
}
