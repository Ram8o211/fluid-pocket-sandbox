import { clamp, saturate } from '../simulation/math.mjs';
export class ReactionEngine {
  constructor(){this.activeReactions=0;this.maxEvents=64;this.eventCount=0;this.eventX=new Float32Array(this.maxEvents);this.eventY=new Float32Array(this.maxEvents);this.eventZ=new Float32Array(this.maxEvents);this.eventIntensity=new Float32Array(this.maxEvents);}
  clearFrame(){this.eventCount=0;this.activeReactions=0;}
  pushEvent(x,y,z,intensity){if(this.eventCount>=this.maxEvents)return;const i=this.eventCount++;this.eventX[i]=x;this.eventY[i]=y;this.eventZ[i]=z;this.eventIntensity[i]=intensity;}
  step(ps,grid,rules,dt,onFuse=null){
    this.clearFrame(); const radius=.5, r2=radius*radius;
    for(let i=0;i<ps.count;i++) grid.forEachNeighbor(ps,i,radius,(j)=>{
      if(j<=i || ps.materialId[i]===ps.materialId[j])return;
      const dx=ps.x[j]-ps.x[i],dy=ps.y[j]-ps.y[i],dz=ps.z[j]-ps.z[i],d2=dx*dx+dy*dy+dz*dz;if(d2>r2)return;
      const dm=Math.abs(ps.miscibility[i]-ps.miscibility[j]); if(dm>=rules.miscibilityThreshold)return;
      const compat=clamp(1-dm/Math.max(.001,rules.miscibilityThreshold),0,1),contact=saturate(1-Math.sqrt(d2)/radius),rate=rules.baseMixingRate*Math.pow(compat,rules.mixingExponent)*contact;if(rate<=0)return;
      const propD=this.particleDistance(ps,i,j),visual=saturate(compat*propD*contact*rules.reactionStrength),t=clamp(rate*dt,0,.22);this.mixPair(ps,i,j,t,rules,onFuse);
      const potentialDelta=Math.abs(ps.reactionPotential[i]-ps.reactionPotential[j]);if(potentialDelta>.9){const heat=Math.min(.035,potentialDelta*.012*contact*dt*rules.reactionStrength);ps.temperature[i]+=heat;ps.temperature[j]+=heat;ps.reactionPotential[i]*=(1-heat);ps.reactionPotential[j]*=(1-heat);const impulse=visual*.32;ps.vx[i]-=dx*impulse;ps.vy[i]-=dy*impulse;ps.vz[i]-=dz*impulse;ps.vx[j]+=dx*impulse;ps.vy[j]+=dy*impulse;ps.vz[j]+=dz*impulse;}
      const td=Math.abs(ps.temperature[i]-ps.temperature[j]);if(td>.35){const imp=td*contact*rules.thermalShockStrength*.15;ps.vx[i]-=dx*imp;ps.vy[i]-=dy*imp;ps.vz[i]-=dz*imp;ps.vx[j]+=dx*imp;ps.vy[j]+=dy*imp;ps.vz[j]+=dz*imp;}
      this.activeReactions++;if(visual>.05)this.pushEvent((ps.x[i]+ps.x[j])*.5,(ps.y[i]+ps.y[j])*.5,(ps.z[i]+ps.z[j])*.5,visual);
    });
  }
  particleDistance(ps,i,j){let s=0,w=0;const add=(a,b,weight=1)=>{const d=a-b;s+=d*d*weight;w+=weight;};add((ps.baseDensity[i]-.35)/1.3,(ps.baseDensity[j]-.35)/1.3);add(ps.viscosity[i],ps.viscosity[j]);add(ps.cohesion[i],ps.cohesion[j]);add(ps.temperature[i],ps.temperature[j]);add(ps.opacity[i],ps.opacity[j]);add((ps.reactionPotential[i]+1)/2,(ps.reactionPotential[j]+1)/2);add(ps.r[i],ps.r[j],.45);add(ps.g[i],ps.g[j],.45);add(ps.b[i],ps.b[j],.45);return saturate(Math.sqrt(s/Math.max(w,1))*1.9);}
  mixPair(ps,i,j,t,rules,onFuse=null){const mi=ps.mass[i],mj=ps.mass[j],total=Math.max(1e-6,mi+mj),wi=mi/total,wj=mj/total;const blend=(arr)=>{const mean=arr[i]*wi+arr[j]*wj;arr[i]+=(mean-arr[i])*t;arr[j]+=(mean-arr[j])*t;};for(const arr of [ps.r,ps.g,ps.b,ps.opacity,ps.baseDensity,ps.viscosity,ps.cohesion,ps.miscibility,ps.temperature,ps.heatCapacity,ps.thermalConductivity,ps.meltingTemperature,ps.boilingTemperature,ps.volatility,ps.reactionPotential,ps.compressibility])blend(arr);ps.density[i]=ps.effectiveDensityAt(i);ps.density[j]=ps.effectiveDensityAt(j);if(this.particleDistance(ps,i,j)<rules.canonicalizationDistance){const a=ps.materialId[i],b=ps.materialId[j],fused=onFuse?.(ps,i,j,a,b);const id=Number.isFinite(fused)&&fused>0?fused:Math.min(a,b);ps.materialId[i]=id;ps.materialId[j]=id;}}
}
