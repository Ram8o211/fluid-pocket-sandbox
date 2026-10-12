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
export function updatePhaseParticle(ps,i,dt,rules=null,env=null){
  const from=ps.phase[i],desired=targetPhaseAt(ps,i,rules,env);if(desired===from){ps.phaseProgress[i]=Math.max(0,ps.phaseProgress[i]-dt*2);return false;}
  const speed=.65+ps.volatility[i]*1.4; ps.phaseProgress[i]=clamp(ps.phaseProgress[i]+dt*speed,0,1);
  if(ps.phaseProgress[i]>=1){
    // Phase changes preserve bulk momentum. Crystallinity, viscosity and solid
    // subdivision affect internal/contact dynamics, never gravitational fall speed.
    ps.setPhase(i,desired);return {from,to:desired,index:i};
  }return false;
}
