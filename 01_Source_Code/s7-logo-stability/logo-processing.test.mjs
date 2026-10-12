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

test('加工Logo会沿边缘连续去除渐变底色',async()=>{
  const raw=Buffer.alloc(12*5*4);
  for(let y=0;y<5;y++)for(let x=0;x<12;x++){
    const shade=255-Math.min(x,11-x)*15;
    const i=(y*12+x)*4;
    raw[i]=shade;raw[i+1]=shade;raw[i+2]=shade;raw[i+3]=255;
  }
  for(let y=1;y<4;y++)for(let x=5;x<7;x++){
    const i=(y*12+x)*4;raw[i]=0;raw[i+1]=0;raw[i+2]=0;raw[i+3]=255;
  }
  const source=await sharp(raw,{raw:{width:12,height:5,channels:4}}).png().toBuffer();
  const output=await processLogo(source,{removeWhiteBackground:true,cropTransparentBounds:true,threshold:20});
  const meta=await sharp(output).metadata();
  assert.deepEqual({width:meta.width,height:meta.height},{width:2,height:3});
});
