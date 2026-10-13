import test from 'node:test';
import assert from 'node:assert/strict';
import { BrewingSession } from '../src/game/brewing.mjs';
import { generateWorld } from '../src/game/world.mjs';
import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';
import { SpatialGrid } from '../src/simulation/SpatialGrid.mjs';
import { Phase } from '../src/simulation/Phase.mjs';
import { effectiveLiquidViscosity, particlePairRestDistance } from '../src/simulation/FluidSolver.mjs';
import { sanitizeMaterial } from '../src/materials/MaterialDefinition.mjs';
import { MixtureSolver } from '../src/reactions/MixtureSolver.mjs';
import { ReactionEngine } from '../src/reactions/ReactionEngine.mjs';
import { DEFAULT_RULES } from '../src/simulation/SimulationEngine.mjs';
import { updatePowderDissolution } from '../src/simulation/PowderSolver.mjs';

const material=(id,color,extra={})=>sanitizeMaterial({id,color,density:1,viscosity:.05,particleRadius:.1,miscibility:.42,
  meltingTemperature:.05,boilingTemperature:1.1,phaseTransitionHysteresis:.01,combustionTemperature:1.4,
  reactionPotential:0,reactionHeat:0,solidSubdivision:1,...extra});
const rules={...DEFAULT_RULES,interactionRadiusScale:.5,canonicalizationDistance:0};
const near=(a,b,eps=.00001)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const transport=()=>{const reactions=new ReactionEngine();reactions.mixtures=new MixtureSolver();return reactions;};

test('pigment advances one touching neighbourhood per tick, then stops when contacts separate',()=>{
  const ps=new ParticleSystem(4),grid=new SpatialGrid(4),reactions=transport();grid.setDimensionMode('2D');
  for(let i=0;i<4;i++)ps.add({x:i*.09,y:0,z:0,mass:.25},material(i?2:1,i?'#0000ff':'#ff0000'));
  grid.rebuild(ps,{width:5,height:5,depth:3});reactions.step(ps,grid,rules,.025);
  assert.ok(ps.r[1]>0);assert.equal(ps.r[2],0);assert.equal(ps.r[3],0);
  reactions.step(ps,grid,rules,.025);assert.ok(ps.r[2]>0);assert.equal(ps.r[3],0);
  ps.x[0]=-1.5;ps.x[1]=-.5;ps.x[2]=.5;ps.x[3]=1.5;grid.rebuild(ps,{width:5,height:5,depth:3});
  const colors=[...ps.r];ps.temperature.fill(.7);
  for(let i=0;i<100;i++)reactions.step(ps,grid,{...rules,mixingTemperatureCoefficient:3.5},.025);
  assert.deepEqual([...ps.r],colors,'past contact must not activate global colour relaxation');
});

test('diffusion across a high-degree contact preserves weighted pigment, bounds and pair-order independence',()=>{
  const results=[];
  for(const reverse of [false,true]){
    const ps=new ParticleSystem(6),reactions=transport();
    ps.add({x:0,y:0,z:0,mass:.1},material(1,'#ff0000'));
    for(let i=1;i<6;i++){const angle=i*2*Math.PI/5;ps.add({x:Math.cos(angle)*.06,y:Math.sin(angle)*.06,z:0,mass:.2+i*.1},material(2,'#0000ff'));}
    const pairs=Array.from({length:5},(_,i)=>[0,i+1]);if(reverse)pairs.reverse();
    const grid={dimensionMode:'2D',forEachPair(_ps,_radius,callback){for(const [i,j] of pairs)callback(i,j);}};
    ps.stirActivity.fill(1);
    const amount=()=>[...ps.r].reduce((s,r,i)=>s+r*ps.mixtureAmount[i],0),before=amount();
    reactions.step(ps,grid,rules,.2);near(amount(),before);
    assert.ok([...ps.r].every(v=>v>=0&&v<=1));results.push([...ps.r]);
  }
  assert.deepEqual(results[0],results[1]);
});

test('stirring accelerates contact diffusion while remote parcels keep their original colour',()=>{
  const result=stir=>{
    const ps=new ParticleSystem(3),grid=new SpatialGrid(3),reactions=transport();grid.setDimensionMode('2D');
    for(const [x,id,color] of [[0,1,'#ff0000'],[.09,2,'#0000ff'],[1.5,2,'#0000ff']])ps.add({x,y:0,z:0,mass:.25},material(id,color));
    ps.stirActivity[0]=stir;grid.rebuild(ps,{width:5,height:5,depth:3});reactions.step(ps,grid,rules,.025);
    assert.equal(ps.r[2],0);return ps.r[1];
  };
  assert.ok(result(1)>result(0)*5);
});

test('resting contact and flow cannot hydrate powder; kneading produces a true thick liquid that survives reload',()=>{
  const ingredients=[{id:1,price:1,material:material(1,'#ff0000',{meltingTemperature:.6})},{id:2,price:1,material:material(2,'#0000ff')}];
  const brew=new BrewingSession(ingredients),e=brew.engine,ps=e.ps;
  ps.add({x:0,y:0,z:0,mass:.25,temperature:.33},e.materials.get(1),Phase.SOLID);
  ps.add({x:.06,y:0,z:0,mass:.25,temperature:.33},e.materials.get(2),Phase.LIQUID);
  const mass=ps.totalMass();
  const tick=()=>{e.grid.rebuild(ps,e.env.box);e.reactions.step(ps,e.grid,e.rules,.025);updatePowderDissolution(ps,.025);};
  ps.vx[0]=4;ps.vx[1]=-4;for(let i=0;i<200;i++)tick();
  assert.equal(ps.powderContent[0],1);assert.equal(ps.powderContent[1],0);assert.equal(ps.phase[0],Phase.SOLID);
  const grainColor=ps.r[0];assert.equal(grainColor,1);
  for(let i=0;i<200;i++){brew.stir({x:.03,y:0},{x:2,y:.2});tick();}
  assert.equal(ps.phase[0],Phase.LIQUID);assert.ok(effectiveLiquidViscosity(ps,0)>.95);
  assert.equal(ps.solidBodyId[0],0);assert.ok(ps.meltingTemperature[0]<.33);
  near(ps.totalMass(),mass);near(ps.mass[0]*ps.powderContent[0]+ps.mass[1]*ps.powderContent[1],.25);
  const restored=new BrewingSession(ingredients);restored.restore(brew.snapshot());
  assert.equal(restored.engine.ps.stirActivity[0],0);assert.equal(restored.engine.ps.phase[0],Phase.LIQUID);
  restored.engine.setGravity(0,0,0);for(let i=0;i<70;i++)restored.step();
  assert.equal(restored.engine.ps.phase[0],Phase.LIQUID,'kneaded suspension must not refreeze at room temperature');
  assert.ok(restored.inspect().viscosity>.95);
  const re=restored.engine,rp=re.ps;re.env.ambientThermalExchange=0;rp.temperature.fill(.01);
  for(let i=0;i<90;i++)re.step(.025);assert.ok([...rp.phase.subarray(0,rp.count)].every(p=>p===Phase.SOLID));
  rp.temperature.fill(.33);for(let i=0;i<90;i++)re.step(.025);
  assert.ok([...rp.phase.subarray(0,rp.count)].every(p=>p===Phase.LIQUID));
  near(rp.mass[0]*rp.powderContent[0]+rp.mass[1]*rp.powderContent[1],.25);
  assert.ok(effectiveLiquidViscosity(rp,0)>.95,'melting frozen dough cannot erase its powder fraction');
});

test('dough dissipates liquid shear much more strongly than water without welding particles',()=>{
  const b=new BrewingSession([{id:1,price:1,material:material(1,'#ff0000')}]),ps=b.engine.ps;
  for(const x of [0,.05])ps.add({x,y:0,z:0,mass:.25,temperature:.33},b.engine.materials.get(1),Phase.LIQUID);
  const shear=content=>{ps.powderContent.fill(content);ps.vy[0]=1;ps.vy[1]=-1;
    b.engine.fluid.solveLiquidPair(ps,0,1,1,0,0,.05,{x:0,y:0,z:0},b.engine.rules,.025,true,.5);
    return Math.abs(ps.vy[0]-ps.vy[1]);};
  const thin=shear(0),thick=shear(.5);assert.ok(thick<thin*.5);
  assert.equal(ps.phase[0],Phase.LIQUID);assert.equal(ps.solidBodyId[0],0);
});

test('a deposited sand mound stays local and has no continuing lateral creep or rigid grain links',()=>{
  const b=new BrewingSession(generateWorld('sand-local-rest').ingredients);b.pour(10,40,{10:100});const ps=b.engine.ps;
  for(let i=0;i<400;i++)b.step();const x=ps.x.slice(0,ps.count),y=ps.y.slice(0,ps.count);
  for(let i=0;i<800;i++)b.step();
  const creep=Math.max(...x.map((v,i)=>Math.hypot(ps.x[i]-v,ps.y[i]-y[i])));
  assert.ok(creep<particlePairRestDistance(ps,0,0,true),`sand drift exceeded one grain after settling: ${creep}`);
  assert.ok(Math.min(...ps.x.subarray(0,ps.count))>-.8,'one mound must not level itself across the whole bowl');
  assert.ok([...ps.solidBodyId.subarray(0,ps.count)].every(id=>id===0));
  assert.ok([...ps.powderContent.subarray(0,ps.count)].every(content=>content===1));
});

test('removing a resting sand support wakes the upper grain, and spoon contact wakes resting grains',()=>{
  const b=new BrewingSession(generateWorld('sand-wake').ingredients),e=b.engine,ps=e.ps,m=e.materials.get(10);
  ps.add({x:0,y:-1.1,z:0,mass:.25},m,Phase.SOLID);
  const upper=ps.add({x:0,y:-.98,z:0,mass:.25},m,Phase.SOLID);
  for(let i=0;i<100;i++)b.step();assert.equal(ps.grainRest[upper],1);
  const y=ps.y[upper];ps.removeAt(0);for(let i=0;i<8;i++)b.step();
  assert.ok(ps.y[0]<y-.02,'cached support must not leave floating sand');
  for(let i=0;i<80;i++)b.step();assert.equal(ps.grainRest[0],1);
  assert.ok(b.stir({x:ps.x[0],y:ps.y[0]},{x:3,y:1})>0);assert.equal(ps.grainRest[0],0);assert.ok(ps.vx[0]>0);
});

test('successive powder pours keep independent grain positions instead of duplicating the previous stream',()=>{
  const b=new BrewingSession(generateWorld('successive-pours').ingredients);b.pour(10,10,{10:100});b.pour(10,10,{10:100});
  const ps=b.engine.ps,positions=new Set();
  for(let i=0;i<ps.count;i++)positions.add(`${ps.x[i]},${ps.y[i]}`);
  assert.equal(positions.size,ps.count);near(b.occupiedVolume,20);
});

test('assisted stirring kneads a poured powder-and-liquid batch through the real moving particle solver',()=>{
  const b=new BrewingSession(generateWorld('mobile-acceptance').ingredients);b.pour(10,20,{10:100});
  for(let i=0;i<90;i++)b.step();b.pour(1,20,{1:100});for(let i=0;i<100;i++)b.step();
  const ps=b.engine.ps,mass=ps.totalMass(),dry=[...ps.mass.subarray(0,ps.count)].reduce((s,m,i)=>s+m*ps.powderContent[i],0);
  assert.equal(ps.phaseCounts()[Phase.SOLID],80);assert.ok([...ps.powderContent.subarray(0,80)].every(p=>p===1));
  for(let i=0;i<240;i++){b.assistStir();b.step();}
  assert.ok(ps.phaseCounts()[Phase.LIQUID]>80,'normal assisted stirring must actually form liquid dough');
  assert.ok([...ps.powderContent.subarray(0,ps.count)].some((p,i)=>p>.27&&p<.935&&ps.phase[i]===Phase.LIQUID));
  near(ps.totalMass(),mass,.001);near([...ps.mass.subarray(0,ps.count)].reduce((s,m,i)=>s+m*ps.powderContent[i],0),dry,.001);
});
