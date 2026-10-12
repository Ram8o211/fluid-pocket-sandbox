import test from 'node:test';
import assert from 'node:assert/strict';
import { BrewingSession } from '../src/game/brewing.mjs';
import { sanitizeMaterial } from '../src/materials/MaterialDefinition.mjs';
import { Phase } from '../src/simulation/Phase.mjs';
import { doughStrength, updatePowderDissolution } from '../src/simulation/PowderSolver.mjs';
import { insideCauldron, cauldronParticlePadding } from '../src/game/cauldron.mjs';
const m=(id,miscibility=.4)=>sanitizeMaterial({id,density:1,meltingTemperature:.05,boilingTemperature:1.1,phaseTransitionHysteresis:.02,combustionTemperature:1.4,solidSubdivision:1,miscibility,color:id===1?'#ff0000':'#0000ff',reactionPotential:0,reactionHeat:0});
const setup=(incompatible=false)=>new BrewingSession([{id:1,price:1,material:m(1)},{id:2,price:1,material:m(2,incompatible?.9:.4)}]);
const add=(b,id,x,y,phase,mass=.25)=>b.engine.ps.add({x,y,z:0,mass,temperature:.065},b.engine.materials.get(id),phase);
function mix(b,n){const e=b.engine;for(let t=0;t<n;t++){e.grid.rebuild(e.ps,e.env.box);e.reactions.step(e.ps,e.grid,e.rules,1/30);updatePowderDissolution(e.ps,1/30);}}
const near=(a,b,eps=.001)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);

test('frozen block retains pair distances when gravity presses it into a tapered wall',()=>{
 const b=setup(),e=b.engine,ps=e.ps;e.env.ambientThermalExchange=0;e.rules.thermalDiffusionRate=0;
 for(let i=0;i<12;i++){const k=add(b,1,.7+(i%4)*.1,-.7+Math.floor(i/4)*.1,Phase.SOLID);ps.solidSubdivision[k]=0;}
 e.grid.rebuild(ps,e.env.box);for(let i=0;i<ps.count;i++)e.solid.initializeParticle(ps,i,true,e.grid);
 const distance=Math.hypot(ps.x[0]-ps.x[11],ps.y[0]-ps.y[11]);e.setGravity(.5,-1,0);
 for(let n=0;n<160;n++)e.step(1/30);
 near(Math.hypot(ps.x[0]-ps.x[11],ps.y[0]-ps.y[11]),distance,.003);
 for(let i=0;i<ps.count;i++)assert.ok(insideCauldron(ps.x[i],ps.y[i],cauldronParticlePadding(ps,i)));
});

test('dry grains reject deep overlaps and remove tangential sliding rather than liquid-like flow',()=>{
 const b=setup(),e=b.engine,ps=e.ps;add(b,1,0,0,Phase.SOLID);add(b,1,.02,0,Phase.SOLID);
 ps.vy[0]=.1;ps.vy[1]=-.1;
 const before=Math.abs(ps.vy[1]-ps.vy[0]);e.fluid.solvePowderPair(ps,0,1,1,0,0,.02,1/30,true,e.rules);
 assert.ok(ps.x[1]-ps.x[0]>.07);assert.ok(Math.abs(ps.vy[1]-ps.vy[0])<before*.7);assert.equal(ps.powderContent[0],1);
});

test('larger spoon stirs touching powder and liquid but leaves a frozen block and distant grains alone',()=>{
 const b=setup(),ps=b.engine.ps;add(b,1,.25,0,Phase.SOLID);add(b,2,-.25,0,Phase.LIQUID);add(b,1,.7,0,Phase.SOLID);const block=add(b,1,0,.1,Phase.SOLID);ps.solidSubdivision[block]=0;
 assert.equal(b.stir({x:0,y:0},{x:3,y:1}),2);assert.ok(ps.vx[0]>0&&ps.vx[1]>0);assert.equal(ps.vx[2],0);assert.equal(ps.vx[3],0);
});

for(const phases of [[Phase.SOLID,Phase.SOLID],[Phase.SOLID,Phase.LIQUID],[Phase.SOLID,Phase.GAS],[Phase.GAS,Phase.GAS],[Phase.GAS,Phase.LIQUID]]){
 test(`compatible phases ${phases} mix locally with the same affinity rules; incompatible phases remain separate`,()=>{
  for(const incompatible of [false,true]){const b=setup(incompatible),ps=b.engine.ps;add(b,1,0,0,phases[0]);add(b,2,.06,0,phases[1]);add(b,2,1.5,0,phases[1]);mix(b,200);
   if(incompatible){near(ps.r[0],1);near(ps.b[0],0);}else assert.ok(ps.b[0]>.1);
   near(ps.r[2],0);near(ps.b[2],1);
   if(phases.includes(Phase.GAS))near(ps.powderContent[0],phases[0]===Phase.SOLID?1:0);
   if(phases[0]===Phase.SOLID)assert.ok(ps.solidSubdivision[0]>=.55);
  }
 });
}

test('limited solvent produces persistent dough, excess compatible solvent dissolves slowly and conserves dry content',()=>{
 for(const solventMass of [.25,3]){
  const b=setup(),ps=b.engine.ps;add(b,1,0,0,Phase.SOLID,.25);add(b,2,.06,0,Phase.LIQUID,solventMass);
  const dry=ps.mass[0]*ps.powderContent[0],total=ps.totalMass();mix(b,30);
  assert.equal(ps.phase[0],Phase.SOLID,'Dissolution cannot switch instantly');
  mix(b,570);near(ps.totalMass(),total);near(ps.mass[0]*ps.powderContent[0]+ps.mass[1]*ps.powderContent[1],dry);
  if(solventMass===.25){assert.ok(doughStrength(ps.powderContent[0])>.8);assert.equal(ps.phase[0],Phase.SOLID);}
  else {assert.ok(ps.powderContent[0]<.18);assert.equal(ps.phase[0],Phase.LIQUID);}
  const restored=setup();restored.restore(b.snapshot());near(restored.engine.ps.powderContent[0],ps.powderContent[0]);near(restored.engine.ps.dissolutionProgress[0],ps.dissolutionProgress[0]);
 }
});
