import { graphicsPreset, normalizeGraphicsSettings } from './GraphicsSettings.mjs';
import { Phase } from '../simulation/Phase.mjs';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export class PlanarRenderer{
  constructor(canvas,sim){
    this.canvas=canvas;this.sim=sim;this.ctx=canvas.getContext('2d',{alpha:false});
    this.graphics=graphicsPreset('ECO');this.graphics=normalizeGraphicsSettings({...this.graphics,representation:'CLOUDS',resolutionScale:.72,renderFraction:.65,effectsScale:.35});
    this.debugMode='none';this.yaw=0;this.pitch=0;this.distance=12;this.drawCount=0;this.cloudMap=new Map();this.resize();
  }
  getGraphicsSettings(){return {...this.graphics};}
  configureGraphics(settings){this.graphics=normalizeGraphicsSettings({...this.graphics,...settings});this.resize(true);}
  applyGraphicsPreset(name){this.graphics=graphicsPreset(name);if(name==='ECO')this.graphics.representation='CLOUDS';this.resize(true);return this.getGraphicsSettings();}
  resize(force=false){const baseDpr=Math.min(globalThis.devicePixelRatio||1,1.25),dpr=Math.max(.45,baseDpr*this.graphics.resolutionScale),w=Math.max(1,Math.floor((this.canvas.clientWidth||innerWidth)*dpr)),h=Math.max(1,Math.floor((this.canvas.clientHeight||innerHeight)*dpr));if(force||this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}this.aspect=w/h;}
  updateBox(){}
  setOrbit(panX,panY,zoom){this.yaw=clamp(panX,-4,4);this.pitch=clamp(panY,-4,4);this.distance=clamp(zoom,6,22);}
  transform(){const b=this.sim.env.box,w=this.canvas.width,h=this.canvas.height,zoom=12/this.distance,scale=Math.min(w/(b.width*1.12),h/(b.height*1.12))*zoom;return {w,h,scale,cx:w*.5+this.yaw*scale,cy:h*.5+this.pitch*scale};}
  projectWorldToScreen(x,y){const t=this.transform(),r=this.canvas.getBoundingClientRect(),px=(t.cx+x*t.scale)/this.canvas.width*r.width+r.left,py=(t.cy-y*t.scale)/this.canvas.height*r.height+r.top;return{x:px,y:py,depth:1};}
  screenToWorld(clientX,clientY){const r=this.canvas.getBoundingClientRect(),t=this.transform(),px=(clientX-r.left)/r.width*this.canvas.width,py=(clientY-r.top)/r.height*this.canvas.height;return{x:(px-t.cx)/t.scale,y:-(py-t.cy)/t.scale,z:0};}
  pickParticle(clientX,clientY,maxPixels=82){const ps=this.sim.ps;let best=-1,bestD2=maxPixels*maxPixels;for(let i=0;i<ps.count;i++){const q=this.projectWorldToScreen(ps.x[i],ps.y[i]),dx=q.x-clientX,dy=q.y-clientY,d2=dx*dx+dy*dy;if(d2<bestD2){best=i;bestD2=d2;}}return best<0?null:{index:best,x:ps.x[best],y:ps.y[best],z:0,distancePx:Math.sqrt(bestD2)};}
  particleColor(ps,i){let r=ps.r[i],g=ps.g[i],b=ps.b[i];if(this.debugMode==='temperature'){const t=clamp(ps.temperature[i],0,1);r=t;g=.22;b=1-t;}else if(this.debugMode==='density'){const d=clamp(ps.density[i]/1.7,0,1);r=d;g=.3;b=1-d;}else if(this.debugMode==='velocity'){const v=clamp(Math.hypot(ps.vx[i],ps.vy[i])/5,0,1);r=v;g=.35+.45*(1-v);b=1-v;}else if(this.debugMode==='material'){const id=ps.materialId[i];r=((id*97)%255)/255;g=((id*57)%255)/255;b=((id*173)%255)/255;}else if(this.debugMode==='phase'){if(ps.phase[i]===Phase.SOLID){r=.78;g=.82;b=.86}else if(ps.phase[i]===Phase.GAS){r=.67;g=.86;b=1;}}return {r:Math.round(r*255),g:Math.round(g*255),b:Math.round(b*255)};}
  drawParticles(ctx,t){const ps=this.sim.ps,stride=Math.max(1,Math.round(1/this.graphics.renderFraction));let count=0;for(let i=0;i<ps.count;i+=stride){const c=this.particleColor(ps,i),x=t.cx+ps.x[i]*t.scale,y=t.cy-ps.y[i]*t.scale,base=ps.phase[i]===Phase.GAS?.18:ps.phase[i]===Phase.SOLID?.13:.16,r=Math.max(1.5,base*t.scale),alpha=ps.phase[i]===Phase.GAS?Math.min(.28,ps.opacity[i]*.4):Math.min(.86,ps.opacity[i]);ctx.globalAlpha=alpha;ctx.fillStyle=`rgb(${c.r},${c.g},${c.b})`;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();count++;}this.drawCount=count;}
  drawClouds(ctx,t){const ps=this.sim.ps,cell=Math.max(.2,this.graphics.cloudCellSize),stride=Math.max(1,Math.round(1/this.graphics.renderFraction)),map=this.cloudMap;map.clear();for(let i=0;i<ps.count;i+=stride){const gx=Math.round(ps.x[i]/cell),gy=Math.round(ps.y[i]/cell),key=`${gx}:${gy}`;let v=map.get(key);if(!v){v={x:0,y:0,r:0,g:0,b:0,a:0,n:0,gas:0};map.set(key,v);}const c=this.particleColor(ps,i);v.x+=ps.x[i];v.y+=ps.y[i];v.r+=c.r;v.g+=c.g;v.b+=c.b;v.a+=ps.opacity[i];v.gas+=ps.phase[i]===Phase.GAS?1:0;v.n++;}
    for(const v of map.values()){const n=v.n,x=t.cx+(v.x/n)*t.scale,y=t.cy-(v.y/n)*t.scale,density=Math.min(1,Math.sqrt(n)/4),gas=v.gas/n,r=Math.max(2,cell*t.scale*(.38+.16*density));ctx.globalAlpha=Math.min(.74,(v.a/n)*(.38+.34*density)*(1-gas*.45));ctx.fillStyle=`rgb(${Math.round(v.r/n)},${Math.round(v.g/n)},${Math.round(v.b/n)})`;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}this.drawCount=map.size;
  }
  drawEffects(ctx,t){const scale=this.graphics.effectsScale;if(scale<=.01)return;const rx=this.sim.reactions,stride=Math.max(1,Math.round(1/Math.max(.08,scale)));ctx.globalCompositeOperation='lighter';for(let i=0;i<rx.eventCount;i+=stride){const intensity=rx.eventIntensity[i];if(intensity<.18)continue;ctx.globalAlpha=.18*intensity*scale;ctx.fillStyle='#8de7ff';ctx.beginPath();ctx.arc(t.cx+rx.eventX[i]*t.scale,t.cy-rx.eventY[i]*t.scale,Math.max(2,(.18+.3*intensity)*t.scale),0,Math.PI*2);ctx.fill();}ctx.globalCompositeOperation='source-over';}
  update(){}
  render(){this.resize();const ctx=this.ctx;if(!ctx)return;const t=this.transform(),b=this.sim.env.box;ctx.globalAlpha=1;ctx.fillStyle='#090b0f';ctx.fillRect(0,0,t.w,t.h);const left=t.cx-b.width*t.scale/2,top=t.cy-b.height*t.scale/2,width=b.width*t.scale,height=b.height*t.scale;ctx.fillStyle='#0d1118';ctx.fillRect(left,top,width,height);ctx.strokeStyle='rgba(255,255,255,.15)';ctx.lineWidth=Math.max(1,this.canvas.width/900);ctx.strokeRect(left,top,width,height);if(this.debugMode==='grid'){ctx.strokeStyle='rgba(255,255,255,.055)';ctx.lineWidth=1;const step=this.sim.grid.cellSize*t.scale;for(let x=left+step;x<left+width;x+=step){ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,top+height);ctx.stroke();}for(let y=top+step;y<top+height;y+=step){ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(left+width,y);ctx.stroke();}}
    if(this.graphics.representation==='CLOUDS')this.drawClouds(ctx,t);else this.drawParticles(ctx,t);this.drawEffects(ctx,t);ctx.globalAlpha=1;
  }
  dispose(){}
}
