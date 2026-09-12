export function pointerDistance(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
export function pointerMidpoint(a,b){return {x:(a.x+b.x)/2,y:(a.y+b.y)/2};}
export function clampCameraDistance(value,min=4,max=44){return Math.max(min,Math.min(max,value));}
export function pinchCameraDistance(startDistance,startPinch,currentPinch,min=4,max=44){
  if(!(startPinch>0)||!(currentPinch>0))return clampCameraDistance(startDistance,min,max);
  return clampCameraDistance(startDistance*(startPinch/currentPinch),min,max);
}

export const DEFAULT_BOX_BY_MODE=Object.freeze({
  '3D':Object.freeze({width:5.4,height:7.2,depth:4.2}),
  '2D':Object.freeze({width:18,height:24,depth:4.2})
});
function finiteOr(v,fallback){const n=Number(v);return Number.isFinite(n)?n:fallback;}
export function normalizeModeBox(mode,box={}){const d=DEFAULT_BOX_BY_MODE[mode==='2D'?'2D':'3D'];return {width:Math.max(3,Math.min(60,finiteOr(box.width,d.width))),height:Math.max(3,Math.min(60,finiteOr(box.height,d.height))),depth:Math.max(3,Math.min(18,finiteOr(box.depth,d.depth)))};}
export class BoxModeState{
  constructor(mode='3D',boxes={}){this.mode=mode==='2D'?'2D':'3D';this.boxes={'3D':normalizeModeBox('3D',boxes?.['3D']||DEFAULT_BOX_BY_MODE['3D']),'2D':normalizeModeBox('2D',boxes?.['2D']||DEFAULT_BOX_BY_MODE['2D'])};}
  capture(mode,box){const key=mode==='2D'?'2D':'3D';this.boxes[key]=normalizeModeBox(key,box);return this.boxes[key];}
  boxFor(mode){const key=mode==='2D'?'2D':'3D';return {...this.boxes[key]};}
  switchTo(next,currentBox){this.capture(this.mode,currentBox);this.mode=next==='2D'?'2D':'3D';return this.boxFor(this.mode);}
}

const BOX_MODE_KEY='fluid-pocket-sandbox/boxes-v2';
function installBoxModeBridge(){
  const width=document.getElementById('boxWidth'),height=document.getElementById('boxHeight'),depth=document.getElementById('boxDepth'),b2=document.getElementById('view2dBtn'),b3=document.getElementById('view3dBtn');if(!width||!height||!depth||!b2||!b3)return;
  const modeNow=()=>b2.classList.contains('active')?'2D':'3D',read=()=>({width:Number(width.value),height:Number(height.value),depth:Number(depth.value)});
  let stored=null;try{stored=JSON.parse(localStorage.getItem(BOX_MODE_KEY)||'null');}catch{}
  const initialMode=modeNow(),state=new BoxModeState(initialMode,stored?.boxes||{}),current=read();
  if(!stored){if(initialMode==='2D'){if(current.width>=10&&current.height>=12)state.capture('2D',current);}else state.capture('3D',current);}
  let applying=false;
  const persist=()=>{try{localStorage.setItem(BOX_MODE_KEY,JSON.stringify({version:2,boxes:state.boxes}));}catch{}};
  const apply=box=>{applying=true;width.value=String(box.width);height.value=String(box.height);depth.value=String(box.depth);width.dispatchEvent(new Event('input',{bubbles:true}));applying=false;persist();};
  const syncMode=()=>{const next=modeNow();if(next===state.mode)return;const target=state.switchTo(next,read());apply(target);};
  for(const input of [width,height,depth])input.addEventListener('input',()=>{if(applying)return;state.capture(state.mode,read());persist();});
  const observer=new MutationObserver(syncMode);observer.observe(b2,{attributes:true,attributeFilter:['class']});observer.observe(b3,{attributes:true,attributeFilter:['class']});
  const desired=state.boxFor(initialMode);if(initialMode==='2D'&&(current.width<10||current.height<12))apply(desired);else persist();
}
if(typeof document!=='undefined'&&typeof MutationObserver!=='undefined')queueMicrotask(installBoxModeBridge);
