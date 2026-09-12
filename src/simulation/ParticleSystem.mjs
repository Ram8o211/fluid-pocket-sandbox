import { Phase } from './Phase.mjs';
import { clamp, hexToRgb } from './math.mjs';

const PARTICLE_ARRAYS=['x','y','z','px','py','pz','vx','vy','vz','temperature','density','baseDensity','mass','phaseProgress','localGasDensity','age','r','g','b','opacity','viscosity','cohesion','miscibility','particleRadius','heatCapacity','thermalConductivity','meltingTemperature','boilingTemperature','phaseHysteresis','volatility','reactionPotential','reactionHeat','compressibility','crystallinity','solidSubdivision','electricalConductivity','electricPotential','combustionTemperature','combustionProgress','solidLocalX','solidLocalY','solidLocalZ','materialId','phase','cell','solidBodyId'];

export class ParticleSystem {
  constructor(capacity=1800){
    this.capacity=capacity; this.count=0;
    this.x=new Float32Array(capacity);this.y=new Float32Array(capacity);this.z=new Float32Array(capacity);
    this.px=new Float32Array(capacity);this.py=new Float32Array(capacity);this.pz=new Float32Array(capacity);
    this.vx=new Float32Array(capacity);this.vy=new Float32Array(capacity);this.vz=new Float32Array(capacity);
    this.temperature=new Float32Array(capacity);this.density=new Float32Array(capacity);this.baseDensity=new Float32Array(capacity);this.mass=new Float32Array(capacity);
    this.phaseProgress=new Float32Array(capacity);this.localGasDensity=new Float32Array(capacity);this.age=new Float32Array(capacity);
    this.r=new Float32Array(capacity);this.g=new Float32Array(capacity);this.b=new Float32Array(capacity);this.opacity=new Float32Array(capacity);
    this.viscosity=new Float32Array(capacity);this.cohesion=new Float32Array(capacity);this.miscibility=new Float32Array(capacity);this.particleRadius=new Float32Array(capacity);this.heatCapacity=new Float32Array(capacity);this.thermalConductivity=new Float32Array(capacity);
    this.meltingTemperature=new Float32Array(capacity);this.boilingTemperature=new Float32Array(capacity);this.phaseHysteresis=new Float32Array(capacity);this.volatility=new Float32Array(capacity);this.reactionPotential=new Float32Array(capacity);this.reactionHeat=new Float32Array(capacity);this.compressibility=new Float32Array(capacity);
    this.crystallinity=new Float32Array(capacity);this.solidSubdivision=new Float32Array(capacity);this.electricalConductivity=new Float32Array(capacity);this.electricPotential=new Float32Array(capacity);this.combustionTemperature=new Float32Array(capacity);this.combustionProgress=new Float32Array(capacity);
    this.solidLocalX=new Float32Array(capacity);this.solidLocalY=new Float32Array(capacity);this.solidLocalZ=new Float32Array(capacity);
    this.materialId=new Int32Array(capacity);this.phase=new Int32Array(capacity);this.cell=new Int32Array(capacity);this.solidBodyId=new Int32Array(capacity);
  }
  add(p,material,phase=Number(Phase.LIQUID)){
    if(this.count>=this.capacity)return -1; const i=this.count++;
    this.x[i]=this.px[i]=p.x; this.y[i]=this.py[i]=p.y; this.z[i]=this.pz[i]=p.z;
    this.vx[i]=p.vx||0; this.vy[i]=p.vy||0; this.vz[i]=p.vz||0; this.mass[i]=p.mass||1;
    this.materialId[i]=material.id; this.temperature[i]=p.temperature??.33; this.phase[i]=phase; this.phaseProgress[i]=0;
    this.baseDensity[i]=material.density; this.density[i]=this.effectiveDensity(material,phase); const [r,g,b]=hexToRgb(material.color); this.r[i]=r;this.g[i]=g;this.b[i]=b;this.opacity[i]=material.opacity;
    this.viscosity[i]=material.viscosity;this.cohesion[i]=material.cohesion;this.miscibility[i]=material.miscibility;this.particleRadius[i]=material.particleRadius;this.heatCapacity[i]=material.heatCapacity;this.thermalConductivity[i]=material.thermalConductivity;
    this.meltingTemperature[i]=material.meltingTemperature;this.boilingTemperature[i]=material.boilingTemperature;this.phaseHysteresis[i]=material.phaseTransitionHysteresis;this.volatility[i]=material.volatility;this.reactionPotential[i]=material.reactionPotential;this.reactionHeat[i]=material.reactionHeat;this.compressibility[i]=material.compressibility;
    this.crystallinity[i]=material.crystallinity;this.solidSubdivision[i]=material.solidSubdivision;this.electricalConductivity[i]=material.electricalConductivity;this.electricPotential[i]=p.electricPotential??material.electricPotential;this.combustionTemperature[i]=material.combustionTemperature;this.combustionProgress[i]=0;
    this.solidBodyId[i]=0;this.solidLocalX[i]=this.solidLocalY[i]=this.solidLocalZ[i]=0;
    return i;
  }
  assignMaterial(i,material,phase=this.phase[i],temperature=this.temperature[i]){
    if(i<0||i>=this.count)return false;
    this.materialId[i]=material.id;this.temperature[i]=temperature;this.phase[i]=phase;this.phaseProgress[i]=0;this.combustionProgress[i]=0;
    this.baseDensity[i]=material.density;this.density[i]=this.effectiveDensity(material,phase);const [r,g,b]=hexToRgb(material.color);this.r[i]=r;this.g[i]=g;this.b[i]=b;this.opacity[i]=material.opacity;
    this.viscosity[i]=material.viscosity;this.cohesion[i]=material.cohesion;this.miscibility[i]=material.miscibility;this.particleRadius[i]=material.particleRadius;this.heatCapacity[i]=material.heatCapacity;this.thermalConductivity[i]=material.thermalConductivity;
    this.meltingTemperature[i]=material.meltingTemperature;this.boilingTemperature[i]=material.boilingTemperature;this.phaseHysteresis[i]=material.phaseTransitionHysteresis;this.volatility[i]=material.volatility;this.reactionPotential[i]=material.reactionPotential;this.reactionHeat[i]=material.reactionHeat;this.compressibility[i]=material.compressibility;
    this.crystallinity[i]=material.crystallinity;this.solidSubdivision[i]=material.solidSubdivision;this.electricalConductivity[i]=material.electricalConductivity;this.electricPotential[i]=material.electricPotential;this.combustionTemperature[i]=material.combustionTemperature;
    this.solidBodyId[i]=0;this.solidLocalX[i]=this.solidLocalY[i]=this.solidLocalZ[i]=0;return true;
  }
  effectiveDensity(material,phase){ if(phase===Phase.GAS)return Math.max(0.08,material.density*(0.18+0.16*(1-material.compressibility))); if(phase===Phase.SOLID)return material.density*1.08; return material.density; }
  effectiveDensityAt(i,phase=this.phase[i]){ const base=this.baseDensity[i]; if(phase===Phase.GAS)return Math.max(.08,base*(.18+.16*(1-this.compressibility[i]))); if(phase===Phase.SOLID)return base*1.08; return base; }
  setPhase(i,phase){ this.phase[i]=phase;this.phaseProgress[i]=0;this.density[i]=this.effectiveDensityAt(i,phase); }
  clampToBox(box,padding=0.09){ const hx=box.width/2-padding,hy=box.height/2-padding,hz=box.depth/2-padding; for(let i=0;i<this.count;i++){this.x[i]=clamp(this.x[i],-hx,hx);this.y[i]=clamp(this.y[i],-hy,hy);this.z[i]=clamp(this.z[i],-hz,hz);} }
  removeAt(index){
    if(index<0||index>=this.count)return false;
    const last=this.count-1;
    if(index!==last)for(const key of PARTICLE_ARRAYS)this[key][index]=this[key][last];
    this.count=last;return true;
  }
  removeInSphere(point,radius){
    const r2=radius*radius;let removed=0;
    for(let i=this.count-1;i>=0;i--){const dx=this.x[i]-point.x,dy=this.y[i]-point.y,dz=this.z[i]-point.z;if(dx*dx+dy*dy+dz*dz<=r2){this.removeAt(i);removed++;}}
    return removed;
  }
  clear(){this.count=0;}
  totalMass(){let m=0;for(let i=0;i<this.count;i++)m+=this.mass[i];return m;}
  phaseCounts(){const c=[0,0,0];for(let i=0;i<this.count;i++)c[this.phase[i]]++;return c;}
}
