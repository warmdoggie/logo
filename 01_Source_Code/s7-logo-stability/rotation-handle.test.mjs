import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {rotationGestureMode,rotationHandleLocalPosition} from './rotation-handle.mjs';

test('rotation handle sits outside the upper-right corner of the Logo box',()=>{
  assert.deepEqual(rotationHandleLocalPosition(200,100,32),{x:132,y:-82});
});

test('short rotation press is a 90 degree step and long press is free rotation',()=>{
  assert.equal(rotationGestureMode(200),'step');
  assert.equal(rotationGestureMode(350),'drag');
  assert.equal(rotationGestureMode(600),'drag');
});

test('canvas renders a curved arrow at the rotation handle',()=>{
  const script=fs.readFileSync(new URL('./demo.js',import.meta.url),'utf8');
  assert.match(script,/rotationHandleLocalPosition\(/);
  assert.match(script,/function drawRotationArrow\(/);
  assert.match(script,/context\.arc\(/);
  assert.match(script,/drawRotationArrow\(context,handles\.rotation/);
});
