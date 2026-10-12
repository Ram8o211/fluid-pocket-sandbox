import { Phase } from './Phase.mjs';
import { condensationCooling } from './BuoyancySolver.mjs';
import { clamp } from './math.mjs';

export function thermalConductionFraction(conductivityA,conductivityB,rate,dt){
  const a=Math.max(0,conductivityA),b=Math.max(0,conductivityB);
  if(a<=0||b<=0||rate<=0||dt<=0)return 0;
  const interfaceConductivity=2*a*b/Math.max(1e-6,a+b);
  return clamp(1-Math.exp(-interfaceConductivity*rate*dt*12),0,1);
}

const workspaces = new WeakMap();

export function updateThermal(ps,grid,rules,env,dt){
  const count=ps.count,temp=ps.temperature,conductivity=ps.thermalConductivity,heatCapacity=ps.heatCapacity,mass=ps.mass,phase=ps.phase,gasDensity=ps.localGasDensity;
  const ambient=env.ambientTemperature,diffusion=Math.max(0,rules.thermalDiffusionRate??.7);
  for(let i=0;i<count;i++){
    let t=temp[i];
    if(phase[i]===Phase.GAS)t-=condensationCooling(gasDensity[i],rules.condensationDensityThreshold,rules.condensationCoolingCoefficient)*dt;
    const ambientFraction=1-Math.exp(-Math.max(0,conductivity[i])*diffusion*dt*.08*Math.max(0,env.ambientThermalExchange??1));t+=(ambient-t)*ambientFraction;temp[i]=clamp(t,0,1.2);
  }
  let buffers = workspaces.get(ps);
  if (!buffers || buffers.delta.length < count) {
    const edges = Math.max(16, count * 16);
    buffers = { delta: new Float64Array(count), weight: new Float64Array(count), capacity: new Float64Array(count), left: new Uint32Array(edges), right: new Uint32Array(edges), energy: new Float64Array(edges) };
    workspaces.set(ps, buffers);
  }
  const { delta, weight, capacity } = buffers;
  delta.fill(0, 0, count); weight.fill(0, 0, count);
  for(let i=0;i<count;i++)capacity[i]=Math.max(.00001,heatCapacity[i]*mass[i]);
  let edges = 0;
  const x=ps.x,y=ps.y,z=ps.z,radius=.55*clamp(rules.interactionRadiusScale??1,.4,1),r2=radius*radius;
  // Read one temperature field for both passes. A neighbour's newly received
  // heat is available on the next thermal tick, independent of grid ordering.
  grid.forEachPair(ps,radius,(i,j)=>{
    const dx=x[j]-x[i],dy=y[j]-y[i],dz=z[j]-z[i];if(dx*dx+dy*dy+dz*dz>r2)return;
    const f=thermalConductionFraction(conductivity[i],conductivity[j],diffusion,dt);
    if(f<=0)return;
    const ca=capacity[i],cb=capacity[j];
    weight[i]+=f*cb/(ca+cb);weight[j]+=f*ca/(ca+cb);
    if(edges===buffers.left.length){
      const grow=old=>{const next=new old.constructor(old.length*2);next.set(old);return next;};
      buffers.left=grow(buffers.left);buffers.right=grow(buffers.right);buffers.energy=grow(buffers.energy);
    }
    buffers.left[edges]=i;buffers.right[edges]=j;
    buffers.energy[edges++]=(temp[j]-temp[i])*ca*cb/(ca+cb)*f;
  });
  // Reuse the contact list instead of querying the grid and evaluating its
  // conductivity exponentials twice, especially for full mobile cauldrons.
  for(let edge=0;edge<edges;edge++){
    const i=buffers.left[edge],j=buffers.right[edge];
    const energy=buffers.energy[edge]/Math.max(1,weight[i],weight[j]);
    delta[i]+=energy/capacity[i];delta[j]-=energy/capacity[j];
  }
  for(let i=0;i<count;i++)temp[i]=clamp(temp[i]+delta[i],0,1.2);
}

