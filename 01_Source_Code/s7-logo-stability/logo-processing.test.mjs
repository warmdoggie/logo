import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {processLogo} from './logo-processing.mjs';

test('加工Logo会去除边缘白底并裁剪透明边界',async()=>{
  const raw=Buffer.alloc(20*12*4,255);
  for(let y=4;y<8;y++)for(let x=7;x<13;x++){const i=(y*20+x)*4;raw[i]=0;raw[i+1]=0;raw[i+2]=0;raw[i+3]=255;}
  const source=await sharp(raw,{raw:{width:20,height:12,channels:4}}).png().toBuffer();
  const output=await processLogo(source,{removeWhiteBackground:true,cropTransparentBounds:true,threshold:24});
  const meta=await sharp(output).metadata();
  assert.deepEqual({width:meta.width,height:meta.height},{width:6,height:4});
  const {data}=await sharp(output).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(data[3],255);
  assert.deepEqual([...data.subarray(0,3)],[0,0,0]);
});

test('加工Logo会识别并去除黑色边缘背景',async()=>{
  const raw=Buffer.alloc(20*12*4);
  for(let i=0;i<20*12;i++){raw[i*4]=0;raw[i*4+1]=0;raw[i*4+2]=0;raw[i*4+3]=255;}
  for(let y=4;y<8;y++)for(let x=7;x<13;x++){const i=(y*20+x)*4;raw[i]=255;raw[i+1]=255;raw[i+2]=255;}
  const source=await sharp(raw,{raw:{width:20,height:12,channels:4}}).png().toBuffer();
  const output=await processLogo(source,{removeWhiteBackground:true,cropTransparentBounds:true,threshold:24});
  const meta=await sharp(output).metadata();
  assert.deepEqual({width:meta.width,height:meta.height},{width:6,height:4});
  const {data}=await sharp(output).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(data[3],255);
  assert.deepEqual([...data.subarray(0,3)],[255,255,255]);
});
