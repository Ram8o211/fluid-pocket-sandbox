import { Phase } from './Phase.mjs';
import { clamp, hexToRgb, rgbToHex } from './math.mjs';
import { sanitizeMaterial } from '../materials/MaterialDefinition.mjs';

function hash32(...values){
  let h=2166136261>>>0;
  for(const value of values){
    const s=String(value);
    for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  }
  h^=h>>>16;h=Math.imul(h,0x7feb352d)>>>0;h^=h>>>15;h=Math.imul(h,0x846ca68b)>>>0;h^=h>>>16;
  return h>>>0;
}
function rngFrom(seed){let a=seed>>>0;return()=>{a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
function mix(a,b,t){return a+(b-a)*t;}
function colorShift(color,target,t){const a=hexToRgb(color),b=hexToRgb(target);return rgbToHex(mix(a[0],b[0],t),mix(a[1],b[1],t),mix(a[2],b[2],t));}

export function combustionProductCount(material){
  return 2+(hash32(material.seed,material.id,material.density.toFixed(3),material.volatility.toFixed(3))&1);
}

export function deriveCombustionProducts(material,allocateId){
  const seed=hash32(material.seed,material.id,material.color,material.combustionTemperature.toFixed(3));
  const rng=rngFrom(seed),count=combustionProductCount(material),weights=[];
  for(let i=0;i<count;i++)weights.push(.35+rng());
  const total=weights.reduce((a,b)=>a+b,0),fractions=weights.map(v=>v/total);
  const common={
    sourceMaterialIds:[...(material.sourceMaterialIds||[material.id])],combustionParentId:material.id,
    emergent:true,reusable:false,generation:(material.generation||0)+1,combustionTemperature:1.4
  };
  const residue=sanitizeMaterial({...material,...common,id:allocateId(),seed:hash32(seed,0),name:`${material.name} residue`.slice(0,40),
    color:colorShift(material.color,'#352d2a',.62),opacity:clamp(material.opacity+.12,.08,1),density:clamp(material.density*(1.08+.18*rng()),.35,1.65),
    viscosity:clamp(material.viscosity*.65,.02,1),cohesion:clamp(material.cohesion+.15,0,1),miscibility:clamp(material.miscibility*.72,0,1),
    heatCapacity:clamp(material.heatCapacity*(.85+.2*rng()),.15,1),thermalConductivity:clamp(material.thermalConductivity*(.9+.25*rng()),.02,1),
    meltingTemperature:clamp(material.meltingTemperature*(1.02+.25*rng()),.05,.75),boilingTemperature:clamp(Math.max(material.boilingTemperature,.72+.18*rng()),.35,1.05),
    volatility:clamp(material.volatility*.18,0,1),reactionPotential:clamp(material.reactionPotential*.35,-1,1),reactionHeat:0,
    compressibility:clamp(material.compressibility*.45,.1,1),crystallinity:clamp(.35+.5*material.crystallinity,0,1),solidSubdivision:clamp(material.solidSubdivision*.42,0,1),
    electricalConductivity:clamp(material.electricalConductivity*(.65+.25*rng()),0,1),electricPotential:clamp(material.electricPotential*.45,-1,1),combustionProductIndex:0
  });
  const vapor=sanitizeMaterial({...material,...common,id:allocateId(),seed:hash32(seed,1),name:`${material.name} vapor`.slice(0,40),
    color:colorShift(material.color,'#d8e4ec',.58),opacity:clamp(material.opacity*(.24+.18*rng()),.08,1),density:clamp(material.density*(.35+.14*rng()),.35,1.65),
    viscosity:clamp(.03+material.viscosity*.12,.02,1),cohesion:clamp(material.cohesion*.18,0,1),miscibility:clamp(.45+material.miscibility*.42,0,1),
    heatCapacity:clamp(material.heatCapacity*(.62+.2*rng()),.15,1),thermalConductivity:clamp(material.thermalConductivity*(.55+.25*rng()),.02,1),
    meltingTemperature:clamp(material.meltingTemperature*.35,.05,.75),boilingTemperature:clamp(Math.max(.35,material.boilingTemperature*(.5+.2*rng())),.35,1.05),
    volatility:clamp(.72+.25*rng(),0,1),reactionPotential:clamp(-material.reactionPotential*.28,-1,1),reactionHeat:0,
    compressibility:clamp(.72+.24*rng(),.1,1),crystallinity:0,solidSubdivision:1,electricalConductivity:clamp(material.electricalConductivity*.16,0,1),electricPotential:clamp(-material.electricPotential*.25,-1,1),combustionProductIndex:1
  });
  const products=[{material:residue,fraction:fractions[0]},{material:vapor,fraction:fractions[1]}];
  if(count===3){
    const byproduct=sanitizeMaterial({...material,...common,id:allocateId(),seed:hash32(seed,2),name:`${material.name} byproduct`.slice(0,40),
      color:colorShift(material.color,'#8a6d55',.42),opacity:clamp(material.opacity*(.55+.25*rng()),.08,1),density:clamp(material.density*(.72+.25*rng()),.35,1.65),
      viscosity:clamp(material.viscosity*(.45+.3*rng()),.02,1),cohesion:clamp(material.cohesion*(.55+.25*rng()),0,1),miscibility:clamp(material.miscibility*(.55+.3*rng()),0,1),
      heatCapacity:clamp(material.heatCapacity*(.72+.2*rng()),.15,1),thermalConductivity:clamp(material.thermalConductivity*(.72+.2*rng()),.02,1),
      meltingTemperature:clamp(material.meltingTemperature*(.72+.2*rng()),.05,.75),boilingTemperature:clamp(material.boilingTemperature*(.76+.18*rng()),.35,1.05),
      volatility:clamp(material.volatility*(.42+.25*rng()),0,1),reactionPotential:clamp(material.reactionPotential*.18,-1,1),reactionHeat:0,
      compressibility:clamp(material.compressibility*(.68+.2*rng()),.1,1),crystallinity:clamp(material.crystallinity*.35,0,1),solidSubdivision:clamp(.35+.4*material.solidSubdivision,0,1),
      electricalConductivity:clamp(material.electricalConductivity*(.35+.25*rng()),0,1),electricPotential:clamp(material.electricPotential*.2,-1,1),combustionProductIndex:2
    });
    products.push({material:byproduct,fraction:fractions[2]});
  }
  return products;
}

export function phaseForMaterialAtTemperature(material,temp){
  const h=material.phaseTransitionHysteresis||.02;
  if(temp<material.meltingTemperature-h)return Phase.SOLID;
  if(temp>material.boilingTemperature+h)return Phase.GAS;
  return Phase.LIQUID;
}

export class CombustionSolver{
  constructor(){this.events=0;this.massConsumed=0;this.lastProducts=[];}
  resetFrame(){this.events=0;this.massConsumed=0;this.lastProducts=[];}
  step(ps,grid,materials,rules,env,dt,getProducts,onSolidCreated,pushEvent){
    this.resetFrame();const initialCount=ps.count,planar=env.dimensionMode==='2D';
    for(let i=initialCount-1;i>=0;i--){
      const threshold=ps.combustionTemperature[i];
      if(!Number.isFinite(threshold)||ps.temperature[i]<threshold){ps.combustionProgress[i]=Math.max(0,ps.combustionProgress[i]-dt*.8);continue;}
      const excess=clamp((ps.temperature[i]-threshold)/Math.max(.08,1.2-threshold),0,1),rate=(.55+1.45*ps.volatility[i])*(.42+.58*excess)*(rules.combustionRate??1);
      ps.combustionProgress[i]=clamp(ps.combustionProgress[i]+dt*rate,0,1);
      const heatPower=(.14+.2*ps.volatility[i]+.08*Math.abs(ps.reactionPotential[i]))*(rules.combustionHeatScale??1);
      const heat=heatPower*dt*(.45+.55*excess);
      ps.temperature[i]=clamp(ps.temperature[i]+heat/Math.max(.15,ps.heatCapacity[i]),0,1.2);
      grid.forEachNeighbor(ps,i,.62,j=>{const dx=ps.x[j]-ps.x[i],dy=ps.y[j]-ps.y[i],dz=planar?0:ps.z[j]-ps.z[i],d=Math.hypot(dx,dy,dz);if(d>.62)return;const w=1-d/.62;ps.temperature[j]=clamp(ps.temperature[j]+heat*w*.34/Math.max(.15,ps.heatCapacity[j]),0,1.2);});
      if(ps.combustionProgress[i]<1)continue;
      const parent=materials.get(ps.materialId[i]);if(!parent){ps.combustionProgress[i]=0;continue;}
      const products=getProducts(parent);if(!products?.length){ps.combustionProgress[i]=0;continue;}
      // A combustion event is atomic: do not consume the parent unless every deterministic daughter
      // product can be represented. This keeps the 2/3-product invariant and exact mass conservation
      // even when the fixed particle pool is temporarily full.
      if(ps.count+products.length-1>ps.capacity){ps.combustionProgress[i]=1;continue;}
      const originalMass=ps.mass[i],x=ps.x[i],y=ps.y[i],z=planar?0:ps.z[i],vx=ps.vx[i],vy=ps.vy[i],vz=planar?0:ps.vz[i],temp=clamp(ps.temperature[i]+(.035+.055*ps.volatility[i]),0,1.2);
      const produceCount=products.length;let assignedMass=0;
      for(let p=0;p<produceCount;p++){
        const def=products[p],fraction=p===produceCount-1?1-assignedMass/originalMass:def.fraction,mass=Math.max(1e-8,originalMass*fraction);assignedMass+=mass;
        const phase=phaseForMaterialAtTemperature(def.material,temp),angle=(i*2.399963+p*2.094395),spread=.055+.025*p,px=x+Math.cos(angle)*spread,py=y+Math.sin(angle)*spread,pz=planar?0:z+Math.sin(angle*.73)*spread;
        let index;
        if(p===0){index=i;ps.assignMaterial(index,def.material,phase,temp);ps.mass[index]=mass;ps.x[index]=px;ps.y[index]=py;ps.z[index]=pz;ps.px[index]=px;ps.py[index]=py;ps.pz[index]=pz;ps.vx[index]=vx;ps.vy[index]=vy;ps.vz[index]=vz;}
        else index=ps.add({x:px,y:py,z:pz,vx,vy,vz,mass,temperature:temp},def.material,phase);
        if(index>=0&&phase===Phase.SOLID)onSolidCreated?.(index,planar);
      }
      this.events++;this.massConsumed+=originalMass;this.lastProducts=products.map(p=>p.material.id);pushEvent?.(x,y,z,clamp(.55+.45*excess,0,1),1);
    }
  }
}
