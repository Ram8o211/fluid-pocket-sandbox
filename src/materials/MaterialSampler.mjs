import { rgbToHex } from '../simulation/math.mjs';
import { sanitizeMaterial } from './MaterialDefinition.mjs';

const PARTICLE_TO_MATERIAL = Object.freeze({
  opacity: 'opacity', density: 'baseDensity', viscosity: 'viscosity', cohesion: 'cohesion', miscibility: 'miscibility', particleRadius: 'particleRadius',
  heatCapacity: 'heatCapacity', thermalConductivity: 'thermalConductivity', meltingTemperature: 'meltingTemperature',
  boilingTemperature: 'boilingTemperature', phaseTransitionHysteresis: 'phaseHysteresis', volatility: 'volatility',
  reactionPotential: 'reactionPotential', reactionHeat: 'reactionHeat', compressibility: 'compressibility',
  crystallinity: 'crystallinity', solidSubdivision: 'solidSubdivision', electricalConductivity: 'electricalConductivity',
  electricPotential: 'electricPotential', combustionTemperature: 'combustionTemperature'
});

function weightedParticleMaterial(ps, weightedIndices, id, name, metadata={}) {
  let totalWeight=0,r=0,g=0,b=0,temperature=0;
  const sums=Object.fromEntries(Object.keys(PARTICLE_TO_MATERIAL).map(k=>[k,0]));
  const sourceMass=new Map();
  for(const {index,weight} of weightedIndices){
    const w=Math.max(0,weight)*(ps.mass[index]||1);if(w<=0)continue;totalWeight+=w;
    r+=ps.r[index]*w;g+=ps.g[index]*w;b+=ps.b[index]*w;temperature+=ps.temperature[index]*w;
    for(const [key,arrayName] of Object.entries(PARTICLE_TO_MATERIAL))sums[key]+=ps[arrayName][index]*w;
    sourceMass.set(ps.materialId[index],(sourceMass.get(ps.materialId[index])||0)+w);
  }
  if(totalWeight<=1e-8)return null;
  const sourceMaterialIds=[...sourceMass.entries()].sort((a,b)=>b[1]-a[1]).map(([sourceId])=>sourceId);
  const material={
    id,name,seed:Math.abs(sourceMaterialIds.reduce((s,v)=>((s*1664525)^v)>>>0,2166136261)),
    color:rgbToHex(r/totalWeight,g/totalWeight,b/totalWeight),
    ...Object.fromEntries(Object.keys(PARTICLE_TO_MATERIAL).map(key=>[key,sums[key]/totalWeight])),
    sourceMaterialIds,...metadata
  };
  return {material:sanitizeMaterial(material),temperature:temperature/totalWeight,sourceMaterialIds,totalWeight,dominantMaterialId:sourceMaterialIds[0]??null};
}

export function materialFromParticlePair(ps,i,j,id,name,metadata={}){
  return weightedParticleMaterial(ps,[{index:i,weight:1},{index:j,weight:1}],id,name,metadata)?.material||null;
}

export function sampleMaterialAt(ps,point,radius=.75,id=1,name='Sampled material'){
  const r2=radius*radius,weighted=[];let count=0;
  for(let i=0;i<ps.count;i++){
    const dx=ps.x[i]-point.x,dy=ps.y[i]-point.y,dz=ps.z[i]-point.z,d2=dx*dx+dy*dy+dz*dz;
    if(d2>r2)continue;const d=Math.sqrt(d2),weight=.12+.88*(1-d/radius);weighted.push({index:i,weight});count++;
  }
  const result=weightedParticleMaterial(ps,weighted,id,name,{sampled:true,reusable:false});
  return result?{...result,count,radius,point:{...point}}:null;
}
