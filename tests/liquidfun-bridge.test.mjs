import test from 'node:test';
import assert from 'node:assert/strict';
import { LiquidFunFluid } from '../src/game/LiquidFunFluid.mjs';
import { Phase } from '../src/simulation/Phase.mjs';

function mockLiquidFun() {
  const runtime = {};
  runtime.b2Vec2 = class { constructor(x=0,y=0){this.x=x;this.y=y;} Set(x,y){this.x=x;this.y=y;} };
  runtime.b2BodyDef = class {};
  runtime.b2EdgeShape = class { Set(a,b){this.a=a;this.b=b;} };
  runtime.b2ParticleSystemDef = class {};
  runtime.b2PolygonShape = class {};
  runtime.b2ParticleGroupDef = class {};
  runtime.b2ParticleDef = class { constructor(){this.position=new runtime.b2Vec2();this.velocity=new runtime.b2Vec2();this.color={r:0,g:0,b:0,a:0};} };
  runtime.b2_waterParticle = 0;
  runtime.b2World = class {
    constructor(gravity){this.gravity=gravity;this.particleSystems=[];this.edges=[];runtime.lastWorld=this;}
    CreateBody(){return {CreateFixtureFromShape:(shape)=>this.edges.push(shape)};}
    CreateParticleSystem(){
      const system={count:0,positions:new Float32Array(32),velocities:new Float32Array(32),
        SetMaxParticleCount(n){this.positions=new Float32Array(n*2);this.velocities=new Float32Array(n*2);this.count=0;},
        CreateParticle(def){const i=this.count++;this.positions[2*i]=def.position.x;this.positions[2*i+1]=def.position.y;
          this.velocities[2*i]=def.velocity.x;this.velocities[2*i+1]=def.velocity.y;return i;},
        CreateParticleGroup(def){
          const width=Math.round(def.shape.vertices[1].x+.75),height=Math.round(def.shape.vertices[2].y+.75);
          const count=width*height;this.count+=count;
          return {GetParticleCount:()=>count};
        },
        GetPositionBuffer(){return this.positions.subarray(0,this.count*2);},
        GetVelocityBuffer(){return this.velocities.subarray(0,this.count*2);}};
      this.particleSystems.push(system);return system;
    }
    DestroyParticleSystem(sys){this.particleSystems.splice(this.particleSystems.indexOf(sys),1);}
    SetGravity(g){this.gravity=g;}
    Step(dt){for(const sys of this.particleSystems)for(let i=0;i<sys.count;i++){
      sys.velocities[2*i+1]+=this.gravity.y*dt;
      sys.positions[2*i]+=sys.velocities[2*i]*dt;sys.positions[2*i+1]+=sys.velocities[2*i+1]*dt;
    }}
  };
  return runtime;
}
function particles(){
  return {capacity:8,count:3,phase:new Int32Array([Phase.LIQUID,Phase.GAS,Phase.SOLID]),
    x:new Float32Array([0,1,2]),y:new Float32Array([0,.2,.4]),
    px:new Float32Array(3),py:new Float32Array(3),
    vx:new Float32Array([.5,.3,.2]),vy:new Float32Array([0,.1,.2]),
    strength:new Float32Array([.7,.2,.8]),poison:new Float32Array([.3,.8,.1]),
    temperature:new Float32Array([.7,1.1,.2]),arcaneThreshold:new Float32Array([-.3,.5,-.7]),
    magicDecayTemperature:new Float32Array([.9,.9,.9]),
    materialId:new Int32Array([1,2,3]),mass:new Float32Array([1,2,3])};
}
test('LiquidFun adapter creates exactly the original cauldron walls and moves liquids only',()=>{
  const runtime=mockLiquidFun(),backend=new LiquidFunFluid(runtime),ps=particles();
  assert.equal(runtime.lastWorld.edges.length,10);
  assert.equal(backend.definition.destroyByAge,false);
  const magic=Array.from(ps.strength),venom=Array.from(ps.poison),
    phases=Array.from(ps.phase),temps=Array.from(ps.temperature),
    ids=Array.from(ps.materialId),thresholds=Array.from(ps.arcaneThreshold);
  backend.step(ps,.025,{x:0,y:-4.5});
  assert.equal(backend.indices.length,1);
  assert.ok(ps.x[0]>.001&&ps.y[0]<0,'LiquidFun, not the legacy integrator, moved this water');
  assert.equal(ps.x[1],1);assert.ok(Math.abs(ps.y[2]-.4)<.00001);
  assert.deepEqual(Array.from(ps.strength),magic);
  assert.deepEqual(Array.from(ps.poison),venom);
  assert.deepEqual(Array.from(ps.phase),phases);
  assert.deepEqual(Array.from(ps.temperature),temps);
  assert.deepEqual(Array.from(ps.materialId),ids);
  assert.deepEqual(Array.from(ps.arcaneThreshold),thresholds);
});
test('boiling, condensation, pouring and bottling rebuild only the fluid index mapping',()=>{
  const backend=new LiquidFunFluid(mockLiquidFun()),ps=particles(),gravity={x:0,y:-4};
  backend.step(ps,.025,gravity);
  assert.equal(backend.rebuilds,1);
  backend.step(ps,.025,gravity);
  assert.equal(backend.rebuilds,1);
  ps.phase[0]=Phase.GAS;ps.phase[1]=Phase.LIQUID;
  backend.step(ps,.025,gravity);
  assert.deepEqual(backend.indices,[1]);assert.equal(backend.rebuilds,2);
  ps.phase[0]=Phase.LIQUID;backend.step(ps,.025,gravity);
  assert.deepEqual(backend.indices,[0,1]);assert.equal(backend.rebuilds,3);
  ps.count=1;backend.step(ps,.025,gravity);
  assert.deepEqual(backend.indices,[0]);assert.equal(backend.rebuilds,4);
  backend.reset();assert.equal(backend.frames,0);assert.deepEqual(backend.indices,[]);
});
