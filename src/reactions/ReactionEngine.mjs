import { clamp, saturate } from '../simulation/math.mjs';

export class ReactionEngine {
  constructor(){this.activeReactions=0;this.maxEvents=64;this.eventCount=0;this.eventX=new Float32Array(this.maxEvents);this.eventY=new Float32Array(this.maxEvents);this.eventZ=new Float32Array(this.maxEvents);this.eventIntensity=new Float32Array(this.maxEvents);this.eventThermal=new Float32Array(this.maxEvents);}
  clearFrame(){this.eventCount=0;this.activeReactions=0;}
  pushEvent(x,y,z,intensity,thermal=0){if(this.eventCount>=this.maxEvents)return;const i=this.eventCount++;this.eventX[i]=x;this.eventY[i]=y;this.eventZ[i]=z;this.eventIntensity[i]=intensity;this.eventThermal[i]=thermal;}
  step(ps,grid,rules,dt,onFuse=null){
    this.clearFrame();const radius=.5,r2=radius*radius,x=ps.x,y=ps.y,z=ps.z,materialId=ps.materialId;
    const thermalThreshold=clamp(rules.thermalReactionThreshold??.72,0,1.95),thermalStrength=Math.max(0,rules.thermalReactionStrength??1.15);
    grid.forEachPair(ps,radius,(i,j)=>{
      if(materialId[i]===materialId[j])return;
      const dx=x[j]-x[i],dy=y[j]-y[i],dz=z[j]-z[i],d2=dx*dx+dy*dy+dz*dz;if(d2>r2)return;
      const contact=saturate(1-Math.sqrt(d2)/radius),potentialDelta=Math.abs(ps.reactionPotential[i]-ps.reactionPotential[j]);
      let reacted=false,thermalEvent=0,visual=0;
      if(potentialDelta>thermalThreshold){
        const excess=saturate((potentialDelta-thermalThreshold)/Math.max(.05,2-thermalThreshold)),heatBias=clamp((ps.reactionHeat[i]+ps.reactionHeat[j])*.5,-1,1),energy=heatBias*excess*contact*thermalStrength*dt*.18;
        if(Math.abs(energy)>1e-6){ps.temperature[i]=clamp(ps.temperature[i]+energy/Math.max(.15,ps.heatCapacity[i]),0,1.2);ps.temperature[j]=clamp(ps.temperature[j]+energy/Math.max(.15,ps.heatCapacity[j]),0,1.2);thermalEvent=Math.sign(energy)*Math.min(1,Math.abs(energy)*24);}
        const consume=clamp(excess*contact*dt*(rules.reactionStrength??1)*.42,0,.12),mean=(ps.reactionPotential[i]+ps.reactionPotential[j])*.5;
        ps.reactionPotential[i]+=(mean-ps.reactionPotential[i])*consume;ps.reactionPotential[j]+=(mean-ps.reactionPotential[j])*consume;visual=Math.max(visual,excess*contact);reacted=true;
      }
      const dm=Math.abs(ps.miscibility[i]-ps.miscibility[j]);
      if(dm<rules.miscibilityThreshold){
        const compat=clamp(1-dm/Math.max(.001,rules.miscibilityThreshold),0,1),rate=rules.baseMixingRate*Math.pow(compat,rules.mixingExponent)*contact;
        if(rate>0){const propD=this.particleDistance(ps,i,j),mixVisual=saturate(compat*propD*contact*rules.reactionStrength),t=clamp(rate*dt,0,.22);this.mixPair(ps,i,j,t,rules,onFuse);visual=Math.max(visual,mixVisual);reacted=true;}
      }
      const td=Math.abs(ps.temperature[i]-ps.temperature[j]);
      if(td>.35){const imp=td*contact*rules.thermalShockStrength*.15;ps.vx[i]-=dx*imp;ps.vy[i]-=dy*imp;ps.vz[i]-=dz*imp;ps.vx[j]+=dx*imp;ps.vy[j]+=dy*imp;ps.vz[j]+=dz*imp;visual=Math.max(visual,saturate(td*contact));reacted=true;}
      if(!reacted)return;
      this.activeReactions++;if(visual>.04)this.pushEvent((x[i]+x[j])*.5,(y[i]+y[j])*.5,(z[i]+z[j])*.5,visual,thermalEvent);
    });
  }
  particleDistance(ps,i,j){let s=0,w=0;const add=(a,b,weight=1)=>{const d=a-b;s+=d*d*weight;w+=weight;};add((ps.baseDensity[i]-.35)/1.3,(ps.baseDensity[j]-.35)/1.3);add(ps.viscosity[i],ps.viscosity[j]);add(ps.cohesion[i],ps.cohesion[j]);add((ps.particleRadius[i]-.065)/.135,(ps.particleRadius[j]-.065)/.135,.7);add(ps.incompressible[i],ps.incompressible[j],.45);add(ps.opacity[i],ps.opacity[j]);add((ps.reactionPotential[i]+1)/2,(ps.reactionPotential[j]+1)/2);add((ps.reactionHeat[i]+1)/2,(ps.reactionHeat[j]+1)/2);add(ps.crystallinity[i],ps.crystallinity[j],.5);add(ps.solidSubdivision[i],ps.solidSubdivision[j],.5);add(ps.electricalConductivity[i],ps.electricalConductivity[j],.35);add(ps.combustionTemperature[i]/1.4,ps.combustionTemperature[j]/1.4,.45);add(ps.r[i],ps.r[j],.45);add(ps.g[i],ps.g[j],.45);add(ps.b[i],ps.b[j],.45);return saturate(Math.sqrt(s/Math.max(w,1))*1.9);}
  mixPair(ps,i,j,t,rules,onFuse=null){
    const mi=ps.mass[i],mj=ps.mass[j],total=Math.max(1e-6,mi+mj),wi=mi/total,wj=mj/total;
    const blend=(arr)=>{const mean=arr[i]*wi+arr[j]*wj;arr[i]+=(mean-arr[i])*t;arr[j]+=(mean-arr[j])*t;};
    for(const arr of [ps.r,ps.g,ps.b,ps.opacity,ps.baseDensity,ps.viscosity,ps.cohesion,ps.miscibility,ps.particleRadius,ps.incompressible,ps.heatCapacity,ps.thermalConductivity,ps.meltingTemperature,ps.boilingTemperature,ps.volatility,ps.reactionPotential,ps.reactionHeat,ps.compressibility,ps.crystallinity,ps.solidSubdivision,ps.electricalConductivity,ps.combustionTemperature])blend(arr);
    ps.density[i]=ps.effectiveDensityAt(i);ps.density[j]=ps.effectiveDensityAt(j);
    if(this.particleDistance(ps,i,j)<rules.canonicalizationDistance){const a=ps.materialId[i],b=ps.materialId[j],fused=onFuse?.(ps,i,j,a,b);const id=Number.isFinite(fused)&&fused>0?fused:Math.min(a,b);ps.materialId[i]=id;ps.materialId[j]=id;}
  }
}
