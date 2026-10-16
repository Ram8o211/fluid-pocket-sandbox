import { Phase } from './Phase.mjs';
import { clamp } from './math.mjs';
export function targetPhase(phase,temp,m){
  const h=m.phaseTransitionHysteresis;
  if(phase===Phase.SOLID && temp>m.meltingTemperature+h)return Phase.LIQUID;
  if(phase===Phase.LIQUID && temp<m.meltingTemperature-h)return Phase.SOLID;
  if(phase===Phase.LIQUID && temp>m.boilingTemperature+h)return Phase.GAS;
  if(phase===Phase.GAS && temp<m.boilingTemperature-h)return Phase.LIQUID;
  return phase;
}
export function targetPhaseAt(ps,i,rules=null,env=null){
  const phase=ps.phase[i],temperature=ps.temperature[i],boiling=ps.boilingTemperature[i]-ps.phaseHysteresis[i];
  const desired=targetPhase(phase,temperature,{meltingTemperature:ps.meltingTemperature[i],boilingTemperature:ps.boilingTemperature[i],phaseTransitionHysteresis:ps.phaseHysteresis[i]});
  if(phase===Phase.GAS&&desired===Phase.LIQUID&&rules?.densityDrivenCondensation){
    // Approximate saturation falls as the patch cools. Dense patches condense
    // first; at room temperature even a tiny isolated remainder can return to
    // liquid. Temperature remains a hard gate, including in a crowded hot pot.
    const room=env?.ambientTemperature??.33;
    const saturation=Math.max(0,rules.condensationDensityThreshold)*clamp((temperature-room)/Math.max(.001,boiling-room),0,1);
    if(ps.localGasDensity[i]<saturation)return phase;
  }
  return desired;
}
export function updatePhaseParticle(ps,i,dt,rules=null,env=null,deferFreezing=false){
  const from=ps.phase[i],desired=targetPhaseAt(ps,i,rules,env);
  if(desired===from||(ps.phaseTarget[i]>=0&&ps.phaseTarget[i]!==desired&&ps.phaseProgress[i]>0)){
    ps.phaseProgress[i]=Math.max(0,ps.phaseProgress[i]-dt*2);
    if(ps.phaseProgress[i]===0)ps.phaseTarget[i]=-1;
    return false;
  }
  // Boiling work cannot be reused as freezing work after a heat reversal.
  // A missing direction in an old save is inferred without losing its progress.
  ps.phaseTarget[i]=desired;
  // Fixed parcel nucleation times spread a uniform-temperature front without
  // frame-rate-dependent randomness or a whole-batch membership switch.
  const seed=((Math.imul(i+1,2654435761)>>>0)/4294967296);
  const stagger=1+Math.max(0,rules?.phaseTransitionStagger??ps.phaseTransitionStagger??0)*seed;
  const speed=(.65+ps.volatility[i]*1.4)/stagger*(from===Phase.LIQUID&&desired===Phase.GAS?Math.max(.01,rules?.evaporationRate??1):1); ps.phaseProgress[i]=clamp(ps.phaseProgress[i]+dt*speed,0,1);
  if(ps.phaseProgress[i]>=1){
    // Phase changes preserve bulk momentum. Crystallinity, viscosity and solid
    // subdivision affect internal/contact dynamics, never gravitational fall speed.
    if(deferFreezing&&from===Phase.LIQUID&&desired===Phase.SOLID)return false;
    ps.setPhase(i,desired);return {from,to:desired,index:i};
  }return false;
}

/** Continuous optical weights, independent of the discrete solver handoff.
 * The final frame of one phase is the first frame of the next. */
export function phaseAppearance(ps,i,out){
  const phase=ps.phase[i];
  let desired=phase,progress=0;
  if(ps.phaseProgress[i]>0){
    const saved=ps.phaseTarget?.[i],target=saved>=0?saved:targetPhaseAt(ps,i);
    if(target!==phase){
      desired=target;progress=ps.phaseProgress[i];
    }
  }
  if(phase===Phase.SOLID&&ps.solidSubdivision[i]>=.55&&ps.dissolutionProgress[i]>progress){
    desired=Phase.LIQUID;progress=ps.dissolutionProgress[i];
  }
  const blend=progress*progress*(3-2*progress);
  out.solid=(phase===Phase.SOLID?1-blend:0)+(desired===Phase.SOLID?blend:0);
  out.liquid=(phase===Phase.LIQUID?1-blend:0)+(desired===Phase.LIQUID?blend:0);
  out.gas=(phase===Phase.GAS?1-blend:0)+(desired===Phase.GAS?blend:0);
  return out;
}
