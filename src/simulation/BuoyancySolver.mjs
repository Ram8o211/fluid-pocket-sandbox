import { Phase } from './Phase.mjs';
import { clamp, normalize3 } from './math.mjs';
export function gasBuoyancyAcceleration(gravity, environmentDensity, localGasDensity, strength=1){
  const [nx,ny,nz]=normalize3(gravity.x,gravity.y,gravity.z); const delta=Math.max(0,environmentDensity-localGasDensity); const k=delta*strength; return {x:-nx*k,y:-ny*k,z:-nz*k};
}
export function applyBuoyancy(ps,i,gravity,env,dt){ if(ps.phase[i]!==Phase.GAS)return; const a=gasBuoyancyAcceleration(gravity,env.environmentDensity,ps.localGasDensity[i],env.buoyancyStrength); ps.vx[i]+=a.x*dt;ps.vy[i]+=a.y*dt;ps.vz[i]+=a.z*dt; }
export function condensationCooling(localGasDensity,threshold,coefficient){ return localGasDensity<=threshold?0:coefficient*clamp((localGasDensity-threshold)/Math.max(threshold,0.05),0,2); }
