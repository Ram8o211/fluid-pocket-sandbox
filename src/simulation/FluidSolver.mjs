import { Phase } from './Phase.mjs';
import { clamp } from './math.mjs';
import { stratificationImpulse } from './DensityStratification.mjs';

export class FluidSolver {
  constructor(){this.neighborRadius=.48;this.restDistance=.26;}
  step(ps,grid,gravity,env,rules,dt,iterations=2){
    const maxV=env.maxVelocity,planar=env.dimensionMode==='2D';
    for(let i=0;i<ps.count;i++){
      ps.px[i]=ps.x[i];ps.py[i]=ps.y[i];ps.pz[i]=ps.z[i];
      if(ps.phase[i]!==Phase.GAS){ps.vx[i]+=gravity.x*dt;ps.vy[i]+=gravity.y*dt;if(!planar)ps.vz[i]+=gravity.z*dt;}else if(planar)ps.vz[i]=0;
      const freezing=ps.phase[i]===Phase.LIQUID&&ps.temperature[i]<ps.meltingTemperature[i]-ps.phaseHysteresis[i]?clamp(ps.phaseProgress[i],0,1):0;
      let damping;
      if(ps.phase[i]===Phase.LIQUID)damping=Math.exp(-ps.viscosity[i]*dt*3.5-dt*freezing*5);
      else if(ps.phase[i]===Phase.SOLID)damping=Math.exp(-dt*(.18+1.1*ps.solidSubdivision[i]));
      else damping=Math.exp(-dt*.15);
      ps.vx[i]*=damping;ps.vy[i]*=damping;ps.vz[i]*=damping;
      const speed=planar?Math.hypot(ps.vx[i],ps.vy[i]):Math.hypot(ps.vx[i],ps.vy[i],ps.vz[i]);if(speed>maxV){const k=maxV/speed;ps.vx[i]*=k;ps.vy[i]*=k;if(!planar)ps.vz[i]*=k;}
      ps.x[i]+=ps.vx[i]*dt;ps.y[i]+=ps.vy[i]*dt;if(planar){ps.z[i]=0;ps.vz[i]=0;}else ps.z[i]+=ps.vz[i]*dt;
    }
    this.collideBox(ps,env.box,planar);
    for(let it=0;it<iterations;it++){
      grid.rebuild(ps,env.box);
      for(let i=0;i<ps.count;i++){
        let gasCount=0;
        grid.forEachNeighbor(ps,i,this.neighborRadius,(j)=>{
          const dx=ps.x[j]-ps.x[i],dy=ps.y[j]-ps.y[i],dz=planar?0:ps.z[j]-ps.z[i],d=planar?Math.hypot(dx,dy):Math.hypot(dx,dy,dz);if(d<=1e-6||d>this.neighborRadius)return;
          if(ps.phase[i]===Phase.GAS&&ps.phase[j]===Phase.GAS)gasCount++;
          const nx=dx/d,ny=dy/d,nz=planar?0:dz/d;
          if(ps.phase[i]===Phase.GAS){const spread=(1-d/this.neighborRadius)*(.018+.025*ps.compressibility[i]);ps.x[i]-=nx*spread;ps.y[i]-=ny*spread;ps.z[i]-=nz*spread;return;}

          if(ps.phase[i]===Phase.SOLID){
            if(ps.phase[j]===Phase.GAS)return;
            const target=this.restDistance*(ps.solidSubdivision[i]>.55?.92:.88);
            if(d<target){
              const q=(target-d)/target,rep=q*q*(.022+.024*ps.solidSubdivision[i]);ps.x[i]-=nx*rep;ps.y[i]-=ny*rep;if(!planar)ps.z[i]-=nz*rep;
            }
            // Granular solids dissipate relative tangential motion only while in contact.
            // There is deliberately no attractive solid-wall/solid-solid cohesion term.
            if(ps.phase[j]===Phase.SOLID&&ps.solidSubdivision[i]>.45&&d<target*1.18){
              const friction=clamp((.02+.1*ps.solidSubdivision[i])*(1-d/(target*1.18)),0,.12);
              ps.vx[i]+=(ps.vx[j]-ps.vx[i])*friction;ps.vy[i]+=(ps.vy[j]-ps.vy[i])*friction;if(!planar)ps.vz[i]+=(ps.vz[j]-ps.vz[i])*friction;
            }
            return;
          }

          if(ps.phase[j]!==Phase.GAS){
            const freezing=ps.temperature[i]<ps.meltingTemperature[i]-ps.phaseHysteresis[i]?clamp(ps.phaseProgress[i],0,1):0;
            const mobility=1-freezing*.62,target=this.restDistance;
            if(d<target){const q=(target-d)/target,rep=q*q*(.018+.03*(1-ps.viscosity[i]))*mobility;ps.x[i]-=nx*rep;ps.y[i]-=ny*rep;ps.z[i]-=nz*rep;}
            else if(d<target*1.6&&ps.phase[j]===Phase.LIQUID){const pull=(d-target)/(target*.6)*ps.cohesion[i]*.0025*mobility;ps.x[i]+=nx*pull;ps.y[i]+=ny*pull;ps.z[i]+=nz*pull;}
            if(ps.materialId[i]!==ps.materialId[j]&&Math.abs(ps.miscibility[i]-ps.miscibility[j])>=rules.miscibilityThreshold){const imp=stratificationImpulse(ps.density[i],ps.density[j],gravity,.0015*mobility);ps.x[i]+=imp.x;ps.y[i]+=imp.y;ps.z[i]+=imp.z;}
          }
        });
        ps.localGasDensity[i]=ps.phase[i]===Phase.GAS?clamp(.18+gasCount*.075,0,1.8):0;
      }
      this.collideBox(ps,env.box,planar);
    }
    for(let i=0;i<ps.count;i++){
      const rx=(ps.x[i]-ps.px[i])/dt,ry=(ps.y[i]-ps.py[i])/dt,rz=planar?0:(ps.z[i]-ps.pz[i])/dt;
      if(ps.phase[i]===Phase.SOLID){
        // Keep integrated gravity/inertia dominant. Constraint corrections should never
        // become a source of upward or wall-tangential momentum.
        const share=.04+.04*(1-ps.solidSubdivision[i]);
        ps.vx[i]=ps.vx[i]*(1-share)+rx*share;ps.vy[i]=ps.vy[i]*(1-share)+ry*share;ps.vz[i]=planar?0:ps.vz[i]*(1-share)+rz*share;
      }else{
        const freezing=ps.phase[i]===Phase.LIQUID&&ps.temperature[i]<ps.meltingTemperature[i]-ps.phaseHysteresis[i]?clamp(ps.phaseProgress[i],0,1):0;
        const physicalShare=freezing*.7;ps.vx[i]=rx*(1-physicalShare)+ps.vx[i]*physicalShare;ps.vy[i]=ry*(1-physicalShare)+ps.vy[i]*physicalShare;ps.vz[i]=planar?0:rz*(1-physicalShare)+ps.vz[i]*physicalShare;
      }
    }
  }
  collideBox(ps,box,planar=false){
    const pad=.08,hx=box.width/2-pad,hy=box.height/2-pad,hz=box.depth/2-pad;
    for(let i=0;i<ps.count;i++){
      const solid=ps.phase[i]===Phase.SOLID,granular=solid&&ps.solidSubdivision[i]>.45,restitution=solid?(granular?.025:.04):.08,tangent=solid?(granular?.48:.76):.92;
      let hitX=false,hitY=false,hitZ=false;
      if(ps.x[i]<-hx){ps.x[i]=-hx;if(ps.vx[i]<0)ps.vx[i]=-ps.vx[i]*restitution;hitX=true;}else if(ps.x[i]>hx){ps.x[i]=hx;if(ps.vx[i]>0)ps.vx[i]=-ps.vx[i]*restitution;hitX=true;}
      if(ps.y[i]<-hy){ps.y[i]=-hy;if(ps.vy[i]<0)ps.vy[i]=-ps.vy[i]*restitution;hitY=true;}else if(ps.y[i]>hy){ps.y[i]=hy;if(ps.vy[i]>0)ps.vy[i]=-ps.vy[i]*restitution;hitY=true;}
      if(planar){ps.z[i]=0;ps.vz[i]=0;}else if(ps.z[i]<-hz){ps.z[i]=-hz;if(ps.vz[i]<0)ps.vz[i]=-ps.vz[i]*restitution;hitZ=true;}else if(ps.z[i]>hz){ps.z[i]=hz;if(ps.vz[i]>0)ps.vz[i]=-ps.vz[i]*restitution;hitZ=true;}
      if(hitX){ps.vy[i]*=tangent;ps.vz[i]*=tangent;}if(hitY){ps.vx[i]*=tangent;ps.vz[i]*=tangent;if(granular&&Math.abs(ps.vy[i])<.18)ps.vy[i]=0;}if(hitZ){ps.vx[i]*=tangent;ps.vy[i]*=tangent;}
    }
  }
}
