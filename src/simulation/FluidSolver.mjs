import { Phase } from './Phase.mjs';
import { clamp } from './math.mjs';
import { stratificationImpulse } from './DensityStratification.mjs';

const MAX_PARTICLE_RADIUS=.20;
export function effectiveParticleRadius(ps,i,planar=false){
  const base=clamp(Number(ps.particleRadius?.[i])||.13,.065,MAX_PARTICLE_RADIUS),mass=Math.max(.001,ps.mass[i]||1);
  return base*(planar?Math.sqrt(mass):Math.cbrt(mass));
}
export function particlePairRestDistance(ps,i,j,planar=false){
  return clamp(effectiveParticleRadius(ps,i,planar)+effectiveParticleRadius(ps,j,planar),.07,.44);
}

export class FluidSolver {
  constructor(){this.neighborRadius=.62;this.restDistance=.26;this.reverseSweep=false;}
  solveLiquidPair(ps,i,j,nx,ny,nz,d,gravity,rules,dt,planar){
    const rest=particlePairRestDistance(ps,i,j,planar),supportRadius=Math.min(this.neighborRadius,Math.max(.32,rest*1.5)),mi=Math.max(.001,ps.mass[i]||1),mj=Math.max(.001,ps.mass[j]||1),sum=mi+mj,wi=mj/sum,wj=mi/sum;
    const fi=ps.temperature[i]<ps.meltingTemperature[i]-ps.phaseHysteresis[i]?clamp(ps.phaseProgress[i],0,1):0,fj=ps.temperature[j]<ps.meltingTemperature[j]-ps.phaseHysteresis[j]?clamp(ps.phaseProgress[j],0,1):0,mobility=(1-fi*.86)*(1-fj*.86);
    const viscosity=clamp((ps.viscosity[i]+ps.viscosity[j])*.5,0,1),kernel=clamp(1-d/supportRadius,0,1),viscous=clamp(viscosity*kernel*dt*4.5*mobility,0,.18);
    if(viscous>0){const dvx=ps.vx[j]-ps.vx[i],dvy=ps.vy[j]-ps.vy[i],dvz=planar?0:ps.vz[j]-ps.vz[i];ps.vx[i]+=dvx*viscous*wi;ps.vy[i]+=dvy*viscous*wi;if(!planar)ps.vz[i]+=dvz*viscous*wi;ps.vx[j]-=dvx*viscous*wj;ps.vy[j]-=dvy*viscous*wj;if(!planar)ps.vz[j]-=dvz*viscous*wj;}
    if(d<rest){const q=(rest-d)/rest,perParticle=q*q*(.018+.03*(1-viscosity))*mobility,total=perParticle*2;ps.x[i]-=nx*total*wi;ps.y[i]-=ny*total*wi;if(!planar)ps.z[i]-=nz*total*wi;ps.x[j]+=nx*total*wj;ps.y[j]+=ny*total*wj;if(!planar)ps.z[j]+=nz*total*wj;}
    else if(d<supportRadius){const sameMaterial=ps.materialId[i]===ps.materialId[j],delta=Math.abs(ps.miscibility[i]-ps.miscibility[j]),threshold=Math.max(.01,rules.miscibilityThreshold),compatibility=sameMaterial?1:clamp(1-delta/threshold,0,1);if(compatibility>0){const cohesion=clamp((ps.cohesion[i]+ps.cohesion[j])*.5,0,1),span=Math.max(.001,supportRadius-rest),perParticle=(d-rest)/span*cohesion*compatibility*.0025*mobility,total=perParticle*2;ps.x[i]+=nx*total*wi;ps.y[i]+=ny*total*wi;if(!planar)ps.z[i]+=nz*total*wi;ps.x[j]-=nx*total*wj;ps.y[j]-=ny*total*wj;if(!planar)ps.z[j]-=nz*total*wj;}}
    if(ps.materialId[i]!==ps.materialId[j]&&Math.abs(ps.miscibility[i]-ps.miscibility[j])>=rules.miscibilityThreshold){const imp=stratificationImpulse(ps.density[i],ps.density[j],gravity,.0015*mobility),totalX=imp.x*2,totalY=imp.y*2,totalZ=imp.z*2;ps.x[i]+=totalX*wi;ps.y[i]+=totalY*wi;if(!planar)ps.z[i]+=totalZ*wi;ps.x[j]-=totalX*wj;ps.y[j]-=totalY*wj;if(!planar)ps.z[j]-=totalZ*wj;}
  }
  step(ps,grid,gravity,env,rules,dt,iterations=2){
    const maxV=env.maxVelocity,planar=env.dimensionMode==='2D';this.reverseSweep=!this.reverseSweep;
    for(let i=0;i<ps.count;i++){
      ps.px[i]=ps.x[i];ps.py[i]=ps.y[i];ps.pz[i]=ps.z[i];
      if(ps.phase[i]!==Phase.GAS){ps.vx[i]+=gravity.x*dt;ps.vy[i]+=gravity.y*dt;if(!planar)ps.vz[i]+=gravity.z*dt;}else if(planar)ps.vz[i]=0;
      // Free-fall drag is material-independent. Viscosity, subdivision and packing radius act only
      // through relative/contact motion, so they cannot change bulk gravity.
      const damping=Math.exp(-dt*(ps.phase[i]===Phase.GAS?.15:.025));ps.vx[i]*=damping;ps.vy[i]*=damping;ps.vz[i]*=damping;
      const speed=planar?Math.hypot(ps.vx[i],ps.vy[i]):Math.hypot(ps.vx[i],ps.vy[i],ps.vz[i]);if(speed>maxV){const k=maxV/speed;ps.vx[i]*=k;ps.vy[i]*=k;if(!planar)ps.vz[i]*=k;}
      ps.x[i]+=ps.vx[i]*dt;ps.y[i]+=ps.vy[i]*dt;if(planar){ps.z[i]=0;ps.vz[i]=0;}else ps.z[i]+=ps.vz[i]*dt;
    }
    this.collideBox(ps,env.box,planar);
    for(let it=0;it<iterations;it++){
      grid.rebuild(ps,env.box);const reverse=this.reverseSweep!==Boolean(it&1);
      for(let s=0;s<ps.count;s++){
        const i=reverse?ps.count-1-s:s;let gasCount=0,ri=effectiveParticleRadius(ps,i,planar),searchRadius=clamp((ri+MAX_PARTICLE_RADIUS)*1.5,.48,this.neighborRadius);
        grid.forEachNeighbor(ps,i,searchRadius,(j)=>{
          const dx=ps.x[j]-ps.x[i],dy=ps.y[j]-ps.y[i],dz=planar?0:ps.z[j]-ps.z[i],d=planar?Math.hypot(dx,dy):Math.hypot(dx,dy,dz);if(d<=1e-6||d>searchRadius)return;
          if(ps.phase[i]===Phase.GAS&&ps.phase[j]===Phase.GAS)gasCount++;
          const nx=dx/d,ny=dy/d,nz=planar?0:dz/d;
          if(ps.phase[i]===Phase.GAS){const spread=(1-d/searchRadius)*(.018+.025*ps.compressibility[i]);ps.x[i]-=nx*spread;ps.y[i]-=ny*spread;ps.z[i]-=nz*spread;return;}
          if(ps.phase[i]===Phase.SOLID){
            if(ps.phase[j]===Phase.GAS)return;
            const pairRest=particlePairRestDistance(ps,i,j,planar),granularI=ps.solidSubdivision[i]>=.55,coherentPair=!granularI&&ps.phase[j]===Phase.SOLID&&ps.solidSubdivision[j]<.55,sameRigidBody=coherentPair&&ps.solidBodyId[i]>0&&ps.solidBodyId[i]===ps.solidBodyId[j],sameCoherentMaterial=coherentPair&&ps.materialId[i]===ps.materialId[j];
            if(sameRigidBody||sameCoherentMaterial)return;
            const target=granularI?pairRest*(.48+.08*(1-ps.solidSubdivision[i])):pairRest*.88;
            if(d<target){const q=(target-d)/target,rep=q*q*(granularI?(.0025+.0035*ps.solidSubdivision[i]):.006);ps.x[i]-=nx*rep;ps.y[i]-=ny*rep;if(!planar)ps.z[i]-=nz*rep;}
            if(ps.phase[j]===Phase.SOLID&&granularI&&d<target*1.55){const friction=clamp((.018+.07*ps.solidSubdivision[i])*(1-d/(target*1.55)),0,.085);ps.vx[i]+=(ps.vx[j]-ps.vx[i])*friction;ps.vy[i]+=(ps.vy[j]-ps.vy[i])*friction;if(!planar)ps.vz[i]+=(ps.vz[j]-ps.vz[i])*friction;}
            return;
          }
          if(ps.phase[j]===Phase.LIQUID){if(j<i)return;this.solveLiquidPair(ps,i,j,nx,ny,nz,d,gravity,rules,dt,planar);return;}
          if(ps.phase[j]!==Phase.GAS){
            const freezing=ps.temperature[i]<ps.meltingTemperature[i]-ps.phaseHysteresis[i]?clamp(ps.phaseProgress[i],0,1):0,mobility=1-freezing*.86,target=particlePairRestDistance(ps,i,j,planar),freezingOntoSameSolid=freezing>0&&ps.phase[j]===Phase.SOLID&&ps.materialId[i]===ps.materialId[j],interfaceMobility=freezingOntoSameSolid?.04:1;
            if(d<target){const q=(target-d)/target,rep=q*q*(.018+.03*(1-ps.viscosity[i]))*mobility*interfaceMobility;ps.x[i]-=nx*rep;ps.y[i]-=ny*rep;if(!planar)ps.z[i]-=nz*rep;}
            if(ps.materialId[i]!==ps.materialId[j]&&Math.abs(ps.miscibility[i]-ps.miscibility[j])>=rules.miscibilityThreshold){const imp=stratificationImpulse(ps.density[i],ps.density[j],gravity,.0015*mobility);ps.x[i]+=imp.x;ps.y[i]+=imp.y;if(!planar)ps.z[i]+=imp.z;}
          }
        });
        ps.localGasDensity[i]=ps.phase[i]===Phase.GAS?clamp(.18+gasCount*.075,0,1.8):0;
      }
      this.collideBox(ps,env.box,planar);
    }
    for(let i=0;i<ps.count;i++){
      const rx=(ps.x[i]-ps.px[i])/dt,ry=(ps.y[i]-ps.py[i])/dt,rz=planar?0:(ps.z[i]-ps.pz[i])/dt;
      if(ps.phase[i]===Phase.SOLID){if(planar)ps.vz[i]=0;}
      else{const freezing=ps.phase[i]===Phase.LIQUID&&ps.temperature[i]<ps.meltingTemperature[i]-ps.phaseHysteresis[i]?clamp(ps.phaseProgress[i],0,1):0,physicalShare=freezing*.94;ps.vx[i]=rx*(1-physicalShare)+ps.vx[i]*physicalShare;ps.vy[i]=ry*(1-physicalShare)+ps.vy[i]*physicalShare;ps.vz[i]=planar?0:rz*(1-physicalShare)+ps.vz[i]*physicalShare;}
    }
  }
  collideBox(ps,box,planar=false){
    for(let i=0;i<ps.count;i++){
      const pad=clamp(effectiveParticleRadius(ps,i,planar)*.62,.05,.16),hx=box.width/2-pad,hy=box.height/2-pad,hz=box.depth/2-pad;
      const solid=ps.phase[i]===Phase.SOLID,granular=solid&&ps.solidSubdivision[i]>.45,restitution=solid?0:.08,tangent=solid?(granular?.48:.72):.92;let hitX=false,hitY=false,hitZ=false;
      if(ps.x[i]<-hx){ps.x[i]=-hx;if(ps.vx[i]<0)ps.vx[i]=-ps.vx[i]*restitution;hitX=true;}else if(ps.x[i]>hx){ps.x[i]=hx;if(ps.vx[i]>0)ps.vx[i]=-ps.vx[i]*restitution;hitX=true;}
      if(ps.y[i]<-hy){ps.y[i]=-hy;if(ps.vy[i]<0)ps.vy[i]=-ps.vy[i]*restitution;hitY=true;}else if(ps.y[i]>hy){ps.y[i]=hy;if(ps.vy[i]>0)ps.vy[i]=-ps.vy[i]*restitution;hitY=true;}
      if(planar){ps.z[i]=0;ps.vz[i]=0;}else if(ps.z[i]<-hz){ps.z[i]=-hz;if(ps.vz[i]<0)ps.vz[i]=-ps.vz[i]*restitution;hitZ=true;}else if(ps.z[i]>hz){ps.z[i]=hz;if(ps.vz[i]>0)ps.vz[i]=-ps.vz[i]*restitution;hitZ=true;}
      if(hitX){ps.vy[i]*=tangent;ps.vz[i]*=tangent;}if(hitY){ps.vx[i]*=tangent;ps.vz[i]*=tangent;if(granular&&Math.abs(ps.vy[i])<.18)ps.vy[i]=0;}if(hitZ){ps.vx[i]*=tangent;ps.vy[i]*=tangent;}
    }
  }
}
