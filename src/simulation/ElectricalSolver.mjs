import { clamp } from './math.mjs';

const CONTACT_RADIUS=.56;
const FORCE_RADIUS=1.45;

export function conductionFraction(conductivityA,conductivityB,rate,dt){
  const a=Math.max(0,conductivityA),b=Math.max(0,conductivityB);
  if(a<=0||b<=0||rate<=0||dt<=0)return 0;
  const interfaceConductivity=2*a*b/Math.max(1e-6,a+b);
  return clamp(1-Math.exp(-interfaceConductivity*rate*dt*8),0,1);
}

export function electrostaticPairImpulse(potentialA,potentialB,distance,strength,dt){
  const product=potentialA*potentialB,absProduct=Math.abs(product);
  if(absProduct<1e-4||distance<=1e-6||distance>=FORCE_RADIUS||strength<=0||dt<=0)return 0;
  const falloff=1-distance/FORCE_RADIUS;
  const direction=product<0?1:-1; // opposite signs attract, equal signs repel
  return direction*Math.min(.22,strength*absProduct*falloff*falloff*dt);
}

export function updateElectrical(ps,grid,rules,dt){
  const rate=Math.max(0,rules.electricalConductionRate??2.2),joule=Math.max(0,rules.jouleHeating??.025),forceStrength=Math.max(0,rules.electrostaticStrength??2.4);
  const dense=ps.count>1800,massive=ps.count>3500,forceRadius=massive?.58:(dense?1.0:FORCE_RADIUS);
  const x=ps.x,y=ps.y,z=ps.z,vx=ps.vx,vy=ps.vy,vz=ps.vz,conductivity=ps.electricalConductivity,potential=ps.electricPotential,temp=ps.temperature,heatCapacity=ps.heatCapacity,mass=ps.mass;
  grid.forEachPair(ps,forceRadius,(i,j)=>{
    const dx=x[j]-x[i],dy=y[j]-y[i],dz=z[j]-z[i],d2=dx*dx+dy*dy+dz*dz;if(d2<=1e-10)return;const d=Math.sqrt(d2);
    if(d<=CONTACT_RADIUS){
      const f=conductionFraction(conductivity[i],conductivity[j],rate,dt);
      if(f>0){
        const mi=Math.max(.05,mass[i]),mj=Math.max(.05,mass[j]),total=mi+mj,vi=potential[i],vj=potential[j],eq=(vi*mi+vj*mj)/total;
        potential[i]=clamp(vi+(eq-vi)*f,-1,1);potential[j]=clamp(vj+(eq-vj)*f,-1,1);
        const removed=Math.abs(vj-vi)*f,heat=removed*removed*joule*Math.sqrt(Math.max(0,conductivity[i]*conductivity[j]));
        if(heat>0){temp[i]=clamp(temp[i]+heat/Math.max(.15,heatCapacity[i]*mi),0,1.2);temp[j]=clamp(temp[j]+heat/Math.max(.15,heatCapacity[j]*mj),0,1.2);}
      }
    }
    const impulse=d<forceRadius?electrostaticPairImpulse(potential[i],potential[j],d,forceStrength*(FORCE_RADIUS/forceRadius),dt):0;if(impulse===0)return;
    const nx=dx/d,ny=dy/d,nz=dz/d,mi=Math.max(.05,mass[i]),mj=Math.max(.05,mass[j]);
    vx[i]+=nx*impulse/mi;vy[i]+=ny*impulse/mi;vz[i]+=nz*impulse/mi;
    vx[j]-=nx*impulse/mj;vy[j]-=ny*impulse/mj;vz[j]-=nz*impulse/mj;
  });
}
