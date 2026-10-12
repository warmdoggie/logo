import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chooseContrastColor} from './contrast-color.mjs';

test('深色图位自动选择白色 Logo',()=>{
  const data=Uint8Array.from([20,20,20,255,20,20,20,255,20,20,20,255,20,20,20,255]);
  assert.equal(chooseContrastColor({data,width:2,height:2}), '#FFFFFF');
});

test('浅色图位自动选择黑色 Logo',()=>{
  const data=Uint8Array.from([240,240,240,255,240,240,240,255,240,240,240,255,240,240,240,255]);
  assert.equal(chooseContrastColor({data,width:2,height:2}), '#000000');
});
