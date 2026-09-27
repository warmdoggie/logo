import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cloneTarget} from './target-state.mjs';

test('复制Logo会生成唯一ID并把副本轻微错开',()=>{
  const copy=cloneTarget({id:'product',x:.5,y:.5,widthRatio:.2,rotation:15},['product','product-copy']);
  assert.deepEqual(copy,{id:'product-copy-2',x:.56,y:.56,widthRatio:.2,rotation:15});
});

test('复制靠近边缘的Logo不会把副本放出画布',()=>{
  const copy=cloneTarget({id:'box',x:.94,y:.06,widthRatio:.2,rotation:0},['box']);
  assert.equal(copy.x,.9);
  assert.equal(copy.y,.12);
});
