import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pointerToNormalized} from './demo-geometry.mjs';

test('把画布指针位置换算为可保存的0到1坐标',()=>{
  assert.deepEqual(pointerToNormalized(150,75,{left:50,top:25,width:200,height:100}),{x:.5,y:.5});
  assert.deepEqual(pointerToNormalized(-10,200,{left:50,top:25,width:200,height:100}),{x:0,y:1});
});

test('画布尺寸无效时拒绝保存拖动位置',()=>{
  assert.throws(()=>pointerToNormalized(1,1,{left:0,top:0,width:0,height:100}),/画布尺寸无效/);
});
