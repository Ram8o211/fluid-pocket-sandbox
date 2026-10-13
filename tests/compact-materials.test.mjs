import test from 'node:test';
import assert from 'node:assert/strict';
import { BrewingSession } from '../src/game/brewing.mjs';
import { generateWorld as generateRawWorld, availableIngredients } from '../src/game/world.mjs';
import { generateLiquidWorld as generateWorld } from './helpers/liquid-world.mjs';
import { newShop, restock } from '../src/game/economy.mjs';
import { encodeSave, decodeSave } from '../src/game/persistence.mjs';
import { sanitizeMaterial } from '../src/materials/MaterialDefinition.mjs';
import { effectiveParticleRadius, particlePairRestDistance } from '../src/simulation/FluidSolver.mjs';
import { Phase } from '../src/simulation/Phase.mjs';
import { LaboratoryRenderer } from '../src/game/LaboratoryRenderer.mjs';
import { paintMaterialParticles } from '../src/game/MaterialRaster.mjs';
import { FIXED_STEP, SAVE_VERSION } from '../src/game/contracts.mjs';
import { insideCauldron, cauldronParticlePadding, confineCauldronParticle, cauldronGranularWallSupport } from '../src/game/cauldron.mjs';

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
  assert.ok(mean(2)<mean(1)-.1*ps.packingScale,'heavier liquid stays lower');
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
  assert.ok(mean(2)<mean(1)-.08*ps.packingScale,`heavy layer stranded above light: heavy=${mean(2)} light=${mean(1)}`);
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

test('powder contacts have zero restitution, dissipate slip and never attract separated grains',()=>{
  const b=new BrewingSession(generateWorld('inelastic-contacts').ingredients),ps=b.engine.ps;
  const powder=b.engine.materials.get(10);
  ps.add({x:0,y:0,z:0,mass:.25,vx:1,vy:.7},powder,Phase.SOLID);
  ps.add({x:.095,y:0,z:0,mass:.25,vx:-1,vy:-.7},powder,Phase.SOLID);
  ps.solidSubdivision[0]=ps.solidSubdivision[1]=1;
  const rest=particlePairRestDistance(ps,0,1,true);ps.x[1]=ps.px[1]=rest*.9;
  b.engine.fluid.solvePowderPair(ps,0,1,1,0,0,rest*.9,FIXED_STEP,true,b.engine.rules);
  assert.ok(ps.vx[1]-ps.vx[0]>=-.000001,'no residual approaching velocity');
  assert.ok(ps.vx[1]-ps.vx[0]<.000001,'impact cannot generate separation speed');
  assert.ok(Math.abs(ps.vy[1]-ps.vy[0])<1.4,'friction must dissipate lateral slip');
  // No phantom collision when the gap is too far to close this step.
  ps.x[0]=0;ps.x[1]=rest*1.04;ps.vx[0]=.02;ps.vx[1]=-.02;
  ps.vy[0]=ps.vy[1]=0;
  b.engine.fluid.solvePowderPair(ps,0,1,1,0,0,rest*1.04,FIXED_STEP,true,b.engine.rules);
  near(ps.x[0],0);near(ps.x[1],rest*1.04);
  near(ps.vx[0],.02);near(ps.vx[1],-.02);
  // An imminent collision reaches the actual surface, never pauses with
  // an invisible gap or reverses into elastic recoil.
  ps.x[0]=0;ps.x[1]=rest*1.04;ps.vx[0]=.6;ps.vx[1]=-.6;
  b.engine.fluid.solvePowderPair(ps,0,1,1,0,0,rest*1.04,FIXED_STEP,true,b.engine.rules);
  near(ps.x[1]-ps.x[0],rest);
  assert.ok(Math.abs(ps.vx[1]-ps.vx[0])<.00001);
  // High-speed grains can swap sides between samples. The swept hit must
  // restore the first touching configuration and consume approach velocity.
  ps.px[0]=-.1;ps.px[1]=.1;ps.py[0]=ps.py[1]=0;
  ps.x[0]=.09;ps.x[1]=-.09;ps.vx[0]=7;ps.vx[1]=-7;
  b.engine.fluid.solvePowderPair(ps,0,1,-1,0,0,.18,FIXED_STEP,true,b.engine.rules);
  near(ps.x[1]-ps.x[0],rest);
  assert.ok(Math.abs(ps.vx[1]-ps.vx[0])<.00001,'swept collision must be inelastic');
  // Initially touching grains can also swap during one strong impulse.
  // The sweep must take the t=0 incoming normal, not the reversed endpoint.
  ps.px[0]=-rest/2;ps.px[1]=rest/2;
  ps.x[0]=.09;ps.x[1]=-.09;ps.vx[0]=7;ps.vx[1]=-7;
  b.engine.fluid.solvePowderPair(ps,0,1,-1,0,0,.18,FIXED_STEP,true,b.engine.rules);
  near(ps.x[1]-ps.x[0],rest);
  assert.ok(Math.abs(ps.vx[1]-ps.vx[0])<.00001,'initial contact must not tunnel');
  // A fast glancing pass misses the contact circle; radial closing speed
  // alone must not snap grains sideways into an invented collision.
  ps.x[0]=ps.px[0]=0;ps.x[1]=ps.px[1]=rest*1.04;
  ps.y[0]=ps.py[0]=0;ps.y[1]=ps.py[1]=0;
  ps.vx[0]=.3;ps.vx[1]=-.3;ps.vy[0]=-3;ps.vy[1]=3;
  b.engine.fluid.solvePowderPair(ps,0,1,1,0,0,rest*1.04,FIXED_STEP,true,b.engine.rules);
  near(ps.x[0],0);near(ps.x[1],rest*1.04);
  near(ps.vx[0],.3);near(ps.vx[1],-.3);
  near(ps.vy[0],-3);near(ps.vy[1],3);
  // Leaving contact must not create a Hooke-law force, even for wet dough.
  ps.x[0]=0;ps.x[1]=rest*1.35;ps.vx[0]=ps.vx[1]=0;
  ps.vy[0]=ps.vy[1]=0;ps.powderContent[0]=ps.powderContent[1]=.55;
  b.engine.fluid.solvePowderPair(ps,0,1,1,0,0,rest*1.35,FIXED_STEP,true,b.engine.rules);
  near(ps.x[0],0);near(ps.x[1],rest*1.35);
  near(ps.vx[0],0);near(ps.vx[1],0);
  // Separating grains retain their outward motion; no artificial pull-back.
  ps.x[0]=0;ps.x[1]=rest;ps.vx[0]=-.4;ps.vx[1]=.4;
  b.engine.fluid.solvePowderPair(ps,0,1,1,0,0,rest,FIXED_STEP,true,b.engine.rules);
  assert.ok(ps.vx[0]<0&&ps.vx[1]>0);
});

test('granular swept contacts cannot be skipped by large-world pair striding',()=>{
  const b=new BrewingSession(generateWorld('swept-stride').ingredients),e=b.engine,ps=e.ps,material=e.materials.get(10);
  ps.add({x:-.05,y:0,z:0,mass:.25,vx:5},material,Phase.SOLID);
  ps.add({x:.05,y:0,z:0,mass:.25,vx:-5},material,Phase.SOLID);
  // The only pair is ordinal zero; stride phase one normally skips it.
  e.fluid.pairPhase=1;
  e.fluid.step(ps,e.grid,{x:0,y:0,z:0},e.env,e.rules,FIXED_STEP,1,
    {fluidPairStride:4,fluidRadius:.48},null);
  assert.ok(ps.x[0]<ps.x[1],'swept impact must preserve incoming grain order');
  near(ps.x[1]-ps.x[0],particlePairRestDistance(ps,0,1,true));
  assert.ok(Math.abs(ps.vx[0]-ps.vx[1])<.00001);
});

test('the cauldron stops downward powder impacts with no rebound and supports resting grains',()=>{
  const b=new BrewingSession(generateWorld('inelastic-walls').ingredients),ps=b.engine.ps;
  const i=ps.add({x:0,y:-1.23,z:0,mass:.25,vy:-3,vx:1},b.engine.materials.get(10),Phase.SOLID);
  ps.solidSubdivision[i]=1;ps.powderContent[i]=1;
  confineCauldronParticle(ps,i);
  assert.ok(Math.abs(ps.vy[i])<.00001,`grain bounced off base with vy=${ps.vy[i]}`);
  assert.ok(Math.abs(ps.vx[i])<1,'impact should dissipate sliding energy');
  assert.ok(cauldronGranularWallSupport(ps,i,{x:0,y:-4.5,z:0}));
  const beforeY=ps.y[i];
  for(let n=0;n<100;n++)b.step();
  assert.ok(Math.abs(ps.y[i]-beforeY)<.005,'unsupported spring oscillation at rest');
  assert.ok(Math.abs(ps.vy[i])<.05,'resting grain must not store rebound speed');
});

test('sand avalanches down steep single-grain supports but wet dough resists',()=>{
  const b=new BrewingSession(generateWorld('sand-angle').ingredients),e=b.engine,ps=e.ps,material=e.materials.get(10),fixtureScale=ps.packingScale/Math.pow(material.density,1/2);
  ps.add({x:0,y:0,z:0,mass:.25},material,Phase.SOLID);
  ps.add({x:.06*fixtureScale,y:-.08*fixtureScale,z:0,mass:.25},material,Phase.SOLID);
  e.grid.rebuild(ps,e.env.box);
  // A 37-degree off-centre support is steeper than the ~27-degree
  // dry angle of repose, so gravity makes the upper grain slide to the left.
  e.solid.settleGranularParticle(ps,e.grid,0,e.env,{x:0,y:-4.5,z:0},FIXED_STEP,true);
  assert.ok(ps.vx[0]<-.001,`dry grain stuck on an unstable sand slope: ${ps.vx[0]}`);
  const drySpeed=Math.abs(ps.vx[0]);
  ps.vx[0]=ps.vy[0]=0;ps.powderContent[0]=.55;
  e.solid.settleGranularParticle(ps,e.grid,0,e.env,{x:0,y:-4.5,z:0},FIXED_STEP,true);
  assert.ok(Math.abs(ps.vx[0])<drySpeed*.1,'hydrated dough should not avalanche like dry sand');
  // Without any supporting neighbor there must be no invisible shelf force.
  ps.y[1]=-1;e.grid.rebuild(ps,e.env.box);ps.vy[0]=-.3;
  e.solid.settleGranularParticle(ps,e.grid,0,e.env,{x:0,y:-4.5,z:0},FIXED_STEP,true);
  near(ps.vy[0],-.3);
});

test('3D sand remains still when supported on opposite depth-facing sides',()=>{
  const b=new BrewingSession(generateWorld('sand-depth-support').ingredients),e=b.engine,ps=e.ps,material=e.materials.get(10),fixtureScale=ps.packingScale/Math.pow(material.density,1/3);
  ps.add({x:0,y:0,z:0,mass:.25},material,Phase.SOLID);
  ps.add({x:.07*fixtureScale,y:0,z:-.10*fixtureScale,mass:.25},material,Phase.SOLID);
  const gravity={x:0,y:0,z:-4.5};
  e.grid.setDimensionMode('3D');e.grid.rebuild(ps,e.env.box);
  e.solid.settleGranularParticle(ps,e.grid,0,e.env,gravity,FIXED_STEP,false);
  assert.ok(ps.vx[0]<-.001,'an unbraced 3D contact should allow a downhill grain to slide');
  ps.add({x:-.07*fixtureScale,y:0,z:-.10*fixtureScale,mass:.25},material,Phase.SOLID);
  ps.vx[0]=ps.vy[0]=ps.vz[0]=0;
  e.grid.rebuild(ps,e.env.box);
  e.solid.settleGranularParticle(ps,e.grid,0,e.env,gravity,FIXED_STEP,false);
  assert.ok(Math.abs(ps.vx[0])<.00001 && Math.abs(ps.vy[0])<.00001,
    'equal supports on opposite sides should hold a balanced 3D grain at rest');
});

test('3D supports on the same downhill side cannot pin a sand grain',()=>{
  const b=new BrewingSession(generateWorld('sand-support-cone').ingredients),e=b.engine,ps=e.ps,material=e.materials.get(10),fixtureScale=ps.packingScale/Math.pow(material.density,1/3);
  ps.add({x:0,y:0,z:0,mass:.25},material,Phase.SOLID);
  ps.add({x:.04*fixtureScale,y:-.09*fixtureScale,z:.07*fixtureScale,mass:.25},material,Phase.SOLID);
  ps.add({x:.04*fixtureScale,y:-.09*fixtureScale,z:-.07*fixtureScale,mass:.25},material,Phase.SOLID);
  const gravity={x:0,y:-4.5,z:0};
  e.grid.setDimensionMode('3D');e.grid.rebuild(ps,e.env.box);
  e.solid.settleGranularParticle(ps,e.grid,0,e.env,gravity,FIXED_STEP,false);
  assert.ok(ps.vx[0]<-.001,
    'two oblique contacts on the same downhill side must not hold sand at rest');
  // A genuine third contact on the opposite side encloses the load.
  ps.add({x:-.08*fixtureScale,y:-.09*fixtureScale,z:0,mass:.25},material,Phase.SOLID);
  ps.vx[0]=ps.vy[0]=ps.vz[0]=0;
  e.grid.rebuild(ps,e.env.box);
  e.solid.settleGranularParticle(ps,e.grid,0,e.env,gravity,FIXED_STEP,false);
  assert.ok(Math.hypot(ps.vx[0],ps.vz[0])<.00001,
    'a support triangle surrounding gravity must stabilize the grain');
});

test('all potion materials use fine pixel footprints at both graphics resolutions',()=>{
  const b=new BrewingSession(generateWorld('fine-pixels').ingredients),ps=b.engine.ps;
  const liquid=b.engine.materials.get(1),powder=b.engine.materials.get(10);
  ps.add({x:0,y:0,z:0,mass:.25},liquid,Phase.LIQUID);
  ps.add({x:.3,y:0,z:0,mass:.25},powder,Phase.SOLID);
  ps.add({x:-.3,y:0,z:0,mass:.25},liquid,Phase.GAS);
  for(const scale of [40,80]){
    const t={w:scale*10,h:scale*6,cx:scale*5,cy:scale*3,scale},pixels=new Uint8ClampedArray(t.w*t.h*4);
    const count=paintMaterialParticles(ps,t,pixels,(_ps,_i,out)=>{out.r=180;out.g=140;out.b=100;},{r:0,g:0,b:0});
    assert.equal(count,ps.count,'every material phase should be visible');
    for(let i=0;i<ps.count;i++){
      const x=Math.round(t.cx+ps.x[i]*scale),y=Math.round(t.cy-ps.y[i]*scale);
      assert.ok(pixels[(y*t.w+x)*4+3]>0,'the parcel centre must be drawn');
      assert.notEqual(pixels[(y*t.w+x-1)*4],pixels[(y*t.w+x)*4], 'material shading resolves individual one-pixel texels');
    }
  }
});

test('naturally loose starter dust pours as dry grains and settles into a compact frictional pile',()=>{
  const world=generateRawWorld('compact-test'),state=newShop(world);
  assert.equal(availableIngredients(world,state.equipment).length,8);
  const powders=world.ingredients.filter(i=>i.form==='powder');assert.equal(powders.length,1);
  for(const powder of powders){
    const b=new BrewingSession(world.ingredients);assert.equal(b.pour(powder.id,40,state.inventory),40);
    assert.equal(state.inventory[powder.id],20);const ps=b.engine.ps,mass=ps.totalMass();
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

test('legacy shops receive missing starter minerals once while preserving pinned ingredients, progress and brew',()=>{
  const generated=generateWorld('legacy-compact'),world={...generated,ingredients:generated.ingredients.filter(i=>i.id<=9)};
  const state=newShop(world),b=new BrewingSession(world.ingredients);b.pour(1,20,state.inventory);for(let n=0;n<30;n++)b.step();
  const raw=JSON.parse(encodeSave(state,b));raw.version=2;
  const saved=decodeSave(JSON.stringify(raw));
  assert.equal(saved.version,SAVE_VERSION);
  for(const [index,original] of raw.world.ingredients.entries())
    for(const [key,value] of Object.entries(original)) assert.deepEqual(saved.world.ingredients[index][key],value);
  assert.deepEqual(saved.brew,raw.brew);assert.deepEqual(saved.order,raw.order);assert.equal(saved.coins,raw.coins);
  for(let id=1;id<=9;id++)assert.equal(saved.inventory[id],raw.inventory[id]);
  assert.equal(saved.inventory[10],240);assert.equal(saved.inventory[11],240);
  saved.inventory[10]=0;saved.inventory[11]=17;
  const reloaded=decodeSave(JSON.stringify(saved));assert.equal(reloaded.inventory[10],0);assert.equal(reloaded.inventory[11],17);
  const restored=new BrewingSession(saved.world.ingredients);restored.restore(saved.brew);near(restored.engine.ps.totalMass(),b.engine.ps.totalMass());
});
