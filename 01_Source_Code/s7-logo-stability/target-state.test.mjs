import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cloneTarget} from './target-state.mjs';

test('cloning keeps a rotated logo inside the canvas using its aspect ratio',()=>{
  const copy=cloneTarget({id:'target-1',x:.88,y:.12,widthRatio:.2,rotation:45},['target-1'],.06,2);
  const halfWidth=(.2*Math.abs(Math.cos(Math.PI/4))+.4*Math.abs(Math.sin(Math.PI/4)))/2;
  const halfHeight=(.2*Math.abs(Math.sin(Math.PI/4))+.4*Math.abs(Math.cos(Math.PI/4)))/2;
  assert.ok(copy.x>=halfWidth&&copy.x<=1-halfWidth);
  assert.ok(copy.y>=halfHeight&&copy.y<=1-halfHeight);
});

test('复制带四点透视的Logo时，四点会随副本一起偏移',()=>{
  const copy=cloneTarget({
    id:'box',x:.5,y:.5,widthRatio:.2,rotation:0,
    quad:[{x:.4,y:.4},{x:.6,y:.4},{x:.6,y:.6},{x:.4,y:.6}]
  },['box']);
  assert.deepEqual(copy.quad,[{x:.46,y:.46},{x:.66,y:.46},{x:.66,y:.66},{x:.46,y:.66}]);
});

test('复制Logo会生成唯一ID并把副本轻微错开',()=>{
  const copy=cloneTarget({id:'product',x:.5,y:.5,widthRatio:.2,rotation:15},['product','product-copy']);
  assert.deepEqual(copy,{id:'product-copy-2',x:.56,y:.56,widthRatio:.2,rotation:15});
});

test('复制靠近边缘的Logo不会把副本放出画布',()=>{
  const copy=cloneTarget({id:'box',x:.94,y:.06,widthRatio:.2,rotation:0},['box']);
  assert.equal(copy.x,.9);
  assert.equal(copy.y,.12);
});
