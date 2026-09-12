import { Phase } from './Phase.mjs';
import { clamp } from './math.mjs';

const BODY_JOIN_RADIUS=.62;
const LATTICE_SPACING=.26;
function quantized(value,spacing){return Math.round(value/spacing)*spacing;}

export class SolidSolver{
  constructor(){this.nextBodyId=1;this.bodyOrigins=new Map();}
  reset(){this.nextBodyId=1;this.bodyOrigins.clear();}
  onMelt(ps,i){ps.solidSubdivision[i]=Math.min(ps.solidSubdivision[i],.08);ps.solidBodyId[i]=0;ps.solidLocalX[i]=ps.solidLocalY[i]=ps.solidLocalZ[i]=0;}
  initializeParticle(ps,i,planar=false,grid=null){
    if(ps.phase[i]!==Phase.SOLID)return 0;
    if(ps.solidSubdivision[i]>=.55){ps.solidBodyId[i]=0;ps.solidLocalX[i]=ps.solidLocalY[i]=ps.solidLocalZ[i]=0;return 0;}
    let bodyId=0,nearest=Infinity;
    const inspect=j=>{if(j===i||ps.phase[j]!==Phase.SOLID||ps.solidBodyId[j]<=0||ps.materialId[j]!==ps.materialId[i])return;const dx=ps.x[j]-ps.x[i],dy=ps.y[j]-ps.y[i],dz=planar?0:ps.z[j]-ps.z[i],d2=dx*dx+dy*dy+dz*dz;if(d2<BODY_JOIN_RADIUS*BODY_JOIN_RADIUS&&d2<nearest){bodyId=ps.solidBodyId[j];nearest=d2;}};
    if(grid&&ps.cell[i]>=0)grid.forEachNeighbor(ps,i,BODY_JOIN_RADIUS,inspect);else for(let j=0;j<ps.count;j++)inspect(j);
    if(!bodyId){bodyId=this.nextBodyId++;this.bodyOrigins.set(bodyId,{x:ps.x[i],y:ps.y[i],z:planar?0:ps.z[i]});}
    let origin=this.bodyOrigins.get(bodyId);
    if(!origin){let found=-1;for(let k=0;k<ps.count;k++)if(ps.solidBodyId[k]===bodyId){found=k;break;}origin=found<0?{x:ps.x[i],y:ps.y[i],z:planar?0:ps.z[i]}:{x:ps.x[found]-ps.solidLocalX[found],y:ps.y[found]-ps.solidLocalY[found],z:planar?0:ps.z[found]-ps.solidLocalZ[found]};this.bodyOrigins.set(bodyId,origin);}
    ps.solidBodyId[i]=bodyId;
    const rawX=ps.x[i]-origin.x,rawY=ps.y[i]-origin.y,rawZ=planar?0:ps.z[i]-origin.z,crystal=clamp(ps.crystallinity[i],0,1)*.88;
    ps.solidLocalX[i]=rawX+(quantized(rawX,LATTICE_SPACING)-rawX)*crystal;ps.solidLocalY[i]=rawY+(quantized(rawY,LATTICE_SPACING)-rawY)*crystal;ps.solidLocalZ[i]=planar?0:rawZ+(quantized(rawZ,LATTICE_SPACING)-rawZ)*crystal;
    return bodyId;
  }
  step(ps,grid,env,dt){
    const planar=env.dimensionMode==='2D',groups=new Map();
    for(let i=0;i<ps.count;i++){
      if(ps.phase[i]!==Phase.SOLID)continue;
      if(ps.solidSubdivision[i]<.55&&ps.solidBodyId[i]<=0)this.initializeParticle(ps,i,planar,grid);
      const id=ps.solidBodyId[i];if(id>0){let g=groups.get(id);if(!g){g=[];groups.set(id,g);}g.push(i);}else this.settleGranularParticle(ps,grid,i,env,dt,planar);
    }
    for(const indices of groups.values()){
      if(!indices.length)continue;let cx=0,cy=0,cz=0,lvx=0,lvy=0,lvz=0,lx=0,ly=0,lz=0,rigid=0;
      for(const i of indices){cx+=ps.x[i];cy+=ps.y[i];cz+=ps.z[i];lvx+=ps.vx[i];lvy+=ps.vy[i];lvz+=ps.vz[i];lx+=ps.solidLocalX[i];ly+=ps.solidLocalY[i];lz+=ps.solidLocalZ[i];rigid+=1-ps.solidSubdivision[i];}
      const n=indices.length;cx/=n;cy/=n;cz/=n;lvx/=n;lvy/=n;lvz/=n;lx/=n;ly/=n;lz/=n;rigid=clamp(rigid/n,0,1);
      const shapeStrength=clamp((.18+.62*rigid)*dt*30,0,.72),velocityLock=clamp((2+10*rigid)*dt,0,.48);
      for(const i of indices){const tx=cx+(ps.solidLocalX[i]-lx),ty=cy+(ps.solidLocalY[i]-ly),tz=planar?0:cz+(ps.solidLocalZ[i]-lz);ps.x[i]+=(tx-ps.x[i])*shapeStrength;ps.y[i]+=(ty-ps.y[i])*shapeStrength;if(planar)ps.z[i]=0;else ps.z[i]+=(tz-ps.z[i])*shapeStrength;ps.vx[i]+=(lvx-ps.vx[i])*velocityLock;ps.vy[i]+=(lvy-ps.vy[i])*velocityLock;if(planar)ps.vz[i]=0;else ps.vz[i]+=(lvz-ps.vz[i])*velocityLock;}
    }
  }
  settleGranularParticle(ps,grid,i,env,dt,planar){
    const subdivision=ps.solidSubdivision[i],friction=clamp(.15+.72*subdivision,0,1),radius=.34;let contacts=0;
    grid.forEachNeighbor(ps,i,radius,j=>{if(ps.phase[j]!==Phase.SOLID||ps.solidSubdivision[j]<.42)return;const dx=ps.x[j]-ps.x[i],dy=ps.y[j]-ps.y[i],dz=planar?0:ps.z[j]-ps.z[i],d=Math.hypot(dx,dy,dz);if(d>.31||d<1e-6)return;contacts++;const lock=clamp(friction*dt*5.5,0,.22);ps.vx[i]+=(ps.vx[j]-ps.vx[i])*lock;ps.vy[i]+=(ps.vy[j]-ps.vy[i])*lock;if(!planar)ps.vz[i]+=(ps.vz[j]-ps.vz[i])*lock;});
    const floor=-env.box.height/2+.14;if(ps.y[i]<=floor+.03||contacts>=2){const damp=Math.exp(-dt*(5+13*friction));ps.vx[i]*=damp;if(!planar)ps.vz[i]*=damp;if(Math.abs(ps.vy[i])<.24+.25*friction)ps.vy[i]=0;}
  }
}
