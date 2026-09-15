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
export function targetPhaseAt(ps,i){ return targetPhase(ps.phase[i],ps.temperature[i],{meltingTemperature:ps.meltingTemperature[i],boilingTemperature:ps.boilingTemperature[i],phaseTransitionHysteresis:ps.phaseHysteresis[i]}); }
export function updatePhaseParticle(ps,i,dt){
  const from=ps.phase[i],desired=targetPhaseAt(ps,i);if(desired===from){ps.phaseProgress[i]=Math.max(0,ps.phaseProgress[i]-dt*2);return false;}
  const speed=.65+ps.volatility[i]*1.4; ps.phaseProgress[i]=clamp(ps.phaseProgress[i]+dt*speed,0,1);
  if(ps.phaseProgress[i]>=1){
    // Phase changes preserve bulk momentum. Crystallinity, viscosity and solid
    // subdivision affect internal/contact dynamics, never gravitational fall speed.
    ps.setPhase(i,desired);return {from,to:desired,index:i};
  }return false;
}
