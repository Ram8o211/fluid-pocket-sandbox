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

function pairWeights(ps,i,j){const mi=Math.max(.001,ps.mass[i]||1),mj=Math.max(.001,ps.mass[j]||1),sum=mi+mj;return [mj/sum,mi/sum];}
function separatePair(ps,i,j,nx,ny,nz,amount,planar){const [wi,wj]=pairWeights(ps,i,j);ps.x[i]-=nx*amount*wi;ps.y[i]-=ny*amount*wi;if(!planar)ps.z[i]-=nz*amount*wi;ps.x[j]+=nx*amount*wj;ps.y[j]+=ny*amount*wj;if(!planar)ps.z[j]+=nz*amount*wj;}

export class FluidSolver {
  constructor(){this.neighborRadius=.48;this.restDistance=.26;this.reverseSweep=false;this.pairPhase=0;this.gasCounts=null;}
  ensureScratch(ps){if(!this.gasCounts||this.gasCounts.length<ps.capacity)this.gasCounts=new Uint16Array(ps.capacity);}
  solveLiquidPair(ps,i,j,nx,ny,nz,d,gravity,rules,dt,planar){
    const rest=particlePairRestDistance(ps,i,j,planar),supportRadius=Math.min(this.neighborRadius,Math.max(.30,rest*1.35)),[wi,wj]=pairWeights(ps,i,j);
    const fi=ps.temperature[i]<ps.meltingTemperature[i]-ps.phaseHysteresis[i]?clamp(ps.phaseProgress[i],0,1):0,fj=ps.temperature[j]<ps.meltingTemperature[j]-ps.phaseHysteresis[j]?clamp(ps.phaseProgress[j],0,1):0,mobility=(1-fi*.86)*(1-fj*.86);
    const viscosity=clamp((ps.viscosity[i]+ps.viscosity[j])*.5,0,1),kernel=clamp(1-d/supportRadius,0,1),viscous=clamp(viscosity*kernel*dt*4.5*mobility,0,.18);
    if(viscous>0){const dvx=ps.vx[j]-ps.vx[i],dvy=ps.vy[j]-ps.vy[i],dvz=planar?0:ps.vz[j]-ps.vz[i];ps.vx[i]+=dvx*viscous*wi;ps.vy[i]+=dvy*viscous*wi;if(!planar)ps.vz[i]+=dvz*viscous*wi;ps.vx[j]-=dvx*viscous*wj;ps.vy[j]-=dvy*viscous*wj;if(!planar)ps.vz[j]-=dvz*viscous*wj;}
    if(d<rest){const hard=Math.max(ps.incompressible?.[i]||0,ps.incompressible?.[j]||0),q=(rest-d)/rest,soft=(1-clamp(hard,0,1)*.92),perParticle=q*q*(.018+.03*(1-viscosity))*mobility*soft,total=perParticle*2;if(total>0)separatePair(ps,i,j,nx,ny,nz,total,planar);}
    else if(d<supportRadius){const sameMaterial=ps.materialId[i]===ps.materialId[j],delta=Math.abs(ps.miscibility[i]-ps.miscibility[j]),threshold=Math.max(.01,rules.miscibilityThreshold),compatibility=sameMaterial?1:clamp(1-delta/threshold,0,1);if(compatibility>0){const cohesion=clamp((ps.cohesion[i]+ps.cohesion[j])*.5,0,1),span=Math.max(.001,supportRadius-rest),perParticle=(d-rest)/span*cohesion*compatibility*.0025*mobility,total=perParticle*2;ps.x[i]+=nx*total*wi;ps.y[i]+=ny*total*wi;if(!planar)ps.z[i]+=nz*total*wi;ps.x[j]-=nx*total*wj;ps.y[j]-=ny*total*wj;if(!planar)ps.z[j]-=nz*total*wj;}}
    if(ps.materialId[i]!==ps.materialId[j]&&Math.abs(ps.miscibility[i]-ps.miscibility[j])>=rules.miscibilityThreshold){const imp=stratificationImpulse(ps.density[i],ps.density[j],gravity,.0015*mobility),totalX=imp.x*2,totalY=imp.y*2,totalZ=imp.z*2;ps.x[i]+=totalX*wi;ps.y[i]+=totalY*wi;if(!planar)ps.z[i]+=totalZ*wi;ps.x[j]-=totalX*wj;ps.y[j]-=totalY*wj;if(!planar)ps.z[j]-=totalZ*wj;}
  }
  solveSolidPair(ps,i,j,nx,ny,nz,d,dt,planar){
    const subI=ps.solidSubdivision[i],subJ=ps.solidSubdivision[j],coherent=subI<.55&&subJ<.55,sameRigidBody=coherent&&ps.solidBodyId[i]>0&&ps.solidBodyId[i]===ps.solidBodyId[j],sameCoherentMaterial=coherent&&ps.materialId[i]===ps.materialId[j];if(sameRigidBody||sameCoherentMaterial)return;
    const rest=particlePairRestDistance(ps,i,j,planar),granular=Math.max(subI,subJ)>=.55,target=granular?rest*(.48+.08*(1-(subI+subJ)*.5)):rest*.88;
    if(d<target){const q=(target-d)/target,rep=q*q*(granular?(.0025+.0035*(subI+subJ)*.5):.006)*2;separatePair(ps,i,j,nx,ny,nz,rep,planar);}
    if(granular&&d<target*1.55){const friction=clamp((.018+.07*(subI+subJ)*.5)*(1-d/(target*1.55)),0,.085),[wi,wj]=pairWeights(ps,i,j),dvx=ps.vx[j]-ps.vx[i],dvy=ps.vy[j]-ps.vy[i],dvz=planar?0:ps.vz[j]-ps.vz[i];ps.vx[i]+=dvx*friction*wi;ps.vy[i]+=dvy*friction*wi;if(!planar)ps.vz[i]+=dvz*friction*wi;ps.vx[j]-=dvx*friction*wj;ps.vy[j]-=dvy*friction*wj;if(!planar)ps.vz[j]-=dvz*friction*wj;}
  }
  solveSolidLiquidPair(ps,solid,liquid,nxFromSolid,nyFromSolid,nzFromSolid,d,gravity,rules,planar){
    const rest=particlePairRestDistance(ps,solid,liquid,planar),freezing=ps.temperature[liquid]<ps.meltingTemperature[liquid]-ps.phaseHysteresis[liquid]?clamp(ps.phaseProgress[liquid],0,1):0,mobility=1-freezing*.86,hard=Math.max(ps.incompressible?.[solid]||0,ps.incompressible?.[liquid]||0),soft=1-clamp(hard,0,1)*.92;
    if(d<rest){const q=(rest-d)/rest,rep=q*q*(.018+.03*(1-ps.viscosity[liquid]))*mobility*soft*2;if(rep>0)separatePair(ps,solid,liquid,nxFromSolid,nyFromSolid,nzFromSolid,rep,planar);}
    if(ps.materialId[solid]!==ps.materialId[liquid]&&Math.abs(ps.miscibility[solid]-ps.miscibility[liquid])>=rules.miscibilityThreshold){const imp=stratificationImpulse(ps.density[solid],ps.density[liquid],gravity,.0015*mobility),[wi,wj]=pairWeights(ps,solid,liquid);ps.x[solid]+=imp.x*2*wi;ps.y[solid]+=imp.y*2*wi;if(!planar)ps.z[solid]+=imp.z*2*wi;ps.x[liquid]-=imp.x*2*wj;ps.y[liquid]-=imp.y*2*wj;if(!planar)ps.z[liquid]-=imp.z*2*wj;}
  }
  enforceHardPacking(ps,grid,searchRadius,planar){
    grid.forEachPair(ps,searchRadius,(i,j)=>{
      if(ps.phase[i]===Phase.GAS||ps.phase[j]===Phase.GAS||Math.max(ps.incompressible?.[i]||0,ps.incompressible?.[j]||0)<.5)return;
      if(ps.phase[i]===Phase.SOLID&&ps.phase[j]===Phase.SOLID&&ps.solidBodyId[i]>0&&ps.solidBodyId[i]===ps.solidBodyId[j])return;
      const dx=ps.x[j]-ps.x[i],dy=ps.y[j]-ps.y[i],dz=planar?0:ps.z[j]-ps.z[i],d2=dx*dx+dy*dy+dz*dz;if(d2<=1e-12)return;const rest=particlePairRestDistance(ps,i,j,planar);if(d2>=rest*rest)return;const d=Math.sqrt(d2),amount=(rest-d)*.995;separatePair(ps,i,j,dx/d,dy/d,planar?0:dz/d,amount,planar);
    });
  }
  step(ps,grid,gravity,env,rules,dt,iterations=2,profile=null){
    const maxV=env.maxVelocity,planar=env.dimensionMode==='2D',searchRadius=clamp(profile?.fluidRadius??this.neighborRadius,.40,this.neighborRadius),pairStride=Math.max(1,profile?.fluidPairStride||1),pairPhase=this.pairPhase++%pairStride;this.reverseSweep=!this.reverseSweep;this.ensureScratch(ps);let hasHard=false;
    for(let i=0;i<ps.count;i++){
      ps.px[i]=ps.x[i];ps.py[i]=ps.y[i];ps.pz[i]=ps.z[i];hasHard=hasHard||(ps.incompressible?.[i]||0)>=.5;
      if(ps.phase[i]!==Phase.GAS){ps.vx[i]+=gravity.x*dt;ps.vy[i]+=gravity.y*dt;if(!planar)ps.vz[i]+=gravity.z*dt;}else if(planar)ps.vz[i]=0;
      const damping=Math.exp(-dt*(ps.phase[i]===Phase.GAS?.15:.025));ps.vx[i]*=damping;ps.vy[i]*=damping;ps.vz[i]*=damping;
      const speed2=ps.vx[i]*ps.vx[i]+ps.vy[i]*ps.vy[i]+(planar?0:ps.vz[i]*ps.vz[i]);if(speed2>maxV*maxV){const k=maxV/Math.sqrt(speed2);ps.vx[i]*=k;ps.vy[i]*=k;if(!planar)ps.vz[i]*=k;}
      ps.x[i]+=ps.vx[i]*dt;ps.y[i]+=ps.vy[i]*dt;if(planar){ps.z[i]=0;ps.vz[i]=0;}else ps.z[i]+=ps.vz[i]*dt;
    }
    this.collideBox(ps,env.box,planar);
    const r2=searchRadius*searchRadius;
    for(let it=0;it<iterations;it++){
      grid.rebuild(ps,env.box);this.gasCounts.fill(0,0,ps.count);
      grid.forEachPair(ps,searchRadius,(i,j)=>{
        const dx=ps.x[j]-ps.x[i],dy=ps.y[j]-ps.y[i],dz=planar?0:ps.z[j]-ps.z[i],d2=dx*dx+dy*dy+dz*dz;if(d2<=1e-12||d2>r2)return;const d=Math.sqrt(d2),nx=dx/d,ny=dy/d,nz=planar?0:dz/d,pi=ps.phase[i],pj=ps.phase[j];
        if(pi===Phase.GAS&&pj===Phase.GAS){const scale=pairStride,spread=(1-d/searchRadius)*(.018+.0125*(ps.compressibility[i]+ps.compressibility[j])),[wi,wj]=pairWeights(ps,i,j),amount=spread*2;ps.x[i]-=nx*amount*wi;ps.y[i]-=ny*amount*wi;if(!planar)ps.z[i]-=nz*amount*wi;ps.x[j]+=nx*amount*wj;ps.y[j]+=ny*amount*wj;if(!planar)ps.z[j]+=nz*amount*wj;this.gasCounts[i]=Math.min(65535,this.gasCounts[i]+scale);this.gasCounts[j]=Math.min(65535,this.gasCounts[j]+scale);return;}
        if(pi===Phase.GAS||pj===Phase.GAS){const gas=pi===Phase.GAS?i:j,sign=pi===Phase.GAS?-1:1,spread=(1-d/searchRadius)*(.018+.025*ps.compressibility[gas]);ps.x[gas]+=nx*spread*sign;ps.y[gas]+=ny*spread*sign;if(!planar)ps.z[gas]+=nz*spread*sign;return;}
        if(pi===Phase.LIQUID&&pj===Phase.LIQUID){this.solveLiquidPair(ps,i,j,nx,ny,nz,d,gravity,rules,dt,planar);return;}
        if(pi===Phase.SOLID&&pj===Phase.SOLID){this.solveSolidPair(ps,i,j,nx,ny,nz,d,dt,planar);return;}
        if(pi===Phase.SOLID&&pj===Phase.LIQUID){this.solveSolidLiquidPair(ps,i,j,nx,ny,nz,d,gravity,rules,planar);return;}
        if(pi===Phase.LIQUID&&pj===Phase.SOLID)this.solveSolidLiquidPair(ps,j,i,-nx,-ny,-nz,d,gravity,rules,planar);
      },pairStride,(pairPhase+it)%pairStride);
      if(hasHard){grid.rebuild(ps,env.box);this.enforceHardPacking(ps,grid,searchRadius,planar);}
      for(let i=0;i<ps.count;i++)ps.localGasDensity[i]=ps.phase[i]===Phase.GAS?clamp(.18+this.gasCounts[i]*.075,0,1.8):0;
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
