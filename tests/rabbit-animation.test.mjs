import test from 'node:test';
import assert from 'node:assert/strict';
import { rabbitArtPose, rabbitRig, rabbitTorsoWeight, shadeRabbitSurface, poseRabbitPixels } from '../src/game/RabbitArtGeometry.mjs';
import { rabbitAppearance, RABBIT_EFFECT_FILES } from '../src/game/RabbitAppearance.mjs';
import { createRabbitColony } from '../src/game/rabbits.mjs';
import { readFile } from 'node:fs/promises';

test('every supplied body tier has native anatomy landmarks, with protected eyes and feet', () => {
  for(const key of Object.keys(RABBIT_EFFECT_FILES).filter(key=>!key.startsWith('poison')&&!key.startsWith('love')&&!key.startsWith('healing'))) {
    const rig=rabbitRig(key);
    assert.equal(rabbitTorsoWeight(rig.eyeX,rig.eyeY,rig),0);
    assert.equal(rabbitTorsoWeight(rig.eyeX,rig.eyeY+12,rig),0);
    assert.equal(rabbitTorsoWeight(rig.hipX,178,rig),0);
    assert.ok(rabbitTorsoWeight(rig.hipX,rig.hipY,rig)>0);
  }
});

test('weak mixed effects cannot add a second face, cut a rectangle into the head, or change alpha', () => {
  const rabbit=createRabbitColony(1000).rabbits[0];
  Object.assign(rabbit.exposure,{transformation:.2,strength:.15,acidity:.1,fire:.08});
  const appearance=rabbitAppearance(rabbit,1000),rig=rabbitRig(appearance.bodyKey);
  assert.equal(appearance.bodyKey,'transformation_t02');
  const pixels=new Uint8ClampedArray(256*192*4);
  for(let i=0;i<pixels.length;i+=4){pixels[i]=210;pixels[i+1]=180;pixels[i+2]=150;pixels[i+3]=i%12?255:0;}
  const original=pixels.slice(),out=shadeRabbitSurface(pixels,256,192,appearance,12);
  let changed=0;
  for(let y=0;y<192;y++)for(let x=0;x<256;x++){
    const i=(y*256+x)*4;
    assert.equal(out[i+3],original[i+3]);
    if(x>=rig.eyeX-22&&x<=rig.eyeX+23&&y>=rig.eyeY-20&&y<=rig.eyeY+24 || y>=166)
      assert.deepEqual(out.slice(i,i+4),original.slice(i,i+4));
    if(out[i]!==original[i]||out[i+1]!==original[i+1]||out[i+2]!==original[i+2])changed++;
  }
  assert.ok(changed>100,'secondary effects still have their own surface response');
  assert.deepEqual(pixels,original,'preparing a pose never edits a decoded source frame');
});

test('living rabbits have distinct idle, sniff, grazing, blinking, ears and hop poses', () => {
  const rabbit=createRabbitColony(1000).rabbits[0],original=JSON.stringify(rabbit),poses=[];
  for(let time=0;time<10000;time+=100)poses.push(rabbitArtPose(rabbit,time));
  assert.ok(poses.some(p=>p.activity==='sniff')&&poses.some(p=>p.activity==='graze'));
  assert.ok(poses.some(p=>p.ear!==0)&&poses.some(p=>p.blink));
  assert.ok(new Set(poses.map(p=>p.breath)).size>1);
  assert.notEqual(rabbitArtPose(rabbit,0,{activity:'hop',gait:1}).paw,rabbitArtPose(rabbit,0,{activity:'hop',gait:2}).paw);
  assert.equal(JSON.stringify(rabbit),original);
});

test('historical references and dead rabbits keep exactly the same pose at every time', () => {
  const rabbit=createRabbitColony(1000).rabbits[0];
  assert.deepEqual(rabbitArtPose(rabbit,0,{reference:true}),rabbitArtPose(rabbit,99999,{reference:true}));
  rabbit.stats.alive=false;rabbit.exposure.poison=.4;rabbit.exposure.love=.5;
  assert.deepEqual(rabbitArtPose(rabbit,0),rabbitArtPose(rabbit,99999));
});

test('breathing deforms the torso while the feet stay planted on the same ground pivot', () => {
  const rig=rabbitRig('effect_base'),pixels=new Uint8ClampedArray(256*192*4);
  for(let y=70;y<180;y++)for(let x=70;x<194;x++){const i=(y*256+x)*4;pixels[i]=x;pixels[i+1]=y;pixels[i+2]=140;pixels[i+3]=255;}
  const pose=rabbitArtPose(createRabbitColony(1000).rabbits[0],0,{reference:true});
  const resting=poseRabbitPixels(pixels,256,192,rig,pose),breathing=poseRabbitPixels(pixels,256,192,rig,{...pose,breath:2});
  assert.notDeepEqual(resting,breathing);
  assert.deepEqual(resting.slice(175*256*4),breathing.slice(175*256*4));
});

test('new anatomy and animation imports are available on the first offline reload',async()=>{
  const worker=await readFile('public/sw.js','utf8');
  for(const module of ['RabbitArtGeometry','RabbitArtRenderer'])assert.ok(worker.includes(`'./src/game/${module}.mjs'`));
});
