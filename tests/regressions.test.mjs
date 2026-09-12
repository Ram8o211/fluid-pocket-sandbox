import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/SimulationEngine.mjs';
import { generateMaterial } from '../src/materials/MaterialGenerator.mjs';
import { Phase } from '../src/simulation/Phase.mjs';
import { rayAabbIntersection } from '../src/rendering/SceneRenderer.mjs';
import { DeviceOrientationProvider, GravityController } from '../src/sensors/GravityInputProvider.mjs';
import { BoxModeState, DEFAULT_BOX_BY_MODE } from '../src/app/gestureMath.mjs';

function makeSolid(seed=7001,id=1){const m=generateMaterial(seed,id);Object.assign(m,{combustionTemperature:1.4,meltingTemperature:.8,boilingTemperature:1.05,solidSubdivision:.85,crystallinity:.4,viscosity:.1});return m;}

test('unsupported solid particles keep falling under gravity',()=>{
  const sim=new SimulationEngine(32),m=makeSolid();sim.registerMaterial(m);const i=sim.ps.add({x:0,y:1.8,z:0,temperature:.1},m,Phase.SOLID);sim.solid.initializeParticle(sim.ps,i,false);const y0=sim.ps.y[i];for(let k=0;k<18;k++)sim.step(1/40);assert.ok(sim.ps.y[i]<y0-.28,`solid should fall, y=${sim.ps.y[i]} from ${y0}`);assert.ok(sim.ps.vy[i]<-.5,'unsupported solid retains downward momentum');
});

test('internal granular contacts do not make a suspended cluster hover',()=>{
  const sim=new SimulationEngine(32),m=makeSolid(7002,1);sim.registerMaterial(m);for(const [x,y] of [[0,1.8],[.18,1.72],[-.18,1.72],[0,1.55]]){const i=sim.ps.add({x,y,z:0,temperature:.1},m,Phase.SOLID);sim.solid.initializeParticle(sim.ps,i,false);}const start=[...Array(sim.ps.count).keys()].reduce((s,i)=>s+sim.ps.y[i],0)/sim.ps.count;for(let k=0;k<18;k++)sim.step(1/40);const end=[...Array(sim.ps.count).keys()].reduce((s,i)=>s+sim.ps.y[i],0)/sim.ps.count;assert.ok(end<start-.25,`suspended grains must fall: ${start} -> ${end}`);
});

test('non-gaseous free fall is independent of viscosity and solid subdivision',()=>{
  const drop=(phase,viscosity,solidSubdivision,temp,melting)=>{const sim=new SimulationEngine(16);sim.resizeBox(8,20,8);sim.env.ambientTemperature=temp;const m=generateMaterial(8100+phase+Math.round(viscosity*10),1);Object.assign(m,{viscosity,solidSubdivision,meltingTemperature:melting,boilingTemperature:1.2,combustionTemperature:1.4,cohesion:.9});sim.registerMaterial(m);const i=sim.ps.add({x:0,y:4,z:0,temperature:temp},m,phase);if(phase===Phase.SOLID)sim.solid.initializeParticle(sim.ps,i,false);for(let k=0;k<12;k++)sim.step(1/40);return {y:sim.ps.y[i],vy:sim.ps.vy[i]};};
  const thin=drop(Phase.LIQUID,.02,.1,.45,.05),thick=drop(Phase.LIQUID,.98,.9,.45,.05),solid=drop(Phase.SOLID,.7,.15,.1,.8);assert.ok(Math.abs(thin.y-thick.y)<.01,`viscosity changed bulk fall: ${thin.y} vs ${thick.y}`);assert.ok(Math.abs(thin.y-solid.y)<.025,`solid/liquid gravity diverged: ${thin.y} vs ${solid.y}`);assert.ok(Math.abs(thin.vy-thick.vy)<.02);
});

test('surface tension preserves liquid center of mass in free space',()=>{
  const sim=new SimulationEngine(32);sim.resizeBox(20,20,10);sim.env.ambientTemperature=.45;sim.setGravity(0,0,0);const m=generateMaterial(8201,1);Object.assign(m,{meltingTemperature:.05,boilingTemperature:1.2,combustionTemperature:1.4,cohesion:1,viscosity:.85,miscibility:.5});sim.registerMaterial(m);for(const [x,y,z] of [[-.31,.2,0],[.18,.29,.08],[.26,-.17,-.05],[-.09,-.26,.04]])sim.ps.add({x,y,z,temperature:.45},m,Phase.LIQUID);
  const center=()=>{let sx=0,sy=0,sz=0,sm=0;for(let i=0;i<sim.ps.count;i++){const mass=sim.ps.mass[i];sx+=sim.ps.x[i]*mass;sy+=sim.ps.y[i]*mass;sz+=sim.ps.z[i]*mass;sm+=mass;}return{x:sx/sm,y:sy/sm,z:sz/sm};},a=center();for(let k=0;k<20;k++)sim.step(1/40);const b=center();assert.ok(Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)<.002,`surface tension moved COM: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
});

test('2D and 3D box settings are independent and 2D starts spacious',()=>{
  assert.ok(DEFAULT_BOX_BY_MODE['2D'].width>=18&&DEFAULT_BOX_BY_MODE['2D'].height>=24);const state=new BoxModeState('3D',{'3D':{width:7,height:9,depth:5}}),two=state.switchTo('2D',{width:7,height:9,depth:5});assert.deepEqual(two,DEFAULT_BOX_BY_MODE['2D']);state.capture('2D',{width:32,height:36,depth:4.2});const three=state.switchTo('3D',{width:32,height:36,depth:4.2});assert.deepEqual(three,{width:7,height:9,depth:5});
});

test('3D screen ray can intersect the box at real depth rather than z zero',()=>{
  const origin={x:5,y:2,z:5},l=Math.hypot(5,2,5),dir={x:-5/l,y:-2/l,z:-5/l},hit=rayAabbIntersection(origin,dir,{width:5.4,height:7.2,depth:4.2});assert.ok(hit);assert.ok(Math.abs(hit.z)>.2,`expected nonzero depth, got ${hit.z}`);assert.ok(Math.abs(hit.x)<=2.7&&Math.abs(hit.y)<=3.6&&Math.abs(hit.z)<=2.1);
});

test('device orientation auto-calibrates its activation pose and can return to manual mode',()=>{
  const p=new DeviceOrientationProvider();p.pendingCalibration=true;p.onOrientation({beta:18,gamma:-12});let g=p.getGravity();assert.ok(Math.abs(g.x)<1e-6&&Math.abs(g.z)<1e-6,'activation pose becomes neutral');p.onOrientation({beta:18,gamma:8});g=p.getGravity();assert.ok(g.x>0,'subsequent tilt is measured relative to activation pose');
  const controller=new GravityController();controller.device.enabled=true;controller.device.disable=()=>{controller.device.enabled=false;};controller.active=controller.device;assert.equal(controller.isDeviceActive(),true);controller.useManual();assert.equal(controller.active.kind,'manual');assert.equal(controller.device.enabled,false);
});
