import test from 'node:test';
import assert from 'node:assert/strict';
import { LaboratoryRenderer } from '../src/game/LaboratoryRenderer.mjs';

function renderer(width,height,rect){
  const view=Object.create(LaboratoryRenderer.prototype);
  view.canvas={width,height,getBoundingClientRect:()=>rect};
  return view;
}
test('spoon coordinates follow the visible cauldron through portrait and short-screen letterboxing',()=>{
  for(const rect of [{left:8,top:220,width:304,height:65},{left:8,top:210,width:377,height:260},{left:308,top:260,width:664,height:300}])for(const scale of [1,2]){
    const view=renderer(384*scale,232*scale,rect);
    for(const [x,y] of [[0,-1.1],[-1.8,-.5],[1.8,-.5],[0,.9]]){
      const canvasX=(192+x*40)*scale,canvasY=(158-y*40)*scale;
      const ratio=Math.min(rect.width/(384*scale),rect.height/(232*scale));
      const clientX=rect.left+(rect.width-384*scale*ratio)/2+canvasX*ratio;
      const clientY=rect.top+(rect.height-232*scale*ratio)/2+canvasY*ratio;
      const mapped=view.screenToWorld(clientX,clientY);
      assert.ok(Math.abs(mapped.x-x)<1e-8&&Math.abs(mapped.y-y)<1e-8,'a stroke on visible matter must target that same matter');
      const projected=view.projectWorldToScreen(x,y);assert.ok(Math.abs(projected.x-clientX)<1e-8&&Math.abs(projected.y-clientY)<1e-8);
    }
  }
});
test('empty or hidden canvas geometry never produces non-finite pointer coordinates',()=>{
  const view=renderer(384,232,{left:0,top:0,width:0,height:0});
  const point=view.screenToWorld(0,0);assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));
});
