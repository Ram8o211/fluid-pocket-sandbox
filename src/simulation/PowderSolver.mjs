import { Phase } from './Phase.mjs';
import { clamp } from './math.mjs';
export function isCoherentSolid(ps,i){return ps.phase[i]===Phase.SOLID&&ps.solidSubdivision[i]<.55;}
export function isPowder(ps,i){return ps.phase[i]===Phase.SOLID&&ps.solidSubdivision[i]>=.55;}
export function doughStrength(content){return content<=.15||content>=.95?0:Math.sin(Math.PI*(content-.15)/.8);}

// Local conservative concentration exchange: only compatible condensed matter
// shares solvent. Gas mixing never acts as liquid hydration.
export function wetPowderPair(ps,i,j,contact,dt){
  if(ps.phase[i]===Phase.GAS||ps.phase[j]===Phase.GAS||isCoherentSolid(ps,i)||isCoherentSolid(ps,j))return;
  const a=ps.powderContent[i],b=ps.powderContent[j];if(a===b)return;
  const ma=ps.mass[i],mb=ps.mass[j],sum=Math.max(.00001,ma+mb),f=1-Math.exp(-contact*dt*1.2),mean=(a*ma+b*mb)/sum;
  ps.powderContent[i]+=(mean-a)*f;ps.powderContent[j]+=(mean-b)*f;
}
export function updatePowderDissolution(ps,dt){
  for(let i=0;i<ps.count;i++){
    if(!isPowder(ps,i))continue;
    const dilute=ps.powderContent[i]<.18;
    ps.dissolutionProgress[i]=clamp(ps.dissolutionProgress[i]+dt*(dilute?.22:-.4),0,1);
    if(ps.dissolutionProgress[i]>=1){ps.setPhase(i,Phase.LIQUID);ps.solidBodyId[i]=0;ps.solidSubdivision[i]=.08;}
  }
}
