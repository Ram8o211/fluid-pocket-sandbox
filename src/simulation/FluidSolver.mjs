import { Phase } from './Phase.mjs';
import { clamp } from './math.mjs';
import { stratificationImpulse } from './DensityStratification.mjs';
export class FluidSolver {
  constructor(){this.neighborRadius=.48;this.restDistance=.26;}
  step(ps,grid,gravity,env,rules,dt,iterations=2){
    const maxV=env.maxVelocity;
    for(let i=0;i<ps.count;i++){
      ps.px[i]=ps.x[i];ps.py[i]=ps.y[i];ps.pz[i]=ps.z[i];
      if(ps.phase[i]!==Phase.GAS){ps.vx[i]+=gravity.x*dt;ps.vy[i]+=gravity.y*dt;ps.vz[i]+=gravity.z*dt;}
      const damping=ps.phase[i]===Phase.LIQUID?Math.exp(-ps.viscosity[i]*dt*3.5):(ps.phase[i]===Phase.SOLID?Math.exp(-dt*10):Math.exp(-dt*.15));ps.vx[i]*=damping;ps.vy[i]*=damping;ps.vz[i]*=damping;
      const speed=Math.hypot(ps.vx[i],ps.vy[i],ps.vz[i]);if(speed>maxV){const k=maxV/speed;ps.vx[i]*=k;ps.vy[i]*=k;ps.vz[i]*=k;}
      ps.x[i]+=ps.vx[i]*dt;ps.y[i]+=ps.vy[i]*dt;ps.z[i]+=ps.vz[i]*dt;
    }
    this.collideBox(ps,env.box);
    for(let it=0;it<iterations;it++){
      grid.rebuild(ps,env.box);
      for(let i=0;i<ps.count;i++){
        let localCount=0,gasCount=0;
        grid.forEachNeighbor(ps,i,this.neighborRadius,(j)=>{
          const dx=ps.x[j]-ps.x[i],dy=ps.y[j]-ps.y[i],dz=ps.z[j]-ps.z[i],d=Math.hypot(dx,dy,dz);if(d<=1e-6||d>this.neighborRadius)return;localCount++;
          if(ps.phase[i]===Phase.GAS&&ps.phase[j]===Phase.GAS)gasCount++;
          const nx=dx/d,ny=dy/d,nz=dz/d;
          if(ps.phase[i]===Phase.GAS){ const spread=(1-d/this.neighborRadius)*(.018+.025*ps.compressibility[i]);ps.x[i]-=nx*spread;ps.y[i]-=ny*spread;ps.z[i]-=nz*spread;return; }
          if(ps.phase[i]===Phase.SOLID){ const target=this.restDistance*.88,err=d-target;if(Math.abs(err)<.16){const stiffness=.025+.07*ps.cohesion[i];ps.x[i]+=nx*err*stiffness;ps.y[i]+=ny*err*stiffness;ps.z[i]+=nz*err*stiffness;}return; }
          if(ps.phase[j]!==Phase.GAS){ const target=this.restDistance; if(d<target){const q=(target-d)/target,rep=q*q*(.018+.03*(1-ps.viscosity[i]));ps.x[i]-=nx*rep;ps.y[i]-=ny*rep;ps.z[i]-=nz*rep;} else if(d<target*1.6){const pull=(d-target)/(target*.6)*ps.cohesion[i]*.0025;ps.x[i]+=nx*pull;ps.y[i]+=ny*pull;ps.z[i]+=nz*pull;}
            if(ps.materialId[i]!==ps.materialId[j]&&Math.abs(ps.miscibility[i]-ps.miscibility[j])>=rules.miscibilityThreshold){ const imp=stratificationImpulse(ps.density[i],ps.density[j],gravity,.0015);ps.x[i]+=imp.x;ps.y[i]+=imp.y;ps.z[i]+=imp.z; }
          }
        });
        ps.localGasDensity[i]=ps.phase[i]===Phase.GAS?clamp(.18+gasCount*.075,0,1.8):0;
      }
      this.collideBox(ps,env.box);
    }
    for(let i=0;i<ps.count;i++){ ps.vx[i]=(ps.x[i]-ps.px[i])/dt;ps.vy[i]=(ps.y[i]-ps.py[i])/dt;ps.vz[i]=(ps.z[i]-ps.pz[i])/dt; }
  }
  collideBox(ps,box){const pad=.08,hx=box.width/2-pad,hy=box.height/2-pad,hz=box.depth/2-pad;for(let i=0;i<ps.count;i++){let hit=false;if(ps.x[i]<-hx){ps.x[i]=-hx;hit=true;}else if(ps.x[i]>hx){ps.x[i]=hx;hit=true;}if(ps.y[i]<-hy){ps.y[i]=-hy;hit=true;}else if(ps.y[i]>hy){ps.y[i]=hy;hit=true;}if(ps.z[i]<-hz){ps.z[i]=-hz;hit=true;}else if(ps.z[i]>hz){ps.z[i]=hz;hit=true;}if(hit){ps.vx[i]*=-.16;ps.vy[i]*=-.16;ps.vz[i]*=-.16;}}
  }
}
