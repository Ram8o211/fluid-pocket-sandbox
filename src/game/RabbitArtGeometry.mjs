// Native-pixel landmarks for the approved frames. Anatomy changes between
// tiers, so a single procedural eye/head position cannot fit every sprite.
const poses = {
  effect_base: [173,116,118,145,48,32,100,66],
  acid_t01: [173,116,118,145,48,32,100,66],
  acid_t02: [183,105,121,139,62,36,90,49],
  acid_t03: [187,100,122,138,67,39,86,42],
  acid_t04: [201,92,114,134,77,44,77,29],
  fire_t01: [173,116,118,145,48,32,100,66],
  fire_t02: [179,112,118,143,65,35,95,50],
  fire_t03: [191,107,119,142,72,37,91,40],
  fire_t04: [187,100,112,140,75,37,85,28],
  strength_t01: [173,107,119,145,48,32,92,56],
  strength_t02: [184,104,115,141,65,37,89,48],
  strength_t03: [201,96,109,134,76,43,81,37],
  strength_t04: [200,89,104,131,79,43,73,28],
  transformation_t01: [173,116,118,145,48,32,100,58],
  transformation_t02: [184,111,118,143,63,35,95,44],
  transformation_t03: [196,105,116,140,71,38,90,34],
  transformation_t04: [187,90,113,136,77,40,74,18]
};
const rigs = Object.fromEntries(Object.entries(poses).map(([key,v]) => [key,
  Object.freeze({eyeX:v[0],eyeY:v[1],hipX:v[2],hipY:v[3],rx:v[4],ry:v[5],earRoot:v[6],earTop:v[7]})]));
const clamp = value => Math.max(0,Math.min(1,value));
export const rabbitRig = key => rigs[key] || rigs.effect_base;

/** Soft surface mask. Heads, ears, silhouettes and feet never receive a
 * fragment of another animal, including at the weakest mixed-effect tiers. */
export function rabbitTorsoWeight(x,y,rig) {
  if (y < rig.eyeY + 12 || y > 164) return 0;
  const nx=(x-rig.hipX)/rig.rx,ny=(y-rig.hipY)/rig.ry;
  const headClear=Math.max(clamp((rig.eyeX-32-x)/14),clamp((y-rig.eyeY-38)/12));
  return clamp((1-nx*nx-ny*ny)*3)*clamp((164-y)/9)*clamp((y-rig.eyeY-12)/10)*headClear;
}

/** Surface color/lesions on the primary animal's own pixels. No foreign face,
 * leg or rectangular sprite crop can enter this composition. Alpha is retained. */
export function shadeRabbitSurface(source,width,height,appearance,seed=1) {
  const out=new Uint8ClampedArray(source),rig=rabbitRig(appearance.bodyKey);
  const secondary=appearance.secondary || [];
  if (!secondary.length) return out;
  const mix=(at,color,amount)=>{for(let k=0;k<3;k++)out[at+k]=Math.round(out[at+k]*(1-amount)+color[k]*amount);};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const at=(y*width+x)*4;if(!source[at+3])continue;
    const w=rabbitTorsoWeight(x,y,rig);if(!w)continue;
    for(const effect of secondary) {
      const tier=appearance.tiers[effect] || 0;
      if(effect==='strength') {
        const dx=(x-rig.hipX)/25,dy=(y-rig.hipY)/22;
        const ring=Math.abs(dx*dx+dy*dy-1)<.18;
        mix(at,ring?[110,77,62]:[244,190,117],w*(ring?.16+.035*tier:.04*tier));
      } else if(effect==='transformation') {
        const ridge=(x*3+y*5+(seed%23))%31<5;
        mix(at,ridge?[144,119,164]:[219,210,230],w*(ridge?.2+.035*tier:.055*tier));
      } else if(effect==='acidity') {
        for(let i=0;i<5;i++) {
          const cx=rig.hipX-27+(i*29+seed%13)%65,cy=rig.hipY-13+(i*19+seed%11)%31;
          const r=3+tier*2,d=((x-cx)/r)**2+((y-cy)/(r*.75))**2;
          if(d<1.25)mix(at,d<.62?[113,70,83]:[153,190,77],w*(d<.62?.62:.48)*clamp((1.25-d)*4));
        }
      } else if(effect==='fire') {
        const patch=((x>>2)*17+(y>>2)*29+seed)%23;
        mix(at,[47,40,44],w*(.1+.11*tier)*(patch<15?1:.35));
        if(appearance.burning&&patch===3)mix(at,[242,135,60],w*.55);
      }
    }
  }
  return out;
}

/** Rendering-only routine, independent of game advancement and wall-clock FPS. */
export function rabbitArtPose(rabbit,time=0,options={}) {
  const still={activity:'still',headX:0,headY:0,ear:0,breath:0,blink:0,chew:0,paw:0,flowX:0,flowY:0,effectFrame:0};
  if(rabbit.stats?.alive===false)return {...still,blink:1};
  if(options.reference)return still;
  const seed=Number(rabbit.mutation?.seed)||Number(String(rabbit.id||'').replace(/\D/g,''))||1;
  const tick=Math.floor(Math.max(0,time)/100),phase=(tick+seed%97)%96;
  const activity=options.activity|| (phase<32?'idle':phase<48?'sniff':phase<72?'graze':'idle');
  const slow=1-Math.min(.75,(rabbit.exposure?.freeze||0)/4*.75);
  const cycle=Math.floor(tick*slow)+seed%41;
  const breath=Math.round((Math.sin(cycle*Math.PI/12)+1)*1.1);
  const twitch=phase>78&&phase<86?Math.round(Math.sin((phase-78)*Math.PI/4)*5):0;
  const headY=activity==='graze'?6+Math.round(Math.sin(cycle*.8)*2):activity==='sniff'?Math.round(Math.sin(cycle*1.1)*2):0;
  const paw=activity==='hop'?[0,3,-2][Math.max(0,Math.min(2,options.gait||0))]:0;
  return {activity,headX:activity==='sniff'?Math.round(Math.sin(cycle*.7)*2):0,headY,
    ear:twitch,breath,blink:phase===18||phase===19?1:0,chew:activity==='graze'?cycle%2:0,paw,
    flowX:Math.round(Math.sin(cycle*.6)*2),flowY:Math.round(Math.sin(cycle*.9)*3),effectFrame:tick%24};
}

// Anatomy weights depend only on the supplied frame, not on animation time.
// Reuse them instead of recalculating ellipses for every animal on every tick.
const anatomyMasks=new Map();
function anatomyMask(width,height,rig) {
  const cached=anatomyMasks.get(rig);
  if(cached?.width===width&&cached.height===height)return cached.weights;
  const weights=new Float32Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=(y*width+x)*4;
    weights[at]=clamp((x-(rig.eyeX-48))/29)*clamp((rig.eyeY+45-y)/24);
    const ear=clamp((rig.earRoot-y)/Math.max(1,rig.earRoot-rig.earTop))*clamp((x-(rig.eyeX-65))/25);
    weights[at+1]=ear*ear;weights[at+2]=rabbitTorsoWeight(x,y,rig);
    weights[at+3]=clamp((y-154)/24)*(x>rig.hipX?1:-.55);
  }
  if(anatomyMasks.size>=6)anatomyMasks.delete(anatomyMasks.keys().next().value);
  anatomyMasks.set(rig,{width,height,weights});return weights;
}

/** Inverse nearest-pixel deformation: breathing, ears, head, lids and paws all
 * move within one continuous animal, rather than pasting displaced rectangles. */
export function poseRabbitPixels(source,width,height,rig,pose,muscle=0,ambient=false) {
  const out=new Uint8ClampedArray(source.length),weights=anatomyMask(width,height,rig);
  const sourcePixels=new Uint32Array(source.buffer,source.byteOffset,source.byteLength/4),outPixels=new Uint32Array(out.buffer);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const to=(y*width+x)*4,head=weights[to],torso=weights[to+2];
    let sx=x-pose.headX*head-pose.ear*weights[to+1];
    let sy=y-pose.headY*head+pose.breath*torso;
    if(muscle&&torso)sx=rig.hipX+(sx-rig.hipX)/(1+muscle*.13*torso);
    sx-=pose.paw*weights[to+3];
    if(pose.chew&&x>rig.eyeX+11&&y>rig.eyeY+5&&y<rig.eyeY+23)sx-=pose.chew;
    if(ambient&&head<.1&&torso<.05&&y<161){sx-=pose.flowX;sy-=pose.flowY;}
    let lid=false;
    if(pose.blink) {
      const dx=sx-rig.eyeX,dy=sy-rig.eyeY;
      if((dx/6)**2+(dy/7)**2<1){lid=Math.abs(dy)<.7&&Math.abs(dx)<4;sx=rig.eyeX-9;}
    }
    const ix=Math.round(sx),iy=Math.round(sy);if(ix<0||iy<0||ix>=width||iy>=height)continue;
    outPixels[to/4]=sourcePixels[iy*width+ix];
    if(lid&&out[to+3]){out[to]=80;out[to+1]=60;out[to+2]=55;}
  }
  return out;
}
