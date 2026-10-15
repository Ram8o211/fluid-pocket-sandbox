import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

export async function verifyRabbitAnimation(page) {
  const result=await page.evaluate(async()=>{
    const {loadRabbitArtwork,rabbitArtwork,rabbitSprite,rabbitEffectPieces}=await import('./src/game/RabbitAssets.mjs');
    const {createRabbitColony,RABBIT_THRESHOLDS}=await import('./src/game/rabbits.mjs');
    const {rabbitAppearance}=await import('./src/game/RabbitAppearance.mjs');
    const {rabbitRig,rabbitArtPose,poseRabbitPixels}=await import('./src/game/RabbitArtGeometry.mjs');
    const {drawRabbit}=await import('./src/game/RabbitRenderer.mjs');
    const {TestingRenderer}=await import('./src/game/TestingRenderer.mjs');
    const {rabbitArtCacheSize}=await import('./src/game/RabbitArtRenderer.mjs');
    await loadRabbitArtwork();
    const create=()=>createRabbitColony(1000).rabbits[0];
    const bodyPixels=r=>{const c=document.createElement('canvas');c.width=256;c.height=192;const v=rabbitAppearance(r,1000);c.getContext('2d').drawImage(rabbitSprite(r,0,0,0,false,v),0,0);return c.getContext('2d').getImageData(0,0,256,192).data;};
    const draw=(r,time=0,options={})=>{const c=document.createElement('canvas');c.width=240;c.height=190;drawRabbit(c.getContext('2d'),r,120,173,96,time,{now:1000,...options});return c;};
    const effects=['strength','transformation','acidity','fire'];let headErrors=0,alphaErrors=0,blinkHoles=0;
    for(const effect of effects)for(const fraction of [.125,.375,.625,.875]){
      const original=create();original.exposure[effect]=fraction*RABBIT_THRESHOLDS[effect];original.activeFireUntil=12000;
      const a=bodyPixels(original),rig=rabbitRig(rabbitAppearance(original,1000).bodyKey);
      const mixed=structuredClone(original);for(const other of effects)if(other!==effect)mixed.exposure[other]=fraction*.5*RABBIT_THRESHOLDS[other];
      const b=bodyPixels(mixed),blink=poseRabbitPixels(a,256,192,rig,{...rabbitArtPose(original,0,{reference:true}),blink:1});
      for(let y=0;y<192;y++)for(let x=0;x<256;x++){
        const i=(y*256+x)*4;if(a[i+3]!==b[i+3])alphaErrors++;
        if(a[i+3]&&!blink[i+3])blinkHoles++;
        if(x>=rig.eyeX-22&&x<=rig.eyeX+23&&y>=rig.eyeY-20&&y<=rig.eyeY+24)
          for(let k=0;k<4;k++)if(a[i+k]!==b[i+k])headErrors++;
      }
    }
    const sheet=document.createElement('canvas');sheet.width=1200;sheet.height=800;const sc=sheet.getContext('2d');sc.fillStyle='#102837';sc.fillRect(0,0,1200,800);sc.imageSmoothingEnabled=false;
    for(let row=0;row<4;row++)for(let col=0;col<5;col++){
      const r=create();r.exposure[effects[row]]=.2*RABBIT_THRESHOLDS[effects[row]];
      if(col)r.exposure[effects[col-1]]+=(col-1===row?0:.1*RABBIT_THRESHOLDS[effects[col-1]]);
      r.exposure.poison=.12;r.activeFireUntil=12000;
      sc.drawImage(draw(r,0,{reference:true}),col*240,row*200+10);
      sc.fillStyle='#f5d0a1';sc.font='13px monospace';sc.fillText(`${effects[row]} + ${col?effects[col-1]:'none'}`,col*240+8,row*200+16);
    }
    const frames=document.createElement('canvas');frames.width=1440;frames.height=600;const fc=frames.getContext('2d');fc.fillStyle='#102837';fc.fillRect(0,0,1440,600);fc.imageSmoothingEnabled=false;
    const animationCases=[{}, {transformation:.2,strength:.15,poison:.12},{fire:1.8,love:.2}];
    const timings=[];
    for(let row=0;row<3;row++)for(let col=0;col<6;col++){
      const r=create();Object.assign(r.exposure,animationCases[row]);r.activeFireUntil=12000;
      const activity=col===3?'graze':col===4?'sniff':'idle',before=performance.now();
      const frame=draw(r,col*400,{activity});timings.push(performance.now()-before);fc.drawImage(frame,col*240,row*200+10);
      fc.fillStyle='#f5d0a1';fc.font='13px monospace';fc.fillText(`${activity} · ${col*400} ms`,col*240+8,row*200+16);
    }
    const hash=data=>{let h=2166136261;for(let i=0;i<data.length;i++)h=Math.imul(h^data[i],16777619)>>>0;return h;};
    const pixels=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    const plain=create(),poison=create();poison.exposure.poison=.2;
    const fumes=[],idle=[];
    for(const time of [0,300,600,900,1200]){
      const a=pixels(draw(plain,time,{activity:'idle'})),b=pixels(draw(poison,time,{activity:'idle'}));
      const delta=new Uint8Array(a.length);for(let i=0;i<a.length;i++)delta[i]=a[i]^b[i];fumes.push(hash(delta));idle.push(hash(a));
    }
    const sample=create();Object.assign(sample.exposure,{transformation:.2,strength:.15,poison:.12,love:.1});
    const unchanged=JSON.stringify(sample),historical=draw(sample,0,{reference:true}).toDataURL()===draw(sample,9999,{reference:true}).toDataURL();
    sample.stats.alive=false;const deadStill=draw(sample,0).toDataURL()===draw(sample,9999).toDataURL();sample.stats.alive=true;
    const c=document.createElement('canvas');c.width=640;c.height=350;const renderer=new TestingRenderer(c);
    renderer.render(sample,null,0);renderer.render(sample,null,600);renderer.togglePause();renderer.render(sample,null,650);const paused=c.toDataURL();
    renderer.render(sample,null,1600);const pauseStable=c.toDataURL()===paused;
    renderer.togglePause();renderer.render(sample,null,1800);renderer.render(sample,null,2200);const resumed=c.toDataURL()!==paused;
    const blinkTimes=[],earTimes=[];for(let t=0;t<9600;t+=100){const p=rabbitArtPose(plain,t);if(p.blink)blinkTimes.push(t);if(p.ear)earTimes.push(t);}
    const routine=document.createElement('canvas');routine.width=1440;routine.height=400;
    const rc=routine.getContext('2d');rc.fillStyle='#102837';rc.fillRect(0,0,1440,400);
    const actions=[['idle',0,{activity:'idle'}],['blink',blinkTimes[0],{activity:'idle'}],['ear twitch',earTimes[0],{activity:'idle'}],
      ['graze',1200,{activity:'graze'}],['hop tuck',0,{activity:'hop',gait:1}],['hop reach',0,{activity:'hop',gait:2}]];
    for(let row=0;row<2;row++)for(let col=0;col<actions.length;col++){
      const [label,time,options]=actions[col],r=row?sample:plain;
      rc.drawImage(draw(r,time,options),col*240,row*200+10);
      rc.fillStyle='#f5d0a1';rc.font='13px monospace';rc.fillText(label,col*240+8,row*200+16);
    }
    const colonyTimes=[];
    for(let t=0;t<6;t++){
      const started=performance.now();
      for(let i=0;i<12;i++){
        const r=create();r.mutation.seed+=i;Object.assign(r.exposure,animationCases[i%3]);r.activeFireUntil=12000;
        draw(r,t*300,{activity:'idle'});
      }
      colonyTimes.push(performance.now()-started);
    }
    const benchmark=create();Object.assign(benchmark.exposure,{transformation:1,strength:.2,poison:.1,love:.1});
    for(let i=0;i<150;i++)draw(benchmark,i*100,{activity:'idle'});
    return {headErrors,alphaErrors,blinkHoles,fumeFrames:new Set(fumes).size,idleFrames:new Set(idle).size,
      pieces:rabbitEffectPieces('poison_t01').length,blink:blinkTimes.length,ears:earTimes.length,
      historical,deadStill,pauseStable,resumed,unchanged:JSON.stringify(sample)===unchanged,cache:rabbitArtCacheSize(),
      maximum:Math.max(...timings),colonyMaximum:Math.max(...colonyTimes),alignment:sheet.toDataURL(),animation:frames.toDataURL(),routine:routine.toDataURL()};
  });
  assert.equal(result.headErrors,0,'mixed body effects must preserve the primary head/eye pixels for every tier');
  assert.equal(result.alphaErrors,0,'surface effects must never paste another silhouette');
  assert.equal(result.blinkHoles,0,'closing the native eye must retain opaque fur on every body tier');
  assert.ok(result.fumeFrames>=4,'green fumes move independently of the rabbit body');
  assert.ok(result.idleFrames>=2,'idle rabbits visibly breathe in place');
  assert.ok(result.pieces>2&&result.blink>0&&result.ears>0);
  assert.ok(result.historical&&result.deadStill&&result.pauseStable&&result.resumed&&result.unchanged);
  assert.ok(result.cache<=128,'animated native-frame storage stays bounded');
  for(const key of ['alignment','animation','routine'])await writeFile(`test-results/rabbit-${key}.png`,Buffer.from(result[key].split(',')[1],'base64'));
  console.log(`Rabbit animation: intact heads/silhouettes, ${result.fumeFrames} independent fume frames, ${result.idleFrames} idle frames, blink/ears, pause/resume and static corpses; bounded cache ${result.cache}. Slowest cold frame ${result.maximum.toFixed(1)} ms; twelve-rabbit batch ${result.colonyMaximum.toFixed(1)} ms.`);
}

/** Exercise the actual card, pen and comparison clocks through visible controls. */
export async function verifyRabbitViewAnimation(page,rabbitId) {
  const portrait=page.locator(`[data-rabbit-portrait="${rabbitId}"]`);
  const capture=()=>page.locator(`[data-rabbit-portrait="${rabbitId}"], #rabbitPenCanvas, #creatureCanvas`).evaluateAll(canvases=>canvases.map(canvas=>({id:canvas.id||'portrait',png:canvas.toDataURL()})));
  await portrait.scrollIntoViewIfNeeded();
  const samples=[await capture()];
  for(let i=0;i<4;i++){await page.clock.runFor(300);await page.clock.resume();samples.push(await capture());}
  for(let i=0;i<samples[0].length;i++)assert.ok(new Set(samples.map(sample=>sample[i].png)).size>=2,`${samples[0][i].id} animates in the real trial UI`);
  await page.locator('[data-action="pause-trial"]').click();await portrait.scrollIntoViewIfNeeded();
  await page.clock.runFor(100);await page.clock.resume();const paused=await capture();
  await page.clock.runFor(1300);await page.clock.resume();const still=await capture();
  for(let i=0;i<paused.length;i++)assert.ok(still[i].png===paused[i].png,`Pause view freezes ${paused[i].id}`);
  await page.locator('[data-action="pause-trial"]').click();await portrait.scrollIntoViewIfNeeded();
  const resumed=[];
  for(let i=0;i<4;i++){await page.clock.runFor(300);await page.clock.resume();resumed.push(await capture());}
  for(let i=0;i<paused.length;i++)assert.ok(resumed.some(sample=>sample[i].png!==paused[i].png),`${paused[i].id} resumes through the real control`);
  console.log('Rabbit UI animation: live portraits, colony and comparison move, pause together and resume.');
}
