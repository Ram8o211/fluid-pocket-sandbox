import test from 'node:test';
import assert from 'node:assert/strict';
import { BrewingSession } from '../src/game/brewing.mjs';
import { generateWorld, availableIngredients } from '../src/game/world.mjs';
import { newShop, restock } from '../src/game/economy.mjs';
import { encodeSave, decodeSave } from '../src/game/persistence.mjs';
import { sanitizeMaterial } from '../src/materials/MaterialDefinition.mjs';
import { effectiveParticleRadius, particlePairRestDistance } from '../src/simulation/FluidSolver.mjs';
import { Phase } from '../src/simulation/Phase.mjs';
import { FIXED_STEP, SAVE_VERSION } from '../src/game/contracts.mjs';
import { insideCauldron, cauldronParticlePadding } from '../src/game/cauldron.mjs';

const near = (a,b) => assert.ok(Math.abs(a-b)<.001,`${a} != ${b}`);
const liquids = () => [.65,1.5].map((density,i) => {
  const id=i+1;
  return { id, price:1, material:sanitizeMaterial({ id, density, color:i?'#c04040':'#40a0c0', particleRadius:.105,
    incompressible:true, viscosity:.2, cohesion:.2, miscibility:i?.85:.2, meltingTemperature:.05,
    boilingTemperature:1.05, combustionTemperature:1.4, reactionPotential:0, reactionHeat:0, phaseTransitionHysteresis:.02 }) };
});

test('stable density interfaces do not repel; inverted local neighbors can sort beyond direct contact',()=>{
  const b=new BrewingSession(liquids()), ps=b.engine.ps, gravity={x:0,y:-4.5,z:0};
  ps.add({x:0,y:0,z:0,mass:.25},b.engine.materials.get(2),Phase.LIQUID);
  ps.add({x:0,y:.11,z:0,mass:.25},b.engine.materials.get(1),Phase.LIQUID);
  const rest=particlePairRestDistance(ps,0,1,true);
  ps.y[1]=rest*1.01;
  for(let n=0;n<80;n++) b.engine.fluid.solveLiquidPair(ps,0,1,0,1,0,ps.y[1]-ps.y[0],gravity,b.engine.rules,FIXED_STEP,true);
  near(ps.y[0],0); near(ps.y[1],rest*1.01);
  ps.y[0]=rest*1.01;ps.y[1]=0;
  b.engine.fluid.solveLiquidPair(ps,0,1,0,-1,0,rest*1.01,gravity,b.engine.rules,FIXED_STEP,true);
  assert.ok(ps.y[0]<rest*1.01);assert.ok(ps.y[1]>0,'lighter contact rises');
  ps.y[0]=rest*1.3;ps.y[1]=0;
  b.engine.fluid.solveLiquidPair(ps,0,1,0,-1,0,rest*1.3,gravity,b.engine.rules,FIXED_STEP,true,.5);
  assert.ok(ps.y[0]<rest*1.3,'inverted parcels separated by a small gap still sort');
  assert.ok(ps.y[1]>0);
  const beyond=b.engine.fluid.neighborRadius*.5+.02;
  ps.y[0]=beyond;ps.y[1]=0;
  b.engine.fluid.solveLiquidPair(ps,0,1,0,-1,0,beyond,gravity,b.engine.rules,FIXED_STEP,true,.5);
  near(ps.y[0],beyond);near(ps.y[1],0,'sorting cannot act outside the neighbor search radius');
});

test('different density liquids settle into touching layers across the bowl and conserve mass',()=>{
  const b=new BrewingSession(liquids());b.pour(2,40,{2:100});for(let n=0;n<200;n++)b.step();
  b.pour(1,40,{1:100});const ps=b.engine.ps,mass=ps.totalMass();for(let n=0;n<400;n++)b.step();
  const mean=id=>{let sum=0,count=0;for(let i=0;i<ps.count;i++)if(ps.materialId[i]===id){sum+=ps.y[i];count++;}return sum/count;};
  assert.ok(mean(2)<mean(1)-.1,'heavier liquid stays lower');
  for(const x of [-.6,-.3,0,.3,.6]){
    let gap=Infinity;
    for(let i=0;i<ps.count;i++)for(let j=0;j<ps.count;j++)if(ps.materialId[i]===1&&ps.materialId[j]===2&&Math.abs(ps.x[i]-x)<.16&&Math.abs(ps.x[j]-x)<.16)
      gap=Math.min(gap,Math.hypot(ps.x[i]-ps.x[j],ps.y[i]-ps.y[j])-effectiveParticleRadius(ps,i,true)-effectiveParticleRadius(ps,j,true));
    assert.ok(gap<.01,`air gap at column ${x}: ${gap}`);
  }
  near(ps.totalMass(),mass);near(b.occupiedVolume,80);
  assert.equal(ps.phaseCounts()[Phase.LIQUID],320);
});

test('new heavy liquid poured onto a settled light layer sinks and closes the interface',()=>{
  const b=new BrewingSession(liquids()), ps=b.engine.ps;
  b.pour(1,40,{1:100});
  for(let n=0;n<260;n++)b.step();
  b.pour(2,40,{2:100});
  const mass=ps.totalMass();
  // Reproduce the order-dependent inversion reported by post-merge review:
  // the previous 1.15-diameter cutoff left the denser layer on top indefinitely.
  for(let n=0;n<1600;n++)b.step();
  const mean=id=>{let total=0,count=0;for(let i=0;i<ps.count;i++)if(ps.materialId[i]===id){total+=ps.y[i];count++;}return total/count;};
  assert.ok(mean(2)<mean(1)-.08,`heavy layer stranded above light: heavy=${mean(2)} light=${mean(1)}`);
  let contactGap=Infinity;
  for(let i=0;i<ps.count;i++)if(ps.materialId[i]===1)
    for(let j=0;j<ps.count;j++)if(ps.materialId[j]===2)
      contactGap=Math.min(contactGap,Math.hypot(ps.x[i]-ps.x[j],ps.y[i]-ps.y[j])-particlePairRestDistance(ps,i,j,true));
  assert.ok(contactGap<.015,`unphysical gap between reordered liquid layers: ${contactGap}`);
  near(ps.totalMass(),mass);near(b.occupiedVolume,80);
  assert.equal(ps.phaseCounts()[Phase.LIQUID],320);
});

test('unsupported fine powder keeps falling until actual grain or wall contact',()=>{
  const world=generateWorld('contact-check'),b=new BrewingSession(world.ingredients),ps=b.engine.ps;
  ps.add({x:0,y:0,z:0,mass:.25,vy:-4.5*FIXED_STEP},b.engine.materials.get(10),Phase.SOLID);
  ps.add({x:0,y:-.23,z:0,mass:.25},b.engine.materials.get(10),Phase.SOLID);
  b.engine.grid.rebuild(ps,b.engine.env.box);
  b.engine.solid.settleGranularParticle(ps,b.engine.grid,0,b.engine.env,{x:0,y:-4.5,z:0},FIXED_STEP,true);
  assert.ok(ps.vy[0]<-.1,'a distant stationary grain must not suspend powder');
});

test('starter powders pour as dry grains and settle into a compact frictional pile',()=>{
  const world=generateWorld('compact-test'),state=newShop(world);
  assert.equal(availableIngredients(world,state.equipment).length,8);
  const powders=world.ingredients.filter(i=>i.form==='powder');assert.equal(powders.length,2);
  for(const powder of powders){
    const b=new BrewingSession(world.ingredients);assert.equal(b.pour(powder.id,40,state.inventory),40);
    assert.equal(state.inventory[powder.id],200);const ps=b.engine.ps,mass=ps.totalMass();
    for(let n=0;n<320;n++)b.step();
    for(let i=0;i<ps.count;i++){
      assert.equal(ps.phase[i],Phase.SOLID);assert.equal(ps.powderContent[i],1);assert.equal(ps.solidBodyId[i],0);
      let contact=Infinity;
      for(let j=0;j<ps.count;j++)if(i!==j)contact=Math.min(contact,Math.hypot(ps.x[i]-ps.x[j],ps.y[i]-ps.y[j])/particlePairRestDistance(ps,i,j,true));
      assert.ok(contact<1.08,`suspended grain ${i}: ${contact} diameters`);
      assert.ok(insideCauldron(ps.x[i],ps.y[i],cauldronParticlePadding(ps,i)));
    }
    near(ps.totalMass(),mass);near(b.occupiedVolume,40);near(b.liquidVolume,0);
    const touched=b.stir({x:ps.x[0],y:ps.y[0]},{x:3,y:0});assert.ok(touched>0&&touched<ps.count);
    const restored=new BrewingSession(world.ingredients);restored.restore(b.snapshot());
    assert.equal(restored.engine.ps.powderContent[0],1);near(restored.engine.ps.totalMass(),mass);
    const stock=state.inventory[powder.id];restock(state,powder.id);assert.equal(state.inventory[powder.id],stock+60);
  }
});

test('legacy shops receive powders once while preserving pinned ingredients, progress and brew',()=>{
  const generated=generateWorld('legacy-compact'),world={...generated,ingredients:generated.ingredients.filter(i=>i.form!=='powder')};
  const state=newShop(world),b=new BrewingSession(world.ingredients);b.pour(1,20,state.inventory);for(let n=0;n<30;n++)b.step();
  const raw=JSON.parse(encodeSave(state,b));raw.version=2;
  const saved=decodeSave(JSON.stringify(raw));
  assert.equal(saved.version,SAVE_VERSION);assert.deepEqual(saved.world.ingredients.slice(0,9),raw.world.ingredients);
  assert.deepEqual(saved.brew,raw.brew);assert.deepEqual(saved.order,raw.order);assert.equal(saved.coins,raw.coins);
  for(let id=1;id<=9;id++)assert.equal(saved.inventory[id],raw.inventory[id]);
  assert.equal(saved.inventory[10],240);assert.equal(saved.inventory[11],240);
  saved.inventory[10]=0;saved.inventory[11]=17;
  const reloaded=decodeSave(JSON.stringify(saved));assert.equal(reloaded.inventory[10],0);assert.equal(reloaded.inventory[11],17);
  const restored=new BrewingSession(saved.world.ingredients);restored.restore(saved.brew);near(restored.engine.ps.totalMass(),b.engine.ps.totalMass());
});
