import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/SimulationEngine.mjs';
import { generateMaterial } from '../src/materials/MaterialGenerator.mjs';
import { Phase } from '../src/simulation/Phase.mjs';
import { rayAabbIntersection } from '../src/rendering/SceneRenderer.mjs';
import { DeviceOrientationProvider, GravityController } from '../src/sensors/GravityInputProvider.mjs';

function makeSolid(seed=7001,id=1){const m=generateMaterial(seed,id);Object.assign(m,{combustionTemperature:1.4,meltingTemperature:.8,boilingTemperature:1.05,solidSubdivision:.85,crystallinity:.4,viscosity:.1});return m;}

test('unsupported solid particles keep falling under gravity',()=>{
  const sim=new SimulationEngine(32),m=makeSolid();sim.registerMaterial(m);const i=sim.ps.add({x:0,y:1.8,z:0,temperature:.1},m,Phase.SOLID);sim.solid.initializeParticle(sim.ps,i,false);const y0=sim.ps.y[i];for(let k=0;k<18;k++)sim.step(1/40);assert.ok(sim.ps.y[i]<y0-.28,`solid should fall, y=${sim.ps.y[i]} from ${y0}`);assert.ok(sim.ps.vy[i]<-.5,'unsupported solid retains downward momentum');
});

test('internal granular contacts do not make a suspended cluster hover',()=>{
  const sim=new SimulationEngine(32),m=makeSolid(7002,1);sim.registerMaterial(m);for(const [x,y] of [[0,1.8],[.18,1.72],[-.18,1.72],[0,1.55]]){const i=sim.ps.add({x,y,z:0,temperature:.1},m,Phase.SOLID);sim.solid.initializeParticle(sim.ps,i,false);}const start=[...Array(sim.ps.count).keys()].reduce((s,i)=>s+sim.ps.y[i],0)/sim.ps.count;for(let k=0;k<18;k++)sim.step(1/40);const end=[...Array(sim.ps.count).keys()].reduce((s,i)=>s+sim.ps.y[i],0)/sim.ps.count;assert.ok(end<start-.25,`suspended grains must fall: ${start} -> ${end}`);
});

test('3D screen ray can intersect the box at real depth rather than z zero',()=>{
  const origin={x:5,y:2,z:5},l=Math.hypot(5,2,5),dir={x:-5/l,y:-2/l,z:-5/l},hit=rayAabbIntersection(origin,dir,{width:5.4,height:7.2,depth:4.2});assert.ok(hit);assert.ok(Math.abs(hit.z)>.2,`expected nonzero depth, got ${hit.z}`);assert.ok(Math.abs(hit.x)<=2.7&&Math.abs(hit.y)<=3.6&&Math.abs(hit.z)<=2.1);
});

test('device orientation auto-calibrates its activation pose and can return to manual mode',()=>{
  const p=new DeviceOrientationProvider();p.pendingCalibration=true;p.onOrientation({beta:18,gamma:-12});let g=p.getGravity();assert.ok(Math.abs(g.x)<1e-6&&Math.abs(g.z)<1e-6,'activation pose becomes neutral');p.onOrientation({beta:18,gamma:8});g=p.getGravity();assert.ok(g.x>0,'subsequent tilt is measured relative to activation pose');
  const controller=new GravityController();controller.device.enabled=true;controller.device.disable=()=>{controller.device.enabled=false;};controller.active=controller.device;assert.equal(controller.isDeviceActive(),true);controller.useManual();assert.equal(controller.active.kind,'manual');assert.equal(controller.device.enabled,false);
});
