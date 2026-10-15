import { rabbitAppearance, rabbitEffectKey } from './RabbitAppearance.mjs';
import { rabbitArtwork, rabbitArtworkVersion, rabbitSprite, rabbitEffectPieces } from './RabbitAssets.mjs';
import { rabbitRig, rabbitArtPose, poseRabbitPixels } from './RabbitArtGeometry.mjs';
import { RABBIT_THRESHOLDS } from './rabbits.mjs';

const frames=new Map(),sources=new WeakMap();
let serial=0;
const response=(rabbit,key)=>{const load=Math.max(0,Number(rabbit.exposure?.[key])||0);return load<=.003?0:Math.pow(Math.min(1,load/RABBIT_THRESHOLDS[key]),.36);};
const PADDING=32,BASELINE=180+PADDING;

function sourcePixels(image) {
  if(sources.has(image))return sources.get(image);
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=192;
  const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const source={id:++serial,pixels:ctx.getImageData(0,0,256,192).data};sources.set(image,source);return source;
}

function floatingPieces(ctx,key,frame,seed,reference=false,hostRig=null,tier=4) {
  if(reference&&!hostRig) {const image=rabbitArtwork(key);if(image)ctx.drawImage(image,0,PADDING);return;}
  const parts=rabbitEffectPieces(key,Boolean(hostRig)),sourceRig=hostRig?rabbitRig(key):null;
  for(let i=0;i<parts.length;i++) {
    if(hostRig&&i>tier*3)break;
    const part=parts[i],phase=((frame+i*7+seed%24)%24)/24;
    const life=Math.min(1,phase*5,(1-phase)*5),rise=Math.round(phase*(hostRig?14:22));
    const scale=hostRig?Math.min(1.1,hostRig.rx/sourceRig.rx):1;
    const x=hostRig?hostRig.hipX+(part.x-sourceRig.hipX)*scale:part.x;
    const y=hostRig?hostRig.hipY+(part.y-sourceRig.hipY)*scale:part.y;
    ctx.globalAlpha=Math.max(.06,life)*(hostRig?.75:1);
    ctx.drawImage(part.image,Math.round(x+Math.sin(phase*Math.PI*2+i)*3),Math.round(y+PADDING-rise),Math.max(1,Math.round(part.width*scale)),Math.max(1,Math.round(part.height*scale)));
  }
  ctx.globalAlpha=1;
}

/** Returns false until the art loads, leaving the established pixel fallback.
 * Cached, native-pixel frames are shared by cards, colony, cage and comparison. */
export function drawRabbitArtwork(ctx,rabbit,x,floor,size,time=0,options={}) {
  const now=options.now??Date.now(),appearance=rabbitAppearance(rabbit,now);
  if(!rabbitArtwork(appearance.bodyKey)||typeof document==='undefined'||rabbit.deathAppearance==='dissolved')return false;
  const alive=rabbit.stats?.alive!==false,reference=Boolean(options.reference);
  const pose=rabbitArtPose(rabbit,time,options),rig=rabbitRig(appearance.bodyKey);
  const body=rabbitSprite(rabbit,0,response(rabbit,'freeze'),response(rabbit,'death'),rabbit.deathAppearance==='charred',appearance);
  if(!body)return false;
  const source=sourcePixels(body),seed=Number(rabbit.mutation?.seed)||1;
  const muscle=appearance.secondary.includes('strength')?response(rabbit,'strength'):0;
  const key=JSON.stringify([rabbitArtworkVersion(),source.id,pose,appearance.overlays,appearance.burning,appearance.angry,reference,muscle,seed%24]);
  let frame=frames.get(key);
  if(!frame) {
    frame=document.createElement('canvas');frame.width=256;frame.height=224;
    const fc=frame.getContext('2d');fc.imageSmoothingEnabled=false;
    const image=fc.createImageData(256,192);
    const ambient=alive&&!reference&&(appearance.body==='transformation'||appearance.body==='acidity'||appearance.body==='fire'&&appearance.burning&&appearance.tiers.fire>=2);
    image.data.set(poseRabbitPixels(source.pixels,256,192,rig,pose,muscle,ambient));fc.putImageData(image,0,PADDING);
    if(alive) {
      if(appearance.angry) {
        const eyeX=rig.eyeX+pose.headX,eyeY=rig.eyeY+pose.headY+PADDING;
        fc.fillStyle='#d66c62';fc.fillRect(eyeX-5,eyeY-8,5,2);fc.fillRect(eyeX,eyeY-6,4,2);
      }
      if(appearance.secondary.includes('fire')&&appearance.burning)floatingPieces(fc,rabbitEffectKey('fire',Math.max(2,appearance.tiers.fire)),pose.effectFrame,seed,reference,rig,appearance.tiers.fire);
      for(const overlay of appearance.overlays)floatingPieces(fc,overlay.key,pose.effectFrame,seed,reference);
      for(const effect of ['freeze','death'])if(appearance.tiers[effect]) {
        for(let i=0;i<3+appearance.tiers[effect];i++) {
          const rise=(pose.effectFrame+i*5)%24,dx=rig.hipX-35+i*12;
          fc.fillStyle=effect==='freeze'?'#a9deec':'#87709f';fc.globalAlpha=.35+(24-rise)/48;
          fc.fillRect(dx,rig.hipY+PADDING-rise-12,2,effect==='freeze'?2:4);
        }
        fc.globalAlpha=1;
      }
    }
    if(frames.size>=128)frames.delete(frames.keys().next().value);
    frames.set(key,frame);
  }
  const baby=rabbit.age==='baby'||rabbit.age==='juvenile',growth=Math.max(0,Math.min(1,(rabbit.stats?.growth||0)/100));
  const scale=Math.max(1,Math.round(size/48*(baby?.65+growth*.25:1))),collapse=alive?1:.55;
  const hop=alive&&!reference?Number(options.hop)||0:0;
  ctx.save();ctx.imageSmoothingEnabled=false;ctx.translate(Math.round(x),Math.round(floor));ctx.scale(options.facing===-1?-1:1,1);
  ctx.fillStyle='#1c242d';
  ctx.fillRect(-20*scale,0,40*scale,scale);ctx.fillRect(-22*scale,scale,44*scale,scale);ctx.fillRect(-20*scale,2*scale,40*scale,scale);
  ctx.drawImage(frame,-48*scale,Math.round(-BASELINE*.375*scale*collapse-hop*scale),96*scale,Math.round(84*scale*collapse));
  if(options.selected){ctx.fillStyle=options.cullMode?'#f19b8d':'#ffe0a0';ctx.fillRect(-28*scale,scale,5*scale,scale);ctx.fillRect(23*scale,scale,5*scale,scale);}
  ctx.restore();return true;
}

export const rabbitArtCacheSize=()=>frames.size;
