import { RABBIT_EFFECT_FILES, rabbitEffectKey } from './RabbitAppearance.mjs';
import { rabbitRig, rabbitTorsoWeight, shadeRabbitSurface } from './RabbitArtGeometry.mjs';

// Keep the source pack's native pixels; each decoded sprite is shared by the
// cards, comparison view and colony. Node tests retain the procedural fallback.
const files = {
  moon: '01_rabbits/rabbit_moon_card.png',
  clover: '01_rabbits/rabbit_clover_card.png',
  hazel: '01_rabbits/rabbit_hazel_card.png',
  pepper: '01_rabbits/rabbit_pepper_card.png',
  room: '05_environment/trial_room_background_empty.png',
  plaque: '02_ui_frames/caption_plaque.png',
  ...Object.fromEntries(Object.entries(RABBIT_EFFECT_FILES).map(([key, file]) => [key, `effects/${file}`]))
};
const images = new Map();
const tinted = new Map();
const pieces = new Map();
let loading = null, revision = 0;
export const rabbitArtworkVersion = () => revision;

export function loadRabbitArtwork() {
  if (typeof Image === 'undefined') return Promise.resolve();
  loading ||= Promise.all(Object.entries(files).map(([key, file]) => new Promise(resolve => {
    const image = new Image();
    image.onload = () => { images.set(key, image); revision++; resolve(); };
    image.onerror = () => resolve();
    image.src = new URL(`../../public/assets/rabbit-trials/${file}`, import.meta.url).href;
  })));
  return loading;
}

export function rabbitArtwork(key) { loadRabbitArtwork(); return images.get(key); }

// Original colony identities retain their names/colors. Newborn and purchased
// rabbits inherit a deterministic coat without adding anything to saved state.
export function rabbitCoat(rabbit) {
  const named = String(rabbit.name || '').toLowerCase();
  if (['moon', 'clover', 'hazel', 'pepper'].includes(named)) return named;
  const seed = Number(rabbit.mutation?.seed) || Number(String(rabbit.id || '').replace(/\D/g, '')) || 0;
  return ['moon', 'clover', 'hazel', 'pepper'][(seed >>> 0) % 4];
}

// Isolate connected transparent-art pieces once. Each wisp/heart has its own
// pixels and home position, so it can rise/curl/fade without moving a whole sheet.
export function rabbitEffectPieces(key, fireOnly=false) {
  const cacheKey=`${key}:${fireOnly}`;
  if(pieces.has(cacheKey))return pieces.get(cacheKey);
  const image=rabbitArtwork(key);if(!image)return [];
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=192;
  const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,256,192),data=pixels.data;
  const mask=new Uint8Array(256*192),rig=rabbitRig(key);
  for(let y=0;y<192;y++)for(let x=0;x<256;x++) {
    const p=y*256+x,i=p*4,r=data[i],g=data[i+1],b=data[i+2];
    const face=x>rig.eyeX-38&&y<rig.eyeY+36;
    mask[p]=data[i+3]>32&&(!fireOnly||(!face&&rabbitTorsoWeight(x,y,rig)<.01&&y<166&&r>155&&g>35&&r>b*1.8&&g>b*1.2&&g<r*.95))?1:0;
  }
  const result=[];
  for(let start=0;start<mask.length;start++)if(mask[start]) {
    const queue=[start],members=[];mask[start]=0;let left=255,top=191,right=0,bottom=0;
    while(queue.length) {
      const p=queue.pop(),x=p%256,y=Math.floor(p/256);members.push(p);
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
      for(const q of [x>0?p-1:-1,x<255?p+1:-1,y>0?p-256:-1,y<191?p+256:-1])if(q>=0&&mask[q]){mask[q]=0;queue.push(q);}
    }
    if(members.length<4)continue;
    const part=document.createElement('canvas');part.width=right-left+1;part.height=bottom-top+1;
    const pc=part.getContext('2d'),partPixels=pc.createImageData(part.width,part.height);
    for(const p of members){const to=((Math.floor(p/256)-top)*part.width+p%256-left)*4;for(let k=0;k<4;k++)partPixels.data[to+k]=data[p*4+k];}
    pc.putImageData(partPixels,0,0);result.push({image:part,x:left,y:top,width:part.width,height:part.height});
  }
  result.sort((a,b)=>b.width*b.height-a.width*a.height);
  pieces.set(cacheKey,result);return result;
}

// Tint an alpha silhouette once per exposure stage, never the background. The
// small cache is bounded even during interpolated, multichannel dose replays.
export function rabbitSprite(rabbit, poison, frost, death, charred, appearance = null) {
  const coat = appearance?.bodyKey || rabbitCoat(rabbit), base = rabbitArtwork(coat);
  if (!base) return null;
  const deceased = rabbit.stats?.alive === false;
  const cooledScorch = appearance?.body === 'fire' && !appearance.burning ? appearance.scorch : 0;
  const steps = [appearance ? 0 : poison, frost, death, cooledScorch].map(value => Math.round(value * 12));
  const secondary = appearance?.secondary || [];
  if (!charred && !deceased && steps.every(value => !value) && !secondary.length) return base;
  const layers = secondary.map(effect => `${effect}:${appearance.tiers[effect]}`).join(',');
  const key = `${revision}:${coat}:${steps.join(':')}:${charred}:${deceased}:${layers}:${appearance?.burning}:${secondary.length?Number(rabbit.mutation?.seed)||1:0}`;
  if (tinted.has(key)) return tinted.get(key);
  const canvas = document.createElement('canvas'); canvas.width = base.width; canvas.height = base.height;
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(base, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  if(secondary.length) {
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    pixels.data.set(shadeRabbitSurface(pixels.data,canvas.width,canvas.height,appearance,Number(rabbit.mutation?.seed)||1));
    ctx.putImageData(pixels,0,0);
  }
  const colors = ['#94b46e', '#a6dce9', '#746485', '#29242f'];
  for (let i = 0; i < steps.length; i++) if (steps[i]) {
    ctx.globalAlpha = steps[i] / 12 * (i === 3 ? .8 : .5); ctx.fillStyle = colors[i]; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (charred) { ctx.globalAlpha = .88; ctx.fillStyle = '#29242f'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  // Death is a color-only surface treatment. `source-atop` preserves the final
  // potion-effect silhouette, fur details, tears, scars and transparency.
  if (deceased) {
    ctx.globalAlpha = charred ? .2 : .34;
    ctx.fillStyle = '#686676';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (tinted.size >= 48) tinted.delete(tinted.keys().next().value);
  tinted.set(key, canvas); return canvas;
}
