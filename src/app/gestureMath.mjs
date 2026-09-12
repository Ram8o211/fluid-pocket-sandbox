export function pointerDistance(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
export function pointerMidpoint(a,b){return {x:(a.x+b.x)/2,y:(a.y+b.y)/2};}
export function clampCameraDistance(value,min=4,max=44){return Math.max(min,Math.min(max,value));}
export function pinchCameraDistance(startDistance,startPinch,currentPinch,min=4,max=44){
  if(!(startPinch>0)||!(currentPinch>0))return clampCameraDistance(startDistance,min,max);
  return clampCameraDistance(startDistance*(startPinch/currentPinch),min,max);
}
