import { ParticleSystem } from './ParticleSystem.mjs';
import { SpatialGrid } from './SpatialGrid.mjs';
import { FluidSolver } from './FluidSolver.mjs';
import { SolidSolver } from './SolidSolver.mjs';
import { MoldSystem } from './MoldSystem.mjs';
import { CombustionSolver, deriveCombustionProducts } from './CombustionSolver.mjs';
import { ReactionEngine } from '../reactions/ReactionEngine.mjs';
import { updateThermal } from './ThermalSolver.mjs';
import { updateElectrical } from './ElectricalSolver.mjs';
import { updatePhaseParticle } from './PhaseSolver.mjs';
import { applyBuoyancy } from './BuoyancySolver.mjs';
import { Phase } from './Phase.mjs';
import { clamp } from './math.mjs';
import { materialFromParticlePair, sampleMaterialAt } from '../materials/MaterialSampler.mjs';

export const DEFAULT_RULES={miscibilityThreshold:.12,baseMixingRate:2.2,mixingExponent:1.7,condensationDensityThreshold:.62,condensationCoolingCoefficient:.38,thermalDiffusionRate:.7,reactionStrength:1.15,thermalShockStrength:1.1,canonicalizationDistance:.025,thermalReactionThreshold:.72,thermalReactionStrength:1.15,electricalConductionRate:2.2,jouleHeating:.025,combustionRate:1,combustionHeatScale:1};
export const DEFAULT_ENV={environmentDensity:.52,ambientTemperature:.33,gravityStrength:5.4,buoyancyStrength:8.5,maxVelocity:7,dimensionMode:'3D',box:{width:5.4,height:7.2,depth:4.2}};
export const DEFAULT_BOX_BY_MODE=Object.freeze({'3D':Object.freeze({width:5.4,height:7.2,depth:4.2}),'2D':Object.freeze({width:18,height:24,depth:4.2})});

function cleanBox(box,fallback){return {width:clamp(Number(box?.width)||fallback.width,3,60),height:clamp(Number(box?.height)||fallback.height,3,60),depth:clamp(Number(box?.depth)||fallback.depth,3,18)};}
function depthUnit(i,materialId,x,y){let h=(Math.imul((i+1)|0,0x9e3779b1)^Math.imul((materialId+17)|0,0x85ebca6b)^Math.imul(Math.floor((x+64)*997),0xc2b2ae35)^Math.floor((y+64)*619))>>>0;h^=h>>>16;h=Math.imul(h,0x7feb352d)>>>0;h^=h>>>15;h=Math.imul(h,0x846ca68b)>>>0;h^=h>>>16;return (h>>>0)/4294967295;}

export function performanceProfileFor(count,dimensionMode='3D'){
  const normalized=count*(dimensionMode==='2D'?1.45:1);
  if(normalized<=1400)return {tier:'FULL',fluidIterations:3,fluidRadius:.48,fluidPairStride:1,thermalStride:1,electricalStride:1,reactionStride:1,combustionStride:1,clampStride:1};
  if(normalized<=2800)return {tier:'LARGE',fluidIterations:1,fluidRadius:.47,fluidPairStride:1,thermalStride:2,electricalStride:3,reactionStride:2,combustionStride:2,clampStride:4};
  if(normalized<=5000)return {tier:'HUGE',fluidIterations:1,fluidRadius:.45,fluidPairStride:2,thermalStride:4,electricalStride:5,reactionStride:3,combustionStride:3,clampStride:10};
  if(normalized<=8500)return {tier:'MASSIVE',fluidIterations:1,fluidRadius:.43,fluidPairStride:3,thermalStride:6,electricalStride:8,reactionStride:4,combustionStride:4,clampStride:16};
  return {tier:'EXTREME',fluidIterations:1,fluidRadius:.42,fluidPairStride:4,thermalStride:8,electricalStride:10,reactionStride:5,combustionStride:5,clampStride:20};
}

export class SimulationEngine{
  constructor(capacity=1800){this.ps=new ParticleSystem(capacity);this.grid=new SpatialGrid(capacity,64);this.fluid=new FluidSolver();this.solid=new SolidSolver();this.molds=new MoldSystem();this.reactions=new ReactionEngine();this.combustion=new CombustionSolver();this.materials=new Map();this.rules=structuredClone(DEFAULT_RULES);this.env=structuredClone(DEFAULT_ENV);this.boxByMode={'3D':{...DEFAULT_BOX_BY_MODE['3D']},'2D':{...DEFAULT_BOX_BY_MODE['2D']}};this.gravity={x:0,y:-this.env.gravityStrength,z:0};this.paused=false;this.time=0;this.stepIndex=0;this.performance=performanceProfileFor(0,'3D');this.stats={reactions:0,combustions:0,combustionMass:0,gridCells:0,phaseChanges:0,generatedMaterials:0,performanceTier:'FULL'};this.iterations=2;this.compositeCache=new Map();this.combustionProductCache=new Map();this.emergentIdCursor=10000;}
  registerMaterial(m){this.materials.set(m.id,m);this.emergentIdCursor=Math.max(this.emergentIdCursor,m.id>=10000?m.id+1:this.emergentIdCursor);}
  allocateEmergentId(){while(this.materials.has(this.emergentIdCursor))this.emergentIdCursor++;return this.emergentIdCursor++;}
  resolveFusion(ps,i,j,aId,bId){if(aId===bId)return aId;const a=this.materials.get(aId),b=this.materials.get(bId),roots=[...new Set([...(a?.sourceMaterialIds||[aId]),...(b?.sourceMaterialIds||[bId])])].sort((x,y)=>x-y),key=roots.join(':');if(a?.emergent&&a.sourceMaterialIds?.length===roots.length&&a.sourceMaterialIds.every((v,k)=>v===roots[k]))return aId;if(b?.emergent&&b.sourceMaterialIds?.length===roots.length&&b.sourceMaterialIds.every((v,k)=>v===roots[k]))return bId;const cached=this.compositeCache.get(key);if(cached&&this.materials.has(cached))return cached;const id=this.allocateEmergentId(),generation=Math.max(a?.generation||0,b?.generation||0)+1,name=`Mix ${a?.name||aId} + ${b?.name||bId}`.slice(0,40),material=materialFromParticlePair(ps,i,j,id,name,{emergent:true,reusable:false,generation,parentMaterialIds:[aId,bId],sourceMaterialIds:roots});if(!material)return Math.min(aId,bId);this.registerMaterial(material);this.compositeCache.set(key,id);this.stats.generatedMaterials++;return id;}
  resolveCombustionProducts(material){const key=[material.id,material.seed,material.color,material.density,material.viscosity,material.particleRadius,material.incompressible?1:0,material.volatility,material.reactionPotential,material.crystallinity,material.solidSubdivision,material.electricalConductivity,material.combustionTemperature].join('|'),cached=this.combustionProductCache.get(key);if(cached?.every(p=>this.materials.has(p.material.id)))return cached;const products=deriveCombustionProducts(material,()=>this.allocateEmergentId());for(const product of products)this.registerMaterial(product.material);this.combustionProductCache.set(key,products);this.stats.generatedMaterials+=products.length;return products;}
  inspectMaterial(point,radius=.75){return sampleMaterialAt(this.ps,point,radius,1,'Sampled material');}
  pruneEmergentMaterials(){for(const [id,m] of this.materials)if(m.emergent&&m.reusable===false)this.materials.delete(id);this.compositeCache.clear();this.combustionProductCache.clear();}
  restoreBoxModes(boxes=null,legacyBox=null,activeMode=this.env.dimensionMode){const mode=activeMode==='2D'?'2D':'3D';if(boxes?.['3D'])this.boxByMode['3D']=cleanBox(boxes['3D'],DEFAULT_BOX_BY_MODE['3D']);if(boxes?.['2D'])this.boxByMode['2D']=cleanBox(boxes['2D'],DEFAULT_BOX_BY_MODE['2D']);if(!boxes&&legacyBox)this.boxByMode[mode]=cleanBox(legacyBox,DEFAULT_BOX_BY_MODE[mode]);this.env.box={...this.boxByMode[mode]};this.env.dimensionMode=mode;this.grid.setDimensionMode(mode);this.grid.configure(this.env.box);}
  getBoxByMode(){return {'3D':{...this.boxByMode['3D']},'2D':{...this.boxByMode['2D']}};}
  setDimensionMode(mode){
    const nextMode=mode==='2D'?'2D':'3D',prevMode=this.env.dimensionMode==='2D'?'2D':'3D';
    if(prevMode===nextMode){this.env.box={...this.boxByMode[nextMode]};this.grid.setDimensionMode(nextMode);this.grid.configure(this.env.box);return;}
    this.boxByMode[prevMode]={...this.env.box};const ps=this.ps;
    if(nextMode==='2D'){
      for(let i=0;i<ps.count;i++){ps.savedDepth[i]=ps.z[i];ps.savedVz[i]=ps.vz[i];ps.hasSavedDepth[i]=1;ps.z[i]=ps.pz[i]=0;ps.vz[i]=0;ps.solidLocalZ[i]=0;}
      this.env.dimensionMode='2D';this.env.box={...this.boxByMode['2D']};this.gravity.z=0;this.grid.setDimensionMode('2D');ps.clampToBox(this.env.box);this.grid.configure(this.env.box);return;
    }
    this.env.dimensionMode='3D';this.env.box={...this.boxByMode['3D']};this.grid.setDimensionMode('3D');const hz=Math.max(.12,this.env.box.depth*.5-.16),span=Math.max(.16,hz*1.55);this.solid.reset();
    for(let i=0;i<ps.count;i++){const restored=Boolean(ps.hasSavedDepth[i]),z=restored?clamp(ps.savedDepth[i],-hz,hz):clamp((depthUnit(i,ps.materialId[i],ps.x[i],ps.y[i])-.5)*span,-hz,hz);ps.z[i]=ps.pz[i]=z;ps.vz[i]=restored?ps.savedVz[i]:0;ps.hasSavedDepth[i]=0;ps.solidBodyId[i]=0;ps.solidLocalZ[i]=0;}
    ps.clampToBox(this.env.box);this.grid.rebuild(ps,this.env.box);for(let i=0;i<ps.count;i++)if(ps.phase[i]===Phase.SOLID)this.solid.initializeParticle(ps,i,false,this.grid);this.grid.configure(this.env.box);
  }
  setGravity(x,y,z){if(this.env.dimensionMode==='2D')z=0;const l=Math.hypot(x,y,z)||1,s=this.env.gravityStrength/l;this.gravity.x=x*s;this.gravity.y=y*s;this.gravity.z=this.env.dimensionMode==='2D'?0:z*s;}
  resizeBox(width,height,depth){const mode=this.env.dimensionMode==='2D'?'2D':'3D',next=cleanBox({width,height,depth},this.boxByMode[mode]);this.boxByMode[mode]={...next};this.env.box={...next};this.ps.clampToBox(this.env.box);this.grid.configure(this.env.box);}
  addMold(point,size='M'){return this.molds.add(point,size,this.env.box);}
  clearMolds(){this.molds.clear();}
  emit(materialId,position,count=16,temperature,spread=1){const m=this.materials.get(materialId);if(!m)return 0;let added=0;const planar=this.env.dimensionMode==='2D',placementTemperature=Number.isFinite(temperature)?temperature:this.env.ambientTemperature,phase=placementTemperature>m.boilingTemperature+m.phaseTransitionHysteresis?Phase.GAS:(placementTemperature<m.meltingTemperature-m.phaseTransitionHysteresis?Phase.SOLID:Phase.LIQUID);for(let n=0;n<count;n++){const a=n*2.399963,r=(.05+.035*Math.sqrt(n))*spread,x=position.x+Math.cos(a)*r,y=planar?position.y+Math.sin(a)*r:position.y+(n%4)*.035*spread,z=planar?0:position.z+Math.sin(a)*r,i=this.ps.add({x,y,z,mass:1,temperature:placementTemperature},m,phase);if(i>=0){added++;if(phase===Phase.SOLID)this.solid.initializeParticle(this.ps,i,planar);}else break;}return added;}
  erase(point,radius=.6){return this.ps.removeInSphere(point,radius);}
  applyHeat(point,radius,amount){const r2=radius*radius;let affected=0,totalDelta=0;for(let i=0;i<this.ps.count;i++){const dx=this.ps.x[i]-point.x,dy=this.ps.y[i]-point.y,dz=this.ps.z[i]-point.z,d2=dx*dx+dy*dy+dz*dz;if(d2<r2){const before=this.ps.temperature[i],weight=1-Math.sqrt(d2)/radius;this.ps.temperature[i]=clamp(before+amount*weight,0,1.2);if(this.ps.temperature[i]!==before){affected++;totalDelta+=this.ps.temperature[i]-before;}}}return{affected,totalDelta};}
  step(dt){
    if(this.paused)return;dt=clamp(dt,1/120,1/24);this.time+=dt;this.stepIndex++;const planar=this.env.dimensionMode==='2D',profile=performanceProfileFor(this.ps.count,this.env.dimensionMode);this.performance=profile;const fluidIterations=Math.min(this.iterations,profile.fluidIterations);
    this.fluid.step(this.ps,this.grid,this.gravity,this.env,this.rules,dt,fluidIterations,profile);this.molds.collide(this.ps,planar);this.grid.rebuild(this.ps,this.env.box);
    for(let i=0;i<this.ps.count;i++)applyBuoyancy(this.ps,i,this.gravity,this.env,dt);
    if(this.stepIndex%profile.thermalStride===0)updateThermal(this.ps,this.grid,this.rules,this.env,dt*profile.thermalStride);
    let changes=0,hasSolid=false;for(let i=0;i<this.ps.count;i++){const change=updatePhaseParticle(this.ps,i,dt);if(change){changes++;if(change.from===Phase.SOLID&&change.to===Phase.LIQUID)this.solid.onMelt(this.ps,i);else if(change.to===Phase.SOLID)this.solid.initializeParticle(this.ps,i,planar,this.grid);}if(this.ps.phase[i]===Phase.SOLID)hasSolid=true;}
    let positionsDirty=false;if(hasSolid){this.solid.step(this.ps,this.grid,this.env,this.gravity,dt);this.fluid.collideBox(this.ps,this.env.box,planar);positionsDirty=true;}if(this.molds.molds.length||this.molds.barriers.size){this.molds.collide(this.ps,planar);positionsDirty=true;}if(positionsDirty)this.grid.rebuild(this.ps,this.env.box);
    if(this.stepIndex%profile.electricalStride===0)updateElectrical(this.ps,this.grid,this.rules,dt*profile.electricalStride);
    if(this.stepIndex%profile.reactionStride===0)this.reactions.step(this.ps,this.grid,this.rules,dt*profile.reactionStride,(ps,i,j,a,b)=>this.resolveFusion(ps,i,j,a,b));else this.reactions.clearFrame();
    if(this.stepIndex%profile.combustionStride===0)this.combustion.step(this.ps,this.grid,this.materials,this.rules,this.env,dt*profile.combustionStride,m=>this.resolveCombustionProducts(m),(index,isPlanar)=>this.solid.initializeParticle(this.ps,index,isPlanar,this.grid),(x,y,z,intensity,thermal)=>this.reactions.pushEvent(x,y,z,intensity,thermal));else this.combustion.resetFrame();
    this.sanitize(this.stepIndex%profile.clampStride===0);this.stats.reactions=this.reactions.activeReactions+this.combustion.events;this.stats.combustions=this.combustion.events;this.stats.combustionMass=this.combustion.massConsumed;this.stats.gridCells=this.grid.cellCount;this.stats.phaseChanges=changes;this.stats.performanceTier=profile.tier;
  }
  sanitize(clampBox=true){const ps=this.ps,planar=this.env.dimensionMode==='2D',x=ps.x,y=ps.y,z=ps.z,vx=ps.vx,vy=ps.vy,vz=ps.vz,temp=ps.temperature,density=ps.density,potential=ps.electricPotential;for(let i=0;i<ps.count;i++){if(!Number.isFinite(x[i]))x[i]=0;if(!Number.isFinite(y[i]))y[i]=0;if(!Number.isFinite(z[i]))z[i]=0;if(!Number.isFinite(vx[i]))vx[i]=0;if(!Number.isFinite(vy[i]))vy[i]=0;if(!Number.isFinite(vz[i]))vz[i]=0;if(!Number.isFinite(temp[i]))temp[i]=0;if(!Number.isFinite(density[i]))density[i]=0;if(!Number.isFinite(potential[i]))potential[i]=0;if(!Number.isFinite(ps.incompressible[i]))ps.incompressible[i]=0;temp[i]=clamp(temp[i],0,1.2);density[i]=clamp(density[i],.04,2.5);potential[i]=clamp(potential[i],-1.5,1.5);ps.incompressible[i]=clamp(ps.incompressible[i],0,1);if(planar){z[i]=ps.pz[i]=0;vz[i]=0;}}if(clampBox)ps.clampToBox(this.env.box);}
  reset(){this.ps.clear();this.time=0;this.stepIndex=0;this.performance=performanceProfileFor(0,this.env.dimensionMode);this.reactions.clearFrame();this.pruneEmergentMaterials();this.stats.generatedMaterials=0;this.stats.performanceTier='FULL';this.solid.reset();this.molds.clear();this.combustion.resetFrame();this.combustionProductCache.clear();this.stats.combustions=0;this.stats.combustionMass=0;}
}
