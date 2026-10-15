import test from 'node:test';
import assert from 'node:assert/strict';
import {renderTintedLogoLayer} from './preview-logo-layer.mjs';

test('Logo 改色只发生在独立图层，不清空产品预览画布',()=>{
  const calls=[];
  const layer={
    getContext(){return {
      drawImage:(...args)=>calls.push(['drawImage',...args]),
      set globalCompositeOperation(value){calls.push(['composite',value]);},
      set fillStyle(value){calls.push(['fillStyle',value]);},
      fillRect:(...args)=>calls.push(['fillRect',...args])
    };}
  };
  const output=renderTintedLogoLayer({
    createCanvas:(width,height)=>Object.assign(layer,{width,height}),
    logoImage:{id:'logo'},width:120.4,height:48.2,color:'#873131'
  });
  assert.equal(output,layer);
  assert.deepEqual(calls,[
    ['drawImage',{id:'logo'},0,0,120,48],
    ['composite','source-in'],
    ['fillStyle','#873131'],
    ['fillRect',0,0,120,48],
    ['composite','source-over']
  ]);
});

test('Logo 预览可保留原始图像颜色',()=>{
  const calls=[];
  const layer={getContext(){return {drawImage:(...args)=>calls.push(['drawImage',...args])};}};
  renderTintedLogoLayer({createCanvas:(width,height)=>Object.assign(layer,{width,height}),logoImage:{id:'colored-logo'},width:32,height:16});
  assert.deepEqual(calls,[['drawImage',{id:'colored-logo'},0,0,32,16]]);
});
