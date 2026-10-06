import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clampTargetCenter,pointerToNormalized,rotationFromPointer,widthRatioFromScalePointer} from './demo-geometry.mjs';

test('rotated logo center is clamped using its rendered aspect ratio',()=>{
  const target=clampTargetCenter({x:.95,y:.05,widthRatio:.2,rotation:45},2);
  assert.ok(target.x<.95&&target.y>.05);
  assert.ok(target.x>=.21213203435596428&&target.x<=.7878679656440357);
  assert.ok(target.y>=.21213203435596428&&target.y<=.7878679656440357);
});

test('把画布指针位置换算为可保存的0到1坐标',()=>{
  assert.deepEqual(pointerToNormalized(150,75,{left:50,top:25,width:200,height:100}),{x:.5,y:.5});
  assert.deepEqual(pointerToNormalized(-10,200,{left:50,top:25,width:200,height:100}),{x:0,y:1});
});

test('画布尺寸无效时拒绝保存拖动位置',()=>{
  assert.throws(()=>pointerToNormalized(1,1,{left:0,top:0,width:0,height:100}),/画布尺寸无效/);
});

test('根据旋转手柄位置计算Logo旋转角度',()=>{
  assert.equal(rotationFromPointer({x:50,y:50},{x:50,y:20}),0);
  assert.equal(rotationFromPointer({x:50,y:50},{x:80,y:50}),90);
});

test('根据缩放手柄位置计算Logo宽度比例',()=>{
  assert.equal(widthRatioFromScalePointer({x:.5,y:.5,rotation:0},{x:70,y:50},100),.4);
});
