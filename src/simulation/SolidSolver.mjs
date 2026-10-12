import { Phase } from './Phase.mjs';
import { clamp } from './math.mjs';
import { effectiveParticleRadius, particlePairRestDistance } from './FluidSolver.mjs';
import { doughStrength } from './PowderSolver.mjs';

const BODY_JOIN_RADIUS=.62;
const LATTICE_SPACING=.34;
function quantized(value,spacing){return Math.round(value/spacing)*spacing;}

export class SolidSolver{
  constructor(){this.compactFreezing=false;this.nextBodyId=1;this.bodyOrigins=new Map();}
  reset(){this.nextBodyId=1;this.bodyOrigins.clear();}
  onMelt(ps,i){ps.powderContent[i]=0;ps.dissolutionProgress[i]=0;ps.solidSubdivision[i]=Math.min(ps.solidSubdivision[i],.08);ps.solidBodyId[i]=0;ps.solidLocalX[i]=ps.solidLocalY[i]=ps.solidLocalZ[i]=0;}
  initializeParticle(ps,i,planar=false,grid=null){
    if(ps.phase[i]!==Phase.SOLID)return 0;
    if(ps.solidSubdivision[i]>=.55){ps.solidBodyId[i]=0;ps.solidLocalX[i]=ps.solidLocalY[i]=ps.solidLocalZ[i]=0;return 0;}
    let bodyId=0,nearest=Infinity;
    const inspect=j=>{if(j===i||ps.phase[j]!==Phase.SOLID||ps.solidBodyId[j]<=0||ps.materialId[j]!==ps.materialId[i])return;const dx=ps.x[j]-ps.x[i],dy=ps.y[j]-ps.y[i],dz=planar?0:ps.z[j]-ps.z[i],d2=dx*dx+dy*dy+dz*dz;if(d2<(this.compactFreezing?.18*.18:BODY_JOIN_RADIUS*BODY_JOIN_RADIUS)&&d2<nearest){bodyId=ps.solidBodyId[j];nearest=d2;}};
    if(grid&&ps.cell[i]>=0)grid.forEachNeighbor(ps,i,BODY_JOIN_RADIUS,inspect);else for(let j=0;j<ps.count;j++)inspect(j);
    if(!bodyId){bodyId=this.nextBodyId++;this.bodyOrigins.set(bodyId,{x:ps.x[i],y:ps.y[i],z:planar?0:ps.z[i]});}
    let origin=this.bodyOrigins.get(bodyId);
    if(!origin){let found=-1;for(let k=0;k<ps.count;k++)if(ps.solidBodyId[k]===bodyId){found=k;break;}origin=found<0?{x:ps.x[i],y:ps.y[i],z:planar?0:ps.z[i]}:{x:ps.x[found]-ps.solidLocalX[found],y:ps.y[found]-ps.solidLocalY[found],z:planar?0:ps.z[found]-ps.solidLocalZ[found]};this.bodyOrigins.set(bodyId,origin);}
    ps.solidBodyId[i]=bodyId;
    const rawX=ps.x[i]-origin.x,rawY=ps.y[i]-origin.y,rawZ=planar?0:ps.z[i]-origin.z,crystal=this.compactFreezing?0:clamp(ps.crystallinity[i],0,1);
    ps.solidLocalX[i]=rawX+(quantized(rawX,LATTICE_SPACING)-rawX)*crystal;ps.solidLocalY[i]=rawY+(quantized(rawY,LATTICE_SPACING)-rawY)*crystal;ps.solidLocalZ[i]=planar?0:rawZ+(quantized(rawZ,LATTICE_SPACING)-rawZ)*crystal;
    return bodyId;
  }
  step(ps,grid,env,gravity,dt){
    const planar=env.dimensionMode==='2D',groups=new Map();
    for(let i=0;i<ps.count;i++){
      if(ps.phase[i]!==Phase.SOLID)continue;
      if(ps.solidSubdivision[i]<.55&&ps.solidBodyId[i]<=0)this.initializeParticle(ps,i,planar,grid);
      const id=ps.solidBodyId[i];if(id>0){let g=groups.get(id);if(!g){g=[];groups.set(id,g);}g.push(i);}else this.settleGranularParticle(ps,grid,i,env,gravity,dt,planar);
    }
    if(this.compactFreezing){
      // Weld only touching coherent solids. Remote islands and crushed powder
      // stay independent; preserve current offsets when two freeze fronts meet.
      const parent=new Map([...groups.keys()].map(id=>[id,id]));
      const root=id=>{while(parent.get(id)!==id)id=parent.get(id);return id;};
      grid.forEachPair(ps,.22,(i,j)=>{
        const a=ps.solidBodyId[i],b=ps.solidBodyId[j];
        if(ps.phase[i]!==Phase.SOLID||ps.phase[j]!==Phase.SOLID||!parent.has(a)||!parent.has(b)||ps.solidSubdivision[i]>=.55||ps.solidSubdivision[j]>=.55)return;
        if(Math.hypot(ps.x[i]-ps.x[j],ps.y[i]-ps.y[j],planar?0:ps.z[i]-ps.z[j])>.18)return;
        const ra=root(a),rb=root(b);if(ra!==rb)parent.set(rb,ra);
      });
      const merged=new Map();
      for(const [id,indices] of groups){const r=root(id);if(!merged.has(r))merged.set(r,[]);merged.get(r).push(...indices);}
      for(const [id,indices] of merged){
        if(indices.some(i=>ps.solidBodyId[i]!==id)){
          const first=indices[0],origin={x:ps.x[first],y:ps.y[first],z:planar?0:ps.z[first]};this.bodyOrigins.set(id,origin);
          for(const i of indices){ps.solidBodyId[i]=id;ps.solidLocalX[i]=ps.x[i]-origin.x;ps.solidLocalY[i]=ps.y[i]-origin.y;ps.solidLocalZ[i]=planar?0:ps.z[i]-origin.z;}
        }
      }
      groups.clear();for(const [id,indices] of merged)groups.set(id,indices);
    }
    for(const indices of groups.values()){
      if(!indices.length)continue;let cx=0,cy=0,cz=0,lvx=0,lvy=0,lvz=0,lx=0,ly=0,lz=0,rigid=0,crystal=0;
      for(const i of indices){cx+=ps.x[i];cy+=ps.y[i];cz+=ps.z[i];lvx+=ps.vx[i];lvy+=ps.vy[i];lvz+=ps.vz[i];lx+=ps.solidLocalX[i];ly+=ps.solidLocalY[i];lz+=ps.solidLocalZ[i];rigid+=1-ps.solidSubdivision[i];crystal+=ps.crystallinity[i];}
      const n=indices.length;cx/=n;cy/=n;cz/=n;lvx/=n;lvy/=n;lvz/=n;lx/=n;ly/=n;lz/=n;rigid=clamp(rigid/n,0,1);crystal=clamp(crystal/n,0,1);
      const shapeStrength=this.compactFreezing?1:clamp((.12+.55*rigid+.18*crystal)*dt*30,0,.78),velocityLock=this.compactFreezing?1:clamp((1.5+8*rigid)*dt,0,.4);
      for(const i of indices){const tx=cx+(ps.solidLocalX[i]-lx),ty=cy+(ps.solidLocalY[i]-ly),tz=planar?0:cz+(ps.solidLocalZ[i]-lz);ps.x[i]+=(tx-ps.x[i])*shapeStrength;ps.y[i]+=(ty-ps.y[i])*shapeStrength;if(planar)ps.z[i]=0;else ps.z[i]+=(tz-ps.z[i])*shapeStrength;ps.vx[i]+=(lvx-ps.vx[i])*velocityLock;ps.vy[i]+=(lvy-ps.vy[i])*velocityLock;if(planar)ps.vz[i]=0;else ps.vz[i]+=(lvz-ps.vz[i])*velocityLock;}
    }
  }
  wallSupports(ps,i,env,gravity,planar){
    const g=Math.hypot(gravity.x,gravity.y,planar?0:gravity.z)||1,gx=gravity.x/g,gy=gravity.y/g,gz=planar?0:gravity.z/g,m=.002,pad=clamp(effectiveParticleRadius(ps,i,planar)*.62,.05,.16),hx=env.box.width/2-pad,hy=env.box.height/2-pad,hz=env.box.depth/2-pad;
    if(gx<-.16&&ps.x[i]<=-hx+m)return true;if(gx>.16&&ps.x[i]>=hx-m)return true;if(gy<-.16&&ps.y[i]<=-hy+m)return true;if(gy>.16&&ps.y[i]>=hy-m)return true;if(!planar){if(gz<-.16&&ps.z[i]<=-hz+m)return true;if(gz>.16&&ps.z[i]>=hz-m)return true;}
    // The shop's actual bottom is a tapered polygon, not the engine box.
    return env.granularWallSupport?.(ps,i,gravity)??false;
  }
  settleGranularParticle(ps,grid,i,env,gravity,dt,planar){
    // Sand is contact-supported granular matter, not a fluid with neighbour
    // viscosity. Unsupported grains retain gravity and freely fall; resting
    // grains use dry friction and move ONLY if their local slope exceeds the
    // angle of repose. No spring or neighbour velocity averaging is applied.
    const gLen=Math.hypot(gravity.x,gravity.y,planar?0:gravity.z);
    if(gLen<1e-8)return;
    const gx=gravity.x/gLen,gy=gravity.y/gLen,gz=planar?0:gravity.z/gLen;
    const powder=ps.powderContent[i],wet=doughStrength(powder),mu=.50+wet*.55;
    const onFloor=this.wallSupports(ps,i,env,gravity,planar);
    let braced=false,nearestSupport=-1,bestDot=0,contacts=0;
    const tangents=[];
    grid.forEachNeighbor(ps,i,.27,j=>{
      if(ps.phase[j]!==Phase.SOLID || ps.solidSubdivision[j]<.42)return;
      const dx=ps.x[j]-ps.x[i],dy=ps.y[j]-ps.y[i],dz=planar?0:ps.z[j]-ps.z[i],d=Math.hypot(dx,dy,dz);
      // Actual surface contact only. Never suspend a grain over empty space.
      if(d<1e-6||d>particlePairRestDistance(ps,i,j,planar)*1.035)return;
      const along=(dx*gx+dy*gy+dz*gz)/d;
      if(along<=.35)return;
      const neighborDown=ps.vx[j]*gx+ps.vy[j]*gy+(planar?0:ps.vz[j]*gz);
      // Transmit the load only from a resting grain or a wall-supported one.
      if(!this.wallSupports(ps,j,env,gravity,planar)&&Math.abs(neighborDown)>.13)return;
      contacts++;
      // Classify opposing contacts in the tangent plane perpendicular to
      // gravity, including the depth axis in 3D. Two braces from opposing
      // directions can hold a grain without an artificial avalanche.
      const tx=dx-along*d*gx,ty=dy-along*d*gy,tz=planar?0:dz-along*d*gz;
      const length=Math.hypot(tx,ty,tz);
      if(length>.012){
        for(const previous of tangents)
          if(tx*previous.x+ty*previous.y+tz*previous.z<-.35*length*previous.length)braced=true;
        tangents.push({x:tx,y:ty,z:tz,length});
      }
      if(along>bestDot){bestDot=along;nearestSupport=j;}
    });
    if(!onFloor&&contacts===0)return;
    // Remove downward impact momentum only when there is genuine support.
    // Upward spoon impulses and free-fall elsewhere remain unrestricted.
    const vg=ps.vx[i]*gx+ps.vy[i]*gy+(planar?0:ps.vz[i]*gz);
    if(vg>0){ps.vx[i]-=gx*vg;ps.vy[i]-=gy*vg;if(!planar)ps.vz[i]-=gz*vg;}
    // Static friction locks settled grains; otherwise contact friction bleeds
    // away tangential motion until another grain or the spoon disturbs them.
    const damp=Math.exp(-dt*(onFloor?19:11)*(1+wet*.65));
    const longitudinal=ps.vx[i]*gx+ps.vy[i]*gy+(planar?0:ps.vz[i]*gz);
    ps.vx[i]=longitudinal*gx+(ps.vx[i]-longitudinal*gx)*damp;
    ps.vy[i]=longitudinal*gy+(ps.vy[i]-longitudinal*gy)*damp;
    if(!planar)ps.vz[i]=longitudinal*gz+(ps.vz[i]-longitudinal*gz)*damp;

    // One off-centre contact cannot hold an arbitrarily steep sand wall.
    // The tangential component of gravity drives a small surface avalanche.
    // Two supports on opposite sides provide a stable packed arch.
    if(onFloor||nearestSupport<0||braced)return;
    const dx=ps.x[nearestSupport]-ps.x[i],dy=ps.y[nearestSupport]-ps.y[i],dz=planar?0:ps.z[nearestSupport]-ps.z[i];
    const d=Math.hypot(dx,dy,dz);if(d<1e-7)return;
    const nx=dx/d,ny=dy/d,nz=planar?0:dz/d;
    const normal=gx*nx+gy*ny+gz*nz;
    const tx=gx-normal*nx,ty=gy-normal*ny,tz=planar?0:gz-normal*nz;
    const tangential=Math.hypot(tx,ty,tz);
    const excess=tangential-mu*normal;
    if(excess<=0)return;
    const slide=excess*gLen*dt*.75/Math.max(tangential,1e-6);
    ps.vx[i]+=tx*slide;ps.vy[i]+=ty*slide;if(!planar)ps.vz[i]+=tz*slide;
  }}
