import { ParticleSystem } from './ParticleSystem.mjs';
import { SpatialGrid } from './SpatialGrid.mjs';
import { FluidSolver } from './FluidSolver.mjs';
import { ReactionEngine } from '../reactions/ReactionEngine.mjs';
import { updateThermal } from './ThermalSolver.mjs';
import { updatePhaseParticle } from './PhaseSolver.mjs';
import { applyBuoyancy } from './BuoyancySolver.mjs';
import { Phase } from './Phase.mjs';
import { clamp } from './math.mjs';
import { materialFromParticlePair, sampleMaterialAt } from '../materials/MaterialSampler.mjs';

export const DEFAULT_RULES={miscibilityThreshold:.12,baseMixingRate:2.2,mixingExponent:1.7,condensationDensityThreshold:.62,condensationCoolingCoefficient:.38,thermalDiffusionRate:.7,reactionStrength:1.15,thermalShockStrength:1.1,canonicalizationDistance:.025};
export const DEFAULT_ENV={environmentDensity:.52,ambientTemperature:.33,gravityStrength:5.4,buoyancyStrength:8.5,maxVelocity:7,box:{width:5.4,height:7.2,depth:4.2}};
export class SimulationEngine{
  constructor(capacity=1800){this.ps=new ParticleSystem(capacity);this.grid=new SpatialGrid(capacity);this.fluid=new FluidSolver();this.reactions=new ReactionEngine();this.materials=new Map();this.rules=structuredClone(DEFAULT_RULES);this.env=structuredClone(DEFAULT_ENV);this.gravity={x:0,y:-this.env.gravityStrength,z:0};this.paused=false;this.time=0;this.stats={reactions:0,gridCells:0,phaseChanges:0,generatedMaterials:0};this.iterations=2;this.compositeCache=new Map();this.emergentIdCursor=10000;}
  registerMaterial(m){this.materials.set(m.id,m);this.emergentIdCursor=Math.max(this.emergentIdCursor,m.id>=10000?m.id+1:this.emergentIdCursor);}
  allocateEmergentId(){while(this.materials.has(this.emergentIdCursor))this.emergentIdCursor++;return this.emergentIdCursor++;}
  resolveFusion(ps,i,j,aId,bId){
    if(aId===bId)return aId;const a=this.materials.get(aId),b=this.materials.get(bId),roots=[...new Set([...(a?.sourceMaterialIds||[aId]),...(b?.sourceMaterialIds||[bId])])].sort((x,y)=>x-y),key=roots.join(':');
    if(a?.emergent&&a.sourceMaterialIds?.length===roots.length&&a.sourceMaterialIds.every((v,k)=>v===roots[k]))return aId;if(b?.emergent&&b.sourceMaterialIds?.length===roots.length&&b.sourceMaterialIds.every((v,k)=>v===roots[k]))return bId;
    const cached=this.compositeCache.get(key);if(cached&&this.materials.has(cached))return cached;const id=this.allocateEmergentId(),generation=Math.max(a?.generation||0,b?.generation||0)+1,name=`Mix ${a?.name||aId} + ${b?.name||bId}`.slice(0,40);
    const material=materialFromParticlePair(ps,i,j,id,name,{emergent:true,reusable:false,generation,parentMaterialIds:[aId,bId],sourceMaterialIds:roots});if(!material)return Math.min(aId,bId);this.registerMaterial(material);this.compositeCache.set(key,id);this.stats.generatedMaterials++;return id;
  }
  inspectMaterial(point,radius=.75){return sampleMaterialAt(this.ps,point,radius,1,'Sampled material');}
  pruneEmergentMaterials(){for(const [id,m] of this.materials)if(m.emergent&&m.reusable===false)this.materials.delete(id);this.compositeCache.clear();}
  setGravity(x,y,z){const l=Math.hypot(x,y,z)||1,s=this.env.gravityStrength/l;this.gravity.x=x*s;this.gravity.y=y*s;this.gravity.z=z*s;}
  resizeBox(width,height,depth){this.env.box.width=clamp(width,3,12);this.env.box.height=clamp(height,3,12);this.env.box.depth=clamp(depth,3,12);this.ps.clampToBox(this.env.box);this.grid.configure(this.env.box);}
  emit(materialId,position,count=16,temperature,spread=1){const m=this.materials.get(materialId);if(!m)return 0;let added=0;const phase=temperature!==undefined&&temperature>m.boilingTemperature+m.phaseTransitionHysteresis?Phase.GAS:(temperature!==undefined&&temperature<m.meltingTemperature-m.phaseTransitionHysteresis?Phase.SOLID:Phase.LIQUID);for(let n=0;n<count;n++){const a=n*2.399963,r=(.05+.035*Math.sqrt(n))*spread,i=this.ps.add({x:position.x+Math.cos(a)*r,y:position.y+(n%4)*.035*spread,z:position.z+Math.sin(a)*r,mass:1,temperature},m,phase);if(i>=0)added++;else break;}return added;}
  erase(point,radius=.6){return this.ps.removeInSphere(point,radius);}
  applyHeat(point,radius,amount){const r2=radius*radius;let affected=0,totalDelta=0;for(let i=0;i<this.ps.count;i++){const dx=this.ps.x[i]-point.x,dy=this.ps.y[i]-point.y,dz=this.ps.z[i]-point.z,d2=dx*dx+dy*dy+dz*dz;if(d2<r2){const before=this.ps.temperature[i],weight=1-Math.sqrt(d2)/radius;this.ps.temperature[i]=clamp(before+amount*weight,0,1.2);if(this.ps.temperature[i]!==before){affected++;totalDelta+=this.ps.temperature[i]-before;}}}return{affected,totalDelta};}
  step(dt){if(this.paused)return;dt=clamp(dt,1/120,1/24);this.time+=dt;this.grid.rebuild(this.ps,this.env.box);this.fluid.step(this.ps,this.grid,this.gravity,this.env,this.rules,dt,this.iterations);this.grid.rebuild(this.ps,this.env.box);
    for(let i=0;i<this.ps.count;i++)applyBuoyancy(this.ps,i,this.gravity,this.env,dt);updateThermal(this.ps,this.grid,this.rules,this.env,dt);let changes=0;for(let i=0;i<this.ps.count;i++)if(updatePhaseParticle(this.ps,i,dt))changes++;this.reactions.step(this.ps,this.grid,this.rules,dt,(ps,i,j,a,b)=>this.resolveFusion(ps,i,j,a,b));this.sanitize();this.stats.reactions=this.reactions.activeReactions;this.stats.gridCells=this.grid.cellCount;this.stats.phaseChanges=changes;}
  sanitize(){for(let i=0;i<this.ps.count;i++){for(const key of ['x','y','z','vx','vy','vz','temperature','density'])if(!Number.isFinite(this.ps[key][i]))this.ps[key][i]=0;this.ps.temperature[i]=clamp(this.ps.temperature[i],0,1.2);this.ps.density[i]=clamp(this.ps.density[i],.04,2.5);}this.ps.clampToBox(this.env.box);}
  reset(){this.ps.clear();this.time=0;this.reactions.clearFrame();this.pruneEmergentMaterials();this.stats.generatedMaterials=0;}
}
