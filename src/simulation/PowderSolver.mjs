import { Phase } from './Phase.mjs';
import { clamp } from './math.mjs';
export function isCoherentSolid(ps,i){return ps.phase[i]===Phase.SOLID&&ps.solidSubdivision[i]<.55;}
export function isPowder(ps,i){return ps.phase[i]===Phase.SOLID&&ps.solidSubdivision[i]>=.55;}
// A hydrated suspension is thick across a broad powder/solvent ratio. Dry
// grains and heavily diluted liquid have no dough contribution.
export function doughStrength(content){return clamp((content-.12)/.15,0,1)*clamp((.995-content)/.06,0,1);}

// Local conservative concentration exchange: only compatible condensed matter
// shares solvent. Gas mixing never acts as liquid hydration.
export function wetPowderPair(ps,i,j,contact,dt){
  if(ps.phase[i]===Phase.GAS||ps.phase[j]===Phase.GAS||isCoherentSolid(ps,i)||isCoherentSolid(ps,j))return;
  // Gravity, thermal convection and resting contact cannot knead a powder.
  // Only recent work by the spoon at this contact supplies mechanical mixing.
  const work=Math.max(ps.stirActivity[i],ps.stirActivity[j]);if(work<.025)return;
  const a=ps.powderContent[i],b=ps.powderContent[j];if(a===b)return;
  if(isPowder(ps,i)&&ps.phase[j]===Phase.LIQUID)ps.solventMeltingTemperature[i]=Math.min(ps.solventMeltingTemperature[i],ps.meltingTemperature[j]);
  if(isPowder(ps,j)&&ps.phase[i]===Phase.LIQUID)ps.solventMeltingTemperature[j]=Math.min(ps.solventMeltingTemperature[j],ps.meltingTemperature[i]);
  const ma=ps.mass[i],mb=ps.mass[j],sum=Math.max(.00001,ma+mb),f=1-Math.exp(-contact*dt*work*6),mean=(a*ma+b*mb)/sum;
  ps.powderContent[i]+=(mean-a)*f;ps.powderContent[j]+=(mean-b)*f;
  // Mechanical solvent transfer is itself kneading work, even when the
  // spoon acts through the adjacent liquid rather than directly on a grain.
  const maxWork=contact*work*dt*4;
  if(isPowder(ps,i))ps.dissolutionProgress[i]=clamp(ps.dissolutionProgress[i]+Math.min(maxWork,Math.max(0,a-ps.powderContent[i])*5),0,1);
  if(isPowder(ps,j))ps.dissolutionProgress[j]=clamp(ps.dissolutionProgress[j]+Math.min(maxWork,Math.max(0,b-ps.powderContent[j])*5),0,1);
}
export function updatePowderDissolution(ps,dt){
  for(let i=0;i<ps.count;i++){
    if(!isPowder(ps,i))continue;
    const work=ps.stirActivity[i],hydrated=ps.powderContent[i]<.96&&work>=.025;
    ps.dissolutionProgress[i]=clamp(ps.dissolutionProgress[i]+(hydrated?dt*work*(1-ps.powderContent[i])*8:0),0,1);
    if(ps.dissolutionProgress[i]>=1){ps.meltingTemperature[i]=Math.min(ps.meltingTemperature[i],ps.solventMeltingTemperature[i]);ps.setPhase(i,Phase.LIQUID);ps.solidBodyId[i]=0;ps.solidSubdivision[i]=.08;ps.grainRest[i]=0;}
  }
}
