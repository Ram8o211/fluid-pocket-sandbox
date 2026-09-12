import test from 'node:test';
import assert from 'node:assert/strict';
import { pointerDistance, pointerMidpoint, pinchCameraDistance } from '../src/app/gestureMath.mjs';

test('pinch apart zooms camera in and pinch together zooms out',()=>{
  assert.ok(pinchCameraDistance(12,100,200)<12);
  assert.ok(pinchCameraDistance(12,100,50)>12);
});
test('pinch zoom respects camera bounds and supports the full 3D zoom range',()=>{
  assert.equal(pinchCameraDistance(12,100,1000),4);
  assert.equal(pinchCameraDistance(12,100,1),44);
  assert.equal(pinchCameraDistance(30,100,50,4,44),44);
  assert.equal(pinchCameraDistance(12,100,1,4,22),22,'2D can keep its tighter bound');
});
test('two-pointer helpers compute stable distance and midpoint',()=>{
  assert.equal(pointerDistance({x:0,y:0},{x:3,y:4}),5);
  assert.deepEqual(pointerMidpoint({x:0,y:2},{x:4,y:6}),{x:2,y:4});
});
