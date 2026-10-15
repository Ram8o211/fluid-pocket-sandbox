import test from 'node:test';
import assert from 'node:assert/strict';
import { BrewingSession } from '../src/game/brewing.mjs';
import { sanitizeMaterial } from '../src/materials/MaterialDefinition.mjs';
import { Phase } from '../src/simulation/Phase.mjs';
import { LaboratoryRenderer } from '../src/game/LaboratoryRenderer.mjs';
const make = () => new BrewingSession([{ id: 1, price: 1, material: sanitizeMaterial({ id: 1, density: 1, boilingTemperature: .6, meltingTemperature: .3, combustionTemperature: .9, volatility: 1, solidSubdivision: .9, crystallinity: 1, reactionPotential: 0, reactionHeat: 0 }) }]);
const add = (b, x, y, phase=Phase.LIQUID, temperature=.4) => b.engine.ps.add({x,y,z:0,mass:.25,temperature}, b.engine.materials.get(1), phase);

test('spoon touches only nearby liquid and pestle crushes only touched solid, preserving mass and reload', () => {
  const b=make(), ps=b.engine.ps;
  add(b,0,0);add(b,.5,0);add(b,0,.5,Phase.GAS);add(b,-.5,0,Phase.SOLID);add(b,-1,0,Phase.SOLID);
  ps.solidSubdivision[3]=ps.solidSubdivision[4]=0;
  b.engine.grid.rebuild(ps,b.engine.env.box);
  b.engine.solid.initializeParticle(ps,3,true,b.engine.grid);b.engine.solid.initializeParticle(ps,4,true,b.engine.grid);
  const mass=ps.totalMass();assert.equal(b.stir({x:0,y:0},{x:4,y:2}),1);
  assert.ok(ps.vx[0]>0);assert.equal(ps.vx[1],0);assert.equal(ps.vx[2],0);
  assert.equal(b.crush({x:-.5,y:0}),1);assert.equal(ps.solidBodyId[3],0);assert.equal(ps.solidSubdivision[3],1);assert.equal(ps.solidSubdivision[4],0);assert.equal(ps.totalMass(),mass);
  const restored=make();restored.restore(b.snapshot());assert.equal(restored.engine.ps.solidSubdivision[3],1);assert.equal(restored.engine.ps.solidBodyId[3],0);assert.ok(restored.engine.ps.solidBodyId[4]>0);
});

test('wider spoon catches nearby liquid, vapour and powder without pulling distant matter or rigid blocks', () => {
  const b=make(),ps=b.engine.ps,indices=[];
  for(const x of [-.38,-.16,0,.16,.39,.7])indices.push(add(b,x,0,x===.39?Phase.SOLID:Phase.LIQUID));
  ps.solidSubdivision[4]=1;ps.powderContent[4]=1;
  const gas=add(b,0,.1,Phase.GAS),frozen=add(b,0,-.1,Phase.SOLID);
  ps.solidSubdivision[frozen]=0;
  const mass=ps.totalMass();
  assert.equal(b.stir({x:0,y:0},{x:4,y:0}),6,
    'one stroke should affect all five nearby grains and the local vapour');
  for(const i of indices.slice(0,5))assert.ok(ps.vx[i]>.05,`grain ${i} was missed by stirring`);
  assert.equal(ps.vx[indices[5]],0,'distant liquid must remain unaffected');
  assert.ok(ps.vx[gas]>.05,'vapour must follow the same local spoon stroke');
  assert.equal(ps.vx[frozen],0,'coherent frozen blocks cannot be stirred');
  assert.equal(ps.totalMass(),mass);
});

test('fast spoon drag catches particles along the whole travelled path only once', () => {
  const b=make(),ps=b.engine.ps;
  for(const x of [-1.3,-.6,-.2,.2,.6,1.3])add(b,x,0);
  const affected=b.stir({x:.6,y:0},{x:5,y:0},1/40,{x:-.6,y:0});
  assert.equal(affected,4,'swept stirring must reach grains between pointer events');
  for(let i=1;i<=4;i++)assert.ok(ps.vx[i]>0,`swept path missed grain ${i}`);
  assert.equal(ps.vx[0],0);assert.equal(ps.vx[5],0);
  assert.equal(b.stir({x:.6,y:0},{x:0,y:0},1/40,{x:-.6,y:0}),0,
    'stationary movement must not cause additional impulses');
});

test('freezing granular liquid makes one touching coherent solid without coarse lattice gaps', () => {
  const b=make(),e=b.engine,ps=e.ps;e.gravity={x:0,y:0,z:0};e.env.ambientThermalExchange=0;
  for(let i=0;i<8;i++)add(b,(i%4)*.11,Math.floor(i/4)*.11,Phase.LIQUID,.15);
  for(let n=0;n<45;n++)e.step(1/30);
  assert.equal(ps.phaseCounts()[Phase.SOLID],8);assert.ok([...ps.solidSubdivision.subarray(0,8)].every(v=>v===0));
  assert.equal(new Set(ps.solidBodyId.subarray(0,8)).size,1);assert.ok(ps.solidBodyId[0]>0);
  assert.ok(Math.max(...ps.x.subarray(0,8))-Math.min(...ps.x.subarray(0,8))<.6);
});

test('boiling and burning require sustained exposure rather than a subsecond switch', () => {
  for(const burning of [false,true]){
    const b=make(),e=b.engine,ps=e.ps;add(b,0,0,Phase.LIQUID,burning?1.05:.8);e.gravity={x:0,y:0,z:0};e.env.ambientThermalExchange=0;
    for(let n=0;n<30;n++)e.step(1/30);
    assert.equal(ps.materialId[0],1);assert.ok(ps.combustionProgress[0]<1);
    if(!burning){assert.equal(ps.phase[0],Phase.LIQUID);assert.ok(ps.phaseProgress[0]>.1 && ps.phaseProgress[0]<.6);}
    for(let n=0;n<240;n++)e.step(1/30);
    if(burning)assert.notEqual(ps.materialId[0],1);else assert.equal(ps.phase[0],Phase.GAS);
  }
});

test('combustion light renders every active burning particle with small local rectangles', () => {
  const b=make(),ps=b.engine.ps;add(b,0,0,Phase.LIQUID,1);add(b,1,0,Phase.LIQUID,1);add(b,-1,0,Phase.LIQUID,.4);
  ps.combustionProgress[0]=.2;ps.combustionProgress[1]=.6;
  const draws=[],ctx={save(){},restore(){},fillRect(...v){draws.push(v);}};
  LaboratoryRenderer.prototype.drawEffects.call({sim:b.engine},ctx,{cx:192,cy:158,scale:40});
  assert.equal(draws.length,4);assert.ok(draws.every(d=>d[2]<=10 && d[3]<=10));assert.ok(draws.some(d=>d[0]>225));
});


test('hot vapour stays buoyant but occupies a layer below the lid instead of a single line', () => {
  const b=make(),e=b.engine,ps=e.ps;e.env.ambientThermalExchange=0;e.rules.thermalDiffusionRate=0;e.rules.combustionRate=0;
  for(let i=0;i<80;i++)add(b,(i%10-4.5)*.15,-.5+Math.floor(i/10)*.15,Phase.GAS,.95);
  const mass=ps.totalMass();for(let n=0;n<400;n++)e.step(1/30);
  const ys=[...ps.y.subarray(0,ps.count)].sort((a,b)=>a-b);
  assert.ok(ys[72]-ys[8]>.06, 'Steam must retain visible vertical thickness');
  assert.ok(ys.reduce((a,b)=>a+b)/ys.length>.7);assert.equal(ps.totalMass(),mass);
});
