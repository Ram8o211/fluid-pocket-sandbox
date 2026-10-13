import { isPowder, isCoherentSolid, doughStrength } from './PowderSolver.mjs';
import { Phase } from './Phase.mjs';
import { clamp } from './math.mjs';
import { stratificationImpulse } from './DensityStratification.mjs';

const MAX_PARTICLE_RADIUS=.20;
// Warm liquids flow more easily; cold liquids thicken. Room-temperature behavior
// remains unchanged, including the sandbox's existing material controls.
export function effectiveLiquidViscosity(ps,i) {
  const base=clamp(ps.viscosity[i] * Math.exp(1.6 * (.33 - ps.temperature[i])), 0, 1);
  return ps.phase[i]===Phase.LIQUID?Math.max(base,.99*doughStrength(ps.powderContent[i])):base;
}
export function effectiveParticleRadius(ps,i,planar=false){
  const base=clamp(Number(ps.particleRadius?.[i])||.13,.065,MAX_PARTICLE_RADIUS),mass=Math.max(.001,(ps.mass[i]||1)/(ps.volumePacking?Math.max(.04,ps.baseDensity[i]):1));
  return base*(planar?Math.sqrt(mass):Math.cbrt(mass))*(ps.packingScale??1);
}
export function particlePairRestDistance(ps,i,j,planar=false){
  const scale=ps.packingScale??1;return clamp(effectiveParticleRadius(ps,i,planar)+effectiveParticleRadius(ps,j,planar),.07*scale,.44*scale);
}

function pairWeights(ps,i,j){
  const restI=isPowder(ps,i)&&ps.grainRest[i],restJ=isPowder(ps,j)&&ps.grainRest[j];
  // Supported grains transmit the load to the floor instead of spreading
  // laterally whenever an incoming grain is projected out of penetration.
  if(restI&&!restJ)return [0,1];if(restJ&&!restI)return [1,0];
  const mi=Math.max(.001,ps.mass[i]||1),mj=Math.max(.001,ps.mass[j]||1),sum=mi+mj;return [mj/sum,mi/sum];
}
function separatePair(ps,i,j,nx,ny,nz,amount,planar){
  if(isPowder(ps,i)&&ps.grainRest[i]&&isPowder(ps,j)&&ps.grainRest[j]&&amount<particlePairRestDistance(ps,i,j,planar)*.06)return;
  const [wi,wj]=pairWeights(ps,i,j);ps.x[i]-=nx*amount*wi;ps.y[i]-=ny*amount*wi;if(!planar)ps.z[i]-=nz*amount*wi;ps.x[j]+=nx*amount*wj;ps.y[j]+=ny*amount*wj;if(!planar)ps.z[j]+=nz*amount*wj;
}

export class FluidSolver {
  constructor(){this.neighborRadius=.48;this.restDistance=.26;this.reverseSweep=false;this.pairPhase=0;this.gasCounts=null;this.cachePs=null;this.radii=this.viscosities=this.dough=new Float32Array(0);}
  ensureScratch(ps){if(!this.gasCounts||this.gasCounts.length<ps.capacity){this.gasCounts=new Uint16Array(ps.capacity);this.radii=new Float32Array(ps.capacity);this.viscosities=new Float32Array(ps.capacity);this.dough=new Float32Array(ps.capacity);}}
  sortDensityContact(ps,i,j,nx,ny,nz,d,rest,gravity,mobility,planar,interactionScale=1){
    // Only reverse-density neighbors get a downward sorting impulse. A cutoff
    // near the particle diameter strands a fresh heavy layer on top of a
    // settled light layer: exchanging the layers requires a few grain widths
    // of reach. Fade the impulse to zero at the *existing* neighbor radius.
    // Correctly ordered neighbors receive no force, keeping interfaces closed.
    const inverted=(ps.density[i]-ps.density[j])*(nx*gravity.x+ny*gravity.y+nz*gravity.z);
    const reach=this.neighborRadius*interactionScale*(ps.packingScale??1);
    const contact=clamp((reach-d)/Math.max(.001,reach-rest),0,1);
    if(inverted<=0||contact<=0)return;
    const imp=stratificationImpulse(ps.density[i],ps.density[j],gravity,.0015*mobility*contact*(ps.packingScale??1)),[wi,wj]=pairWeights(ps,i,j);
    ps.x[i]+=imp.x*2*wi;ps.y[i]+=imp.y*2*wi;if(!planar)ps.z[i]+=imp.z*2*wi;
    ps.x[j]-=imp.x*2*wj;ps.y[j]-=imp.y*2*wj;if(!planar)ps.z[j]-=imp.z*2*wj;
  }
  solveLiquidPair(ps,i,j,nx,ny,nz,d,gravity,rules,dt,planar,interactionScale=1){
    const cached=this.cachePs===ps,scale=ps.packingScale??1,rest=cached?clamp(this.radii[i]+this.radii[j],.07*scale,.44*scale):particlePairRestDistance(ps,i,j,planar),supportRadius=Math.min(this.neighborRadius*interactionScale*scale,Math.max(.30*interactionScale*scale,rest*1.35)),[wi,wj]=pairWeights(ps,i,j);
    const fi=ps.temperature[i]<ps.meltingTemperature[i]-ps.phaseHysteresis[i]?clamp(ps.phaseProgress[i],0,1):0,fj=ps.temperature[j]<ps.meltingTemperature[j]-ps.phaseHysteresis[j]?clamp(ps.phaseProgress[j],0,1):0,mobility=(1-fi*.86)*(1-fj*.86);
    const dough=cached?(this.dough[i]+this.dough[j])*.5:(doughStrength(ps.powderContent[i])+doughStrength(ps.powderContent[j]))*.5;
    const viscosity=cached?(this.viscosities[i]+this.viscosities[j])*.5:(effectiveLiquidViscosity(ps,i)+effectiveLiquidViscosity(ps,j))*.5,kernel=clamp(1-d/supportRadius,0,1),viscous=clamp(viscosity*kernel*dt*(4.5+dough*150)*mobility,0,dough>0?.95:.18);
    if(viscous>0){const dvx=ps.vx[j]-ps.vx[i],dvy=ps.vy[j]-ps.vy[i],dvz=planar?0:ps.vz[j]-ps.vz[i];ps.vx[i]+=dvx*viscous*wi;ps.vy[i]+=dvy*viscous*wi;if(!planar)ps.vz[i]+=dvz*viscous*wi;ps.vx[j]-=dvx*viscous*wj;ps.vy[j]-=dvy*viscous*wj;if(!planar)ps.vz[j]-=dvz*viscous*wj;}
    if(d<rest){const hard=Math.max(ps.incompressible?.[i]||0,ps.incompressible?.[j]||0),q=(rest-d)/rest,soft=(1-clamp(hard,0,1)*.92),perParticle=q*q*(.018+.03*(1-viscosity))*mobility*soft*scale,total=perParticle*2;if(total>0)separatePair(ps,i,j,nx,ny,nz,total,planar);}
    else if(d<supportRadius){const sameMaterial=ps.materialId[i]===ps.materialId[j],delta=Math.abs(ps.miscibility[i]-ps.miscibility[j]),threshold=Math.max(.01,rules.miscibilityThreshold),compatibility=sameMaterial?1:clamp(1-delta/threshold,0,1);if(compatibility>0){const cohesion=clamp((ps.cohesion[i]+ps.cohesion[j])*.5,0,1),span=Math.max(.001,supportRadius-rest),perParticle=(d-rest)/span*cohesion*compatibility*.0025*mobility,total=perParticle*2;ps.x[i]+=nx*total*wi;ps.y[i]+=ny*total*wi;if(!planar)ps.z[i]+=nz*total*wi;ps.x[j]-=nx*total*wj;ps.y[j]-=ny*total*wj;if(!planar)ps.z[j]-=nz*total*wj;}}
    if(ps.materialId[i]!==ps.materialId[j]&&Math.abs(ps.miscibility[i]-ps.miscibility[j])>=rules.miscibilityThreshold)this.sortDensityContact(ps,i,j,nx,ny,nz,d,rest,gravity,mobility,planar,interactionScale);
  }
  solvePowderPair(ps,i,j,nx,ny,nz,d,dt,planar,rules){
    const scale=ps.packingScale??1,rest=this.cachePs===ps?clamp(this.radii[i]+this.radii[j],.07*scale,.44*scale):particlePairRestDistance(ps,i,j,planar);
    if(ps.grainRest[i]&&ps.grainRest[j]&&d>=rest*.94)return;
    const [wi,wj]=pairWeights(ps,i,j);
    const compatible=Math.abs(ps.miscibility[i]-ps.miscibility[j])<rules.miscibilityThreshold;
    const wet=compatible?(doughStrength(ps.powderContent[i])+doughStrength(ps.powderContent[j]))*.5:0;

    // Continuous pair contact: check the relative path this frame before
    // accepting the endpoints. A compact pile may begin *already touching*;
    // a strong spoon stroke can swap those grains in one integration step.
    const rx=nx*d,ry=ny*d,rz=planar?0:nz*d;
    const px=ps.px[j]-ps.px[i],py=ps.py[j]-ps.py[i],pz=planar?0:ps.pz[j]-ps.pz[i];
    const mx=rx-px,my=ry-py,mz=rz-pz;
    const a=mx*mx+my*my+mz*mz,b=px*mx+py*my+pz*mz,c=px*px+py*py+pz*pz-rest*rest;
    let hitX=0,hitY=0,hitZ=0,swept=false;
    if(a>1e-10){
      if(c>1e-8&&b<0){
        const discriminant=b*b-a*c;
        if(discriminant>=0){
          const t=(-b-Math.sqrt(discriminant))/a;
          if(t>=0&&t<=1){hitX=px+mx*t;hitY=py+my*t;hitZ=pz+mz*t;swept=true;}
        }
      }else if(c<=1e-8&&px*rx+py*ry+pz*rz<0){
        // Already touching/overlapping at t=0, now on opposite sides:
        // take the incoming normal rather than the flipped endpoint normal.
        const initialLength=Math.hypot(px,py,pz);
        if(initialLength>1e-7){hitX=px/initialLength*rest;hitY=py/initialLength*rest;hitZ=pz/initialLength*rest;swept=true;}
      }
    }
    if(!swept&&d>rest){
      // Solve the full quadratic for the *next* timestep. Radial speed alone
      // falsely predicts collisions when grains narrowly pass tangentially.
      const vx=ps.vx[j]-ps.vx[i],vy=ps.vy[j]-ps.vy[i],vz=planar?0:ps.vz[j]-ps.vz[i];
      const speed2=vx*vx+vy*vy+vz*vz,along=rx*vx+ry*vy+rz*vz,gap2=d*d-rest*rest;
      if(speed2<1e-10||along>=0)return;
      const discriminant=along*along-speed2*gap2;
      if(discriminant<0)return;
      const t=(-along-Math.sqrt(discriminant))/speed2;
      if(t<0||t>dt)return;
      hitX=rx+vx*t;hitY=ry+vy*t;hitZ=rz+vz*t;swept=true;
    }
    if(swept){
      const length=Math.hypot(hitX,hitY,hitZ);
      if(length>1e-7){
        // Reposition to the first actual contact, conserving the pair's
        // mass-weighted centre; no velocity is reversed into a bounce.
        const sx=hitX/length*rest,sy=hitY/length*rest,sz=hitZ/length*rest;
        const dx=sx-rx,dy=sy-ry,dz=sz-rz;
        ps.x[i]-=dx*wi;ps.y[i]-=dy*wi;if(!planar)ps.z[i]-=dz*wi;
        ps.x[j]+=dx*wj;ps.y[j]+=dy*wj;if(!planar)ps.z[j]+=dz*wj;
        nx=sx/rest;ny=sy/rest;nz=planar?0:sz/rest;d=rest;
      }else if(d>rest)return;
    }else if(d>rest)return;
    // Only unilateral penetrations need positional separation. Wet dough
    // gains plastic sliding resistance but no spring attraction at a distance.
    if(d<rest)separatePair(ps,i,j,nx,ny,nz,(rest-d)*.92,planar);
    const dvx=ps.vx[j]-ps.vx[i],dvy=ps.vy[j]-ps.vy[i],dvz=planar?0:ps.vz[j]-ps.vz[i],normal=dvx*nx+dvy*ny+dvz*nz;
    const approaching=Math.min(0,normal),tx=dvx-normal*nx,ty=dvy-normal*ny,tz=dvz-normal*nz;
    const friction=clamp(dt*(17+13*wet),0,.85);
    const cx=nx*approaching+tx*friction,cy=ny*approaching+ty*friction,cz=nz*approaching+tz*friction;
    ps.vx[i]+=cx*wi;ps.vy[i]+=cy*wi;if(!planar)ps.vz[i]+=cz*wi;
    ps.vx[j]-=cx*wj;ps.vy[j]-=cy*wj;if(!planar)ps.vz[j]-=cz*wj;
  }
  solveSolidPair(ps,i,j,nx,ny,nz,d,dt,planar){
    const subI=ps.solidSubdivision[i],subJ=ps.solidSubdivision[j],coherent=subI<.55&&subJ<.55,sameRigidBody=coherent&&ps.solidBodyId[i]>0&&ps.solidBodyId[i]===ps.solidBodyId[j],sameCoherentMaterial=coherent&&ps.materialId[i]===ps.materialId[j];if(sameRigidBody||sameCoherentMaterial)return;
    const rest=particlePairRestDistance(ps,i,j,planar),granular=Math.max(subI,subJ)>=.55,target=granular?rest*.95:rest*.88;
    if(d<target){const q=(target-d)/target,rep=granular?(target-d)*.9:q*q*.006*2;separatePair(ps,i,j,nx,ny,nz,rep,planar);}
    if(granular&&d<target*1.55){const friction=clamp((.018+.07*(subI+subJ)*.5)*(1-d/(target*1.55)),0,.085),[wi,wj]=pairWeights(ps,i,j),dvx=ps.vx[j]-ps.vx[i],dvy=ps.vy[j]-ps.vy[i],dvz=planar?0:ps.vz[j]-ps.vz[i];ps.vx[i]+=dvx*friction*wi;ps.vy[i]+=dvy*friction*wi;if(!planar)ps.vz[i]+=dvz*friction*wi;ps.vx[j]-=dvx*friction*wj;ps.vy[j]-=dvy*friction*wj;if(!planar)ps.vz[j]-=dvz*friction*wj;}
  }
  solveSolidLiquidPair(ps,solid,liquid,nxFromSolid,nyFromSolid,nzFromSolid,d,gravity,rules,planar,interactionScale=1){
    const rest=particlePairRestDistance(ps,solid,liquid,planar),freezing=ps.temperature[liquid]<ps.meltingTemperature[liquid]-ps.phaseHysteresis[liquid]?clamp(ps.phaseProgress[liquid],0,1):0,mobility=1-freezing*.86,hard=Math.max(ps.incompressible?.[solid]||0,ps.incompressible?.[liquid]||0),soft=1-clamp(hard,0,1)*.92;
    if(d<rest){const q=(rest-d)/rest,rep=q*q*(.018+.03*(1-ps.viscosity[liquid]))*mobility*soft*2;if(rep>0)separatePair(ps,solid,liquid,nxFromSolid,nyFromSolid,nzFromSolid,rep,planar);}
    if(ps.materialId[solid]!==ps.materialId[liquid]&&Math.abs(ps.miscibility[solid]-ps.miscibility[liquid])>=rules.miscibilityThreshold)this.sortDensityContact(ps,solid,liquid,nxFromSolid,nyFromSolid,nzFromSolid,d,rest,gravity,mobility,planar,interactionScale);
  }
  enforceHardPacking(ps,grid,searchRadius,planar){
    grid.forEachPair(ps,searchRadius,(i,j)=>{
      if(ps.phase[i]===Phase.GAS||ps.phase[j]===Phase.GAS||Math.max(ps.incompressible?.[i]||0,ps.incompressible?.[j]||0)<.5)return;
      if(isPowder(ps,i)&&ps.grainRest[i]&&isPowder(ps,j)&&ps.grainRest[j])return;
      if(ps.phase[i]===Phase.SOLID&&ps.phase[j]===Phase.SOLID&&ps.solidBodyId[i]>0&&ps.solidBodyId[i]===ps.solidBodyId[j])return;
      const dx=ps.x[j]-ps.x[i],dy=ps.y[j]-ps.y[i],dz=planar?0:ps.z[j]-ps.z[i],d2=dx*dx+dy*dy+dz*dz;if(d2<=1e-12)return;const scale=ps.packingScale??1,rest=this.cachePs===ps?clamp(this.radii[i]+this.radii[j],.07*scale,.44*scale):particlePairRestDistance(ps,i,j,planar);if(d2>=rest*rest)return;const d=Math.sqrt(d2),amount=(rest-d)*.995;separatePair(ps,i,j,dx/d,dy/d,planar?0:dz/d,amount,planar);
    });
  }
  step(ps,grid,gravity,env,rules,dt,iterations=2,profile=null,collideBoundary=null){
    const maxV=env.maxVelocity,planar=env.dimensionMode==='2D',interactionScale=clamp(rules.interactionRadiusScale??1,.4,1);let searchRadius=clamp(profile?.fluidRadius??this.neighborRadius,.40,this.neighborRadius)*interactionScale*(ps.packingScale??1),hasPowder=false,maxDisplacement=0;
    const pairStride=Math.max(1,profile?.fluidPairStride||1),pairPhase=this.pairPhase++%pairStride;this.reverseSweep=!this.reverseSweep;this.ensureScratch(ps);let hasHard=false,maxRadius=0;
    for(let i=0;i<ps.count;i++){
      this.radii[i]=effectiveParticleRadius(ps,i,planar);this.viscosities[i]=effectiveLiquidViscosity(ps,i);this.dough[i]=ps.phase[i]===Phase.LIQUID?doughStrength(ps.powderContent[i]):0;
      maxRadius=Math.max(maxRadius,this.radii[i]);
      ps.px[i]=ps.x[i];ps.py[i]=ps.y[i];ps.pz[i]=ps.z[i];hasHard=hasHard||(ps.incompressible?.[i]||0)>=.5;
      if(ps.phase[i]!==Phase.GAS){if(!isPowder(ps,i)||!ps.grainRest[i]){ps.vx[i]+=gravity.x*dt;ps.vy[i]+=gravity.y*dt;if(!planar)ps.vz[i]+=gravity.z*dt;}}else if(planar)ps.vz[i]=0;
      if(ps.phase[i]===Phase.GAS&&env.gasThermalMotion){
        // Deterministic thermal agitation breaks the perfectly flat lid layer.
        // Zero-mean parcel kicks coexist with buoyancy and soft pressure.
        const seed=(Math.imul(i+1,73856093)^Math.imul(this.pairPhase,19349663))>>>0;
        const kick=(axis)=>{let n=(seed^Math.imul(axis,83492791))>>>0;n=Math.imul(n^(n>>>16),2246822519)>>>0;return (n/4294967296-.5)*2;};
        const amplitude=env.gasThermalMotion*Math.sqrt(dt)*clamp(ps.temperature[i]+.25,.3,1.2);
        ps.vx[i]+=kick(1)*amplitude;ps.vy[i]+=kick(2)*amplitude;if(!planar)ps.vz[i]+=kick(3)*amplitude;
      }
      const damping=Math.exp(-dt*(ps.phase[i]===Phase.GAS?.15:.025));ps.vx[i]*=damping;ps.vy[i]*=damping;ps.vz[i]*=damping;
      const speed2=ps.vx[i]*ps.vx[i]+ps.vy[i]*ps.vy[i]+(planar?0:ps.vz[i]*ps.vz[i]);if(speed2>maxV*maxV){const k=maxV/Math.sqrt(speed2);ps.vx[i]*=k;ps.vy[i]*=k;if(!planar)ps.vz[i]*=k;}
      hasPowder=hasPowder||isPowder(ps,i);maxDisplacement=Math.max(maxDisplacement,Math.min(maxV,Math.sqrt(speed2))*dt);
      ps.x[i]+=ps.vx[i]*dt;ps.y[i]+=ps.vy[i]*dt;if(planar){ps.z[i]=0;ps.vz[i]=0;}else ps.z[i]+=ps.vz[i]*dt;
    }
    if(hasPowder)searchRadius=Math.max(searchRadius,maxDisplacement*2);
    this.cachePs=ps;
    this.collideBox(ps,env.box,planar);
    collideBoundary?.();
    const r2=searchRadius*searchRadius;
    // Contact/tunnelling checks must run every frame, even when the generic
    // far-field fluid solver subsamples pairs at large particle counts.
    const forceGranularPair=(i,j)=>(isPowder(ps,i)||isPowder(ps,j))
      &&!isCoherentSolid(ps,i)&&!isCoherentSolid(ps,j);
    for(let it=0;it<iterations;it++){
      grid.rebuild(ps,env.box);this.gasCounts.fill(0,0,ps.count);
      grid.forEachPair(ps,searchRadius,(i,j)=>{
        const dx=ps.x[j]-ps.x[i],dy=ps.y[j]-ps.y[i],dz=planar?0:ps.z[j]-ps.z[i],d2=dx*dx+dy*dy+dz*dz;if(d2<=1e-12||d2>r2)return;const d=Math.sqrt(d2),nx=dx/d,ny=dy/d,nz=planar?0:dz/d,pi=ps.phase[i],pj=ps.phase[j];
        // Vapour parcels represent overlapping gas volumes, not hard spheres.
        // Only very close contacts separate, with a time-scaled soft response.
        if(pi===Phase.GAS&&pj===Phase.GAS){
          const contact=particlePairRestDistance(ps,i,j,planar)*(env.gasContactScale??.55);
          if(d<contact){const q=1-d/contact,amount=q*q*(env.gasContactStrength??.12)*dt/Math.max(1,iterations);separatePair(ps,i,j,nx,ny,nz,amount,planar);}
          this.gasCounts[i]=Math.min(65535,this.gasCounts[i]+pairStride);this.gasCounts[j]=Math.min(65535,this.gasCounts[j]+pairStride);return;
        }
        if(pi===Phase.GAS||pj===Phase.GAS){
          const gas=pi===Phase.GAS?i:j,sign=pi===Phase.GAS?-1:1,contact=particlePairRestDistance(ps,i,j,planar)*.7;
          if(d<contact){const q=1-d/contact,spread=q*q*.24*dt/Math.max(1,iterations);ps.x[gas]+=nx*spread*sign;ps.y[gas]+=ny*spread*sign;if(!planar)ps.z[gas]+=nz*spread*sign;}return;
        }
        if((isPowder(ps,i)||isPowder(ps,j))&&!isCoherentSolid(ps,i)&&!isCoherentSolid(ps,j)){this.solvePowderPair(ps,i,j,nx,ny,nz,d,dt,planar,rules);return;}
        if(pi===Phase.LIQUID&&pj===Phase.LIQUID){this.solveLiquidPair(ps,i,j,nx,ny,nz,d,gravity,rules,dt,planar,interactionScale);return;}
        if(pi===Phase.SOLID&&pj===Phase.SOLID){this.solveSolidPair(ps,i,j,nx,ny,nz,d,dt,planar);return;}
        if(pi===Phase.SOLID&&pj===Phase.LIQUID){this.solveSolidLiquidPair(ps,i,j,nx,ny,nz,d,gravity,rules,planar,interactionScale);return;}
        if(pi===Phase.LIQUID&&pj===Phase.SOLID)this.solveSolidLiquidPair(ps,j,i,-nx,-ny,-nz,d,gravity,rules,planar,interactionScale);
      },pairStride,(pairPhase+it)%pairStride,forceGranularPair);
      if(hasHard){grid.rebuild(ps,env.box);const scale=ps.packingScale??1;this.enforceHardPacking(ps,grid,Math.min(searchRadius,clamp(maxRadius*2,.07*scale,.44*scale)),planar);}
      for(let i=0;i<ps.count;i++)ps.localGasDensity[i]=ps.phase[i]===Phase.GAS?clamp(.18+this.gasCounts[i]*.075,0,1.8):0;
      this.collideBox(ps,env.box,planar);
      collideBoundary?.();
    }
    for(let i=0;i<ps.count;i++){
      const rx=(ps.x[i]-ps.px[i])/dt,ry=(ps.y[i]-ps.py[i])/dt,rz=planar?0:(ps.z[i]-ps.pz[i])/dt;
      if(ps.phase[i]===Phase.SOLID){if(planar)ps.vz[i]=0;}
      else{
        const liquid=ps.phase[i]===Phase.LIQUID,freezing=liquid&&ps.temperature[i]<ps.meltingTemperature[i]-ps.phaseHysteresis[i]?clamp(ps.phaseProgress[i],0,1):0;
        // Dense packing moves positions to remove overlaps. Feeding all of that
        // correction into velocity can launch fine liquids off a supporting
        // floor every frame. Retain physical gravity, spoon and contact momentum
        // while allowing a bounded contribution from constraint displacement.
        const dough=liquid?doughStrength(ps.powderContent[i]):0;
        const constraintShare=liquid?clamp(env.liquidConstraintVelocityShare??1,0,1)*(1-dough*.95):clamp(env.gasConstraintVelocityShare??.1,0,1),physicalShare=Math.max(freezing*.94,1-constraintShare);
        const physicalDown=ps.vx[i]*gravity.x+ps.vy[i]*gravity.y+ps.vz[i]*gravity.z;
        ps.vx[i]=rx*(1-physicalShare)+ps.vx[i]*physicalShare;ps.vy[i]=ry*(1-physicalShare)+ps.vy[i]*physicalShare;ps.vz[i]=planar?0:rz*(1-physicalShare)+ps.vz[i]*physicalShare;
        if(liquid&&constraintShare<1&&physicalDown>=0){
          const projectedDown=rx*gravity.x+ry*gravity.y+rz*gravity.z;
          if(projectedDown<physicalDown){
            // Supporting liquid/floor contacts arrest downward motion; they do
            // not turn falling momentum into a new upward launch. Use the
            // supported displacement directly, avoiding hidden falling speed
            // inside a stationary packed layer. Spoon-driven rising remains free.
            const gravity2=gravity.x*gravity.x+gravity.y*gravity.y+gravity.z*gravity.z;
            if(gravity2>1e-8){const currentDown=ps.vx[i]*gravity.x+ps.vy[i]*gravity.y+ps.vz[i]*gravity.z,k=(Math.max(0,projectedDown)-currentDown)/gravity2;ps.vx[i]+=gravity.x*k;ps.vy[i]+=gravity.y*k;if(!planar)ps.vz[i]+=gravity.z*k;}
          }
        }
      }
    }
    this.cachePs=null;
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

