import { clamp, saturate } from '../simulation/math.mjs';
import { isCoherentSolid, isPowder } from '../simulation/PowderSolver.mjs';
import { effectiveParticleRadius } from '../simulation/FluidSolver.mjs';
import { Phase } from '../simulation/Phase.mjs';
import { EFFECT_PROPERTIES } from '../materials/MaterialDefinition.mjs';
import { warmedMiscibility } from '../simulation/ArcaneSolver.mjs';
import { MIX_PROPERTIES } from './MixtureSolver.mjs';

const PAIR_PROPERTIES = Object.freeze(MIX_PROPERTIES.filter(key => key !== 'solidSubdivision' && key !== 'phaseHysteresis'));

export function thermalMixingMultiplier(ps, i, j, coefficient = 0) {
  if (ps.phase[i] !== Phase.LIQUID || ps.phase[j] !== Phase.LIQUID) return 1;
  const warmth = Math.max(0, (ps.temperature[i] + ps.temperature[j]) * .5 - .33);
  return Math.exp(clamp(warmth * coefficient, 0, 1.4));
}

export class ReactionEngine {
  /** @type {import('./MixtureSolver.mjs').MixtureSolver | null} */
  mixtures = null;
  constructor(){this.activeReactions=0;this.maxEvents=64;this.eventCount=0;this.eventX=new Float32Array(this.maxEvents);this.eventY=new Float32Array(this.maxEvents);this.eventZ=new Float32Array(this.maxEvents);this.eventIntensity=new Float32Array(this.maxEvents);this.eventThermal=new Float32Array(this.maxEvents);this.radii=new Float32Array(0);}
  clearFrame(){this.eventCount=0;this.activeReactions=0;}
  pushEvent(x,y,z,intensity,thermal=0){if(this.eventCount>=this.maxEvents)return;const i=this.eventCount++;this.eventX[i]=x;this.eventY[i]=y;this.eventZ[i]=z;this.eventIntensity[i]=intensity;this.eventThermal[i]=thermal;}
  step(ps,grid,rules,dt,onFuse=null){
    this.clearFrame();const radius=.5*clamp(rules.interactionRadiusScale??1,.4,1),r2=radius*radius,x=ps.x,y=ps.y,z=ps.z,materialId=ps.materialId;
    this.mixtures?.beginFrame(ps);
    const thermalThreshold=clamp(rules.thermalReactionThreshold??.72,0,1.95),thermalStrength=Math.max(0,rules.thermalReactionStrength??1.15);
    let searchRadius=radius;
    if(this.mixtures){
      if(this.radii.length<ps.capacity)this.radii=new Float32Array(ps.capacity);
      let maxRadius=0,gas=false,minPotential=Infinity,maxPotential=-Infinity,minTemperature=Infinity,maxTemperature=-Infinity;
      for(let i=0;i<ps.count;i++){
        // Native water contacts a solid at its actual pressure radius. Using
        // the smaller display/grain radius leaves an invisible chemistry gap:
        // touching, stirred powder could never hydrate or infuse the water.
        this.radii[i]=grid.dimensionMode==='2D'&&ps.phase[i]===Phase.LIQUID&&ps.nativeLiquidRadius>0?ps.nativeLiquidRadius:effectiveParticleRadius(ps,i,grid.dimensionMode==='2D');maxRadius=Math.max(maxRadius,this.radii[i]);gas=gas||ps.phase[i]===Phase.GAS;
        minPotential=Math.min(minPotential,ps.reactionPotential[i]);maxPotential=Math.max(maxPotential,ps.reactionPotential[i]);
        minTemperature=Math.min(minTemperature,ps.temperature[i]);maxTemperature=Math.max(maxTemperature,ps.temperature[i]);
      }
      // Only pigment/solubility work needs the fine contact neighbourhood in
      // an ordinary batch. Keep the full reach whenever heat shock, opposed
      // potentials or gas can actually use that larger radius.
      if(!gas&&maxPotential-minPotential<=thermalThreshold&&maxTemperature-minTemperature<=.35)searchRadius=Math.min(radius,Math.max(.07*(ps.packingScale??1)*1.6,maxRadius*3.2));
    }
    grid.forEachPair(ps,searchRadius,(i,j)=>{
      if(materialId[i]===materialId[j] && !this.mixtures)return;
      const dx=x[j]-x[i],dy=y[j]-y[i],dz=z[j]-z[i],d2=dx*dx+dy*dy+dz*dz;if(d2>r2)return;
      const distance=Math.sqrt(d2),contact=saturate(1-distance/radius),potentialDelta=Math.abs(ps.reactionPotential[i]-ps.reactionPotential[j]);
      const scale=ps.packingScale??1;
      let mixingReach=!this.mixtures||ps.phase[i]===Phase.GAS||ps.phase[j]===Phase.GAS?radius:Math.min(radius,clamp(this.radii[i]+this.radii[j],.07*scale,.44*scale)*(isPowder(ps,i)||isPowder(ps,j)?1.12:1.6));
      // LiquidFun's particle/body kernel reaches one particle DIAMETER from
      // the fixture surface. Stable native contact can therefore lie beyond
      // the sum of the drawn radii, especially for light floating powders.
      if(this.mixtures&&ps.nativeLiquidRadius>0){
        const solid=isPowder(ps,i)&&ps.phase[j]===Phase.LIQUID?i:isPowder(ps,j)&&ps.phase[i]===Phase.LIQUID?j:-1;
        if(solid>=0)mixingReach=Math.max(mixingReach,Math.min(radius,this.radii[solid]+ps.nativeLiquidRadius*2+.005));
      }
      const mixingContact=distance<=mixingReach?contact:0;
      const mixtureCompatibility=this.mixtures ? (rules.baseMixingRate>0&&mixingContact>0 ? this.mixtures.contact(ps,i,j,mixingContact,rules.miscibilityThreshold,dt,rules) : 0) : undefined;
      if(materialId[i]===materialId[j]||isCoherentSolid(ps,i)||isCoherentSolid(ps,j))return;
      let reacted=false,thermalEvent=0,visual=0;
      if(potentialDelta>thermalThreshold){
        const excess=saturate((potentialDelta-thermalThreshold)/Math.max(.05,2-thermalThreshold)),heatBias=clamp((ps.reactionHeat[i]+ps.reactionHeat[j])*.5,-1,1),energy=heatBias*excess*contact*thermalStrength*dt*.18;
        if(Math.abs(energy)>1e-6){ps.temperature[i]=clamp(ps.temperature[i]+energy/Math.max(.15,ps.heatCapacity[i]),0,1.2);ps.temperature[j]=clamp(ps.temperature[j]+energy/Math.max(.15,ps.heatCapacity[j]),0,1.2);thermalEvent=Math.sign(energy)*Math.min(1,Math.abs(energy)*24);}
        const consume=clamp(excess*contact*dt*(rules.reactionStrength??1)*.42,0,.12),mean=(ps.reactionPotential[i]+ps.reactionPotential[j])*.5;
        ps.reactionPotential[i]+=(mean-ps.reactionPotential[i])*consume;ps.reactionPotential[j]+=(mean-ps.reactionPotential[j])*consume;visual=Math.max(visual,excess*contact);reacted=true;
      }
      const dm=Math.abs(ps.miscibility[i]-ps.miscibility[j]);
      const threshold=warmedMiscibility(ps,i,j,rules.miscibilityThreshold,rules);
      if(dm<threshold && (mixtureCompatibility===undefined || mixtureCompatibility>0)){
        const compat=mixtureCompatibility??clamp(1-dm/Math.max(.001,threshold),0,1),rate=rules.baseMixingRate*Math.pow(compat,rules.mixingExponent)*contact*thermalMixingMultiplier(ps,i,j,rules.mixingTemperatureCoefficient??0);
        if(rate>0){const propD=this.particleDistance(ps,i,j),mixVisual=saturate(compat*propD*contact*rules.reactionStrength),t=clamp(rate*dt,0,.22);this.mixPair(ps,i,j,t,rules,onFuse);visual=Math.max(visual,mixVisual);reacted=true;}
      }
      const td=Math.abs(ps.temperature[i]-ps.temperature[j]);
      if(td>.35){const imp=td*contact*rules.thermalShockStrength*.15;ps.vx[i]-=dx*imp;ps.vy[i]-=dy*imp;ps.vz[i]-=dz*imp;ps.vx[j]+=dx*imp;ps.vy[j]+=dy*imp;ps.vz[j]+=dz*imp;visual=Math.max(visual,saturate(td*contact));reacted=true;}
      if(!reacted)return;
      this.activeReactions++;if(visual>.04)this.pushEvent((x[i]+x[j])*.5,(y[i]+y[j])*.5,(z[i]+z[j])*.5,visual,thermalEvent);
    });
    this.mixtures?.finishFrame(ps,rules,dt);
  }
  particleDistance(ps,i,j){let s=0,w=0;const add=(a,b,weight=1)=>{const d=a-b;s+=d*d*weight;w+=weight;};add((ps.baseDensity[i]-.35)/1.3,(ps.baseDensity[j]-.35)/1.3);add(ps.viscosity[i],ps.viscosity[j]);add(ps.cohesion[i],ps.cohesion[j]);add((ps.particleRadius[i]-.065)/.135,(ps.particleRadius[j]-.065)/.135,.7);add(ps.incompressible[i],ps.incompressible[j],.45);add(ps.opacity[i],ps.opacity[j]);add((ps.reactionPotential[i]+1)/2,(ps.reactionPotential[j]+1)/2);add((ps.reactionHeat[i]+1)/2,(ps.reactionHeat[j]+1)/2);add(ps.crystallinity[i],ps.crystallinity[j],.5);add(ps.solidSubdivision[i],ps.solidSubdivision[j],.5);add(ps.electricalConductivity[i],ps.electricalConductivity[j],.35);add(ps.combustionTemperature[i]/1.4,ps.combustionTemperature[j]/1.4,.45);add(ps.r[i],ps.r[j],.45);add(ps.g[i],ps.g[j],.45);add(ps.b[i],ps.b[j],.45);for(const key of EFFECT_PROPERTIES){if(ps[key][i]===0&&ps[key][j]===0)continue;const d=ps[key][i]-ps[key][j];s+=d*d*.65;w+=.65;}return saturate(Math.sqrt(s/Math.max(w,1))*1.9);}
  mixPair(ps,i,j,t,rules,onFuse=null){
    const mi=ps.mass[i],mj=ps.mass[j],total=Math.max(1e-6,mi+mj),wi=mi/total,wj=mj/total;
    const blend=(arr)=>{const mean=arr[i]*wi+arr[j]*wj;arr[i]+=(mean-arr[i])*t;arr[j]+=(mean-arr[j])*t;};
    if(!this.mixtures){
      for(const key of PAIR_PROPERTIES)blend(ps[key]);
      if(ps.phase[i]!==Phase.SOLID&&ps.phase[j]!==Phase.SOLID)blend(ps.solidSubdivision);
    }
    ps.density[i]=ps.effectiveDensityAt(i);ps.density[j]=ps.effectiveDensityAt(j);
    if(this.particleDistance(ps,i,j)<rules.canonicalizationDistance){const a=ps.materialId[i],b=ps.materialId[j],fused=onFuse?.(ps,i,j,a,b);const id=Number.isFinite(fused)&&fused>0?fused:Math.min(a,b);ps.materialId[i]=id;ps.materialId[j]=id;}
  }
}

