import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem } from '../src/simulation/ParticleSystem.mjs';
import { SpatialGrid } from '../src/simulation/SpatialGrid.mjs';
import { generateMaterial } from '../src/materials/MaterialGenerator.mjs';
import { performanceProfileFor, DEFAULT_RULES } from '../src/simulation/SimulationEngine.mjs';
import { ReactionEngine } from '../src/reactions/ReactionEngine.mjs';
import { MixtureSolver } from '../src/reactions/MixtureSolver.mjs';

test('pair grid visits each candidate pair once without mirrored duplicates',()=>{
  const ps=new ParticleSystem(8),m=generateMaterial(321,1);for(let i=0;i<4;i++)ps.add({x:i*.08,y:0,z:0},m);
  const grid=new SpatialGrid(8);grid.rebuild(ps,{width:5,height:5,depth:5});const seen=new Set(),pairs=[];
  grid.forEachPair(ps,.55,(a,b)=>{const key=a<b?`${a}:${b}`:`${b}:${a}`;pairs.push(key);seen.add(key);});
  assert.equal(pairs.length,6);assert.equal(seen.size,6);
});

test('grid allocates compact heads and preserves pair coverage while storage grows across dimension changes',()=>{
  const ps=new ParticleSystem(8),grid=new SpatialGrid(8,64),m=generateMaterial(321,1);
  let visits=0;grid.forEachPair(ps,.55,()=>visits++);assert.equal(visits,0);
  for(let i=0;i<4;i++)ps.add({x:i*.08,y:0,z:0},m);
  grid.setDimensionMode('2D');grid.rebuild(ps,{width:5.6,height:3.2,depth:3});
  assert.ok(grid.head.byteLength<65536,'a small planar bowl must not allocate a giant 3D grid');
  const pairs=()=>{const seen=new Set();grid.forEachPair(ps,.55,(i,j)=>seen.add([i,j].sort((a,b)=>a-b).join(':')));return seen.size;};
  assert.equal(pairs(),6);
  grid.setDimensionMode('3D');grid.rebuild(ps,{width:20,height:20,depth:12});assert.equal(pairs(),6);
  ps.z[3]=2;grid.rebuild(ps,{width:20,height:20,depth:12});assert.equal(pairs(),3);
  ps.z.fill(0);grid.setDimensionMode('2D');grid.rebuild(ps,{width:5.6,height:3.2,depth:3});assert.equal(pairs(),6);
});

test('large-particle scheduler preserves full fidelity at normal counts and decimates expensive passes only when needed',()=>{
  const normal=performanceProfileFor(1200,'3D'),large=performanceProfileFor(2000,'3D'),huge=performanceProfileFor(3200,'3D'),massive=performanceProfileFor(6000,'3D'),planarDense=performanceProfileFor(2000,'2D');
  assert.equal(normal.tier,'FULL');assert.equal(normal.thermalStride,1);assert.equal(normal.reactionStride,1);assert.equal(normal.electricalStride,1);
  assert.equal(large.tier,'LARGE');assert.equal(large.fluidIterations,1);assert.ok(large.electricalStride>1);
  assert.equal(huge.tier,'HUGE');assert.ok(huge.thermalStride>=large.thermalStride);assert.ok(huge.fluidPairStride>=large.fluidPairStride);
  assert.equal(massive.tier,'MASSIVE');assert.ok(massive.reactionStride>1);assert.ok(massive.clampStride>huge.clampStride);
  assert.equal(planarDense.tier,'HUGE','dense 2D enters stronger decimation earlier because all neighbors share one plane');
  assert.ok(planarDense.fluidPairStride>=large.fluidPairStride);assert.ok(planarDense.thermalStride>=large.thermalStride);
});

test('cached grid stencils preserve complete pair coverage, stride order and forced contacts across resizes',()=>{
  const ps=new ParticleSystem(96),grid=new SpatialGrid(96,16),m=generateMaterial(321,1);
  for(let i=0;i<96;i++)ps.add({x:0,y:0,z:0},m);
  for(const mode of ['2D','3D','2D'])for(const width of [2.3,4.1]){
    for(let i=0;i<ps.count;i++){
      ps.x[i]=(((i*37)%97)/96-.5)*width;
      ps.y[i]=(((i*61)%101)/100-.5)*2.7;
      ps.z[i]=mode==='2D'?0:(((i*43)%103)/102-.5)*1.9;
    }
    grid.setDimensionMode(mode);grid.rebuild(ps,{width,height:2.7,depth:1.9});
    for(const radius of [.1,.58,1.22,6]){
      const full=[];
      grid.forEachPair(ps,radius,(i,j,dx,dy,dz,d2)=>{
        assert.equal(dx,ps.x[j]-ps.x[i]);assert.equal(dy,ps.y[j]-ps.y[i]);assert.equal(dz,ps.z[j]-ps.z[i]);
        assert.equal(d2,dx*dx+dy*dy+dz*dz);full.push([i,j]);
      });
      const expected=[];
      for(let i=0;i<ps.count;i++)for(let j=i+1;j<ps.count;j++){
        const dx=ps.x[j]-ps.x[i],dy=ps.y[j]-ps.y[i],dz=ps.z[j]-ps.z[i];
        if(dx*dx+dy*dy+dz*dz<=radius*radius)expected.push(`${i}:${j}`);
      }
      assert.deepEqual(full.map(([i,j])=>`${Math.min(i,j)}:${Math.max(i,j)}`).sort(),expected.sort());
      const forced=(i,j)=>i%7===0||j%7===0;
      for(const phase of [0,1,2]){
        const sampled=[];grid.forEachPair(ps,radius,(i,j)=>sampled.push([i,j]),3,phase,forced);
        assert.deepEqual(sampled,full.filter(([i,j],ordinal)=>ordinal%3===phase||forced(i,j)));
      }
    }
  }
});

test('an inert uniform source avoids contact transport and wakes immediately for effect or hydration differences',()=>{
  const ps=new ParticleSystem(8),grid=new SpatialGrid(8),m=generateMaterial(322,1),reactions=new ReactionEngine();
  for(let i=0;i<6;i++)ps.add({x:i*.06,y:0,z:0,temperature:.33},m);
  reactions.mixtures=new MixtureSolver();reactions.mixtures.materials=new Map([[m.id,m]]);
  grid.setDimensionMode('2D');grid.rebuild(ps,{width:3,height:3,depth:3});
  let passes=0;const original=grid.forEachPair;
  grid.forEachPair=function(...args){passes++;return original.apply(this,args);};
  reactions.step(ps,grid,DEFAULT_RULES,.025);assert.equal(passes,0);
  assert.ok(ps.mixtureGroup[0]>0,'source accounting still initializes the recipe');
  ps.poison[0]+=.1;
  reactions.step(ps,grid,DEFAULT_RULES,.025);assert.equal(passes,1);
  assert.ok(ps.poison[1]>ps.poison[2],'new magic diffuses only through local contacts');
  // Hydration is deliberately not part of the pigment signature. It must
  // still wake contacts when otherwise identical liquid parcels differ.
  ps.poison.fill(0);ps.mixtureProgress.fill(0);ps.powderContent[0]=.5;ps.stirActivity.fill(1);
  reactions.step(ps,grid,DEFAULT_RULES,.025);assert.equal(passes,2);
  assert.ok(ps.powderContent[1]>0);
});
