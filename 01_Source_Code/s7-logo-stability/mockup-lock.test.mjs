import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {lockOutsideLogo} from './mockup-lock.mjs';

test('烫金保留细微箔纹和字形内部压印边缘，框外和镂空像素完全不变',async()=>{
 const width=40,height=40,baseRaw=Buffer.alloc(width*height*4),guideRaw=Buffer.alloc(width*height*4),maskRaw=Buffer.alloc(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,k=i*4,inside=x>=8&&x<32&&y>=8&&y<32&&!(x>=18&&x<22&&y>=18&&y<22);
  baseRaw.set([210,200,190,255],k);guideRaw.set(inside?[196,160,82,255]:[210,200,190,255],k);maskRaw[i]=inside?255:0;
 }
 const encode=(data,channels)=>sharp(data,{raw:{width,height,channels}}).png().toBuffer();
 const base=await encode(baseRaw,4),guide=await encode(guideRaw,4),mask=await encode(maskRaw,1);
 const result=await lockOutsideLogo({baseImage:base,generatedImage:base,guideImage:guide,maskImage:mask,feather:0,foilFinish:'gold'});
 const raw=await sharp(result).raw().toBuffer();
 const values=[];
 for(let y=12;y<16;y++)for(let x=12;x<28;x++)values.push(raw[(y*width+x)*4]);
 assert.ok(Math.max(...values)-Math.min(...values)>=6,'平坦箔面仍应有可见的微小纹理变化');
 const mean=y=>Array.from({length:20},(_,x)=>raw[(y*width+x+10)*4]).reduce((a,b)=>a+b)/20;
 assert.ok(mean(8)>mean(31)+8,'字形内上缘与下缘有克制的亮暗对比');
 for(let i=0;i<maskRaw.length;i++)if(!maskRaw[i])assert.deepEqual(raw.subarray(i*4,i*4+4),baseRaw.subarray(i*4,i*4+4));
 for(let i=0;i<maskRaw.length;i++)if(maskRaw[i])assert.ok(raw[i*4]>=raw[i*4+1]&&raw[i*4+1]>raw[i*4+2],'保持金色，不能出现彩色光斑');
 const repeated=await lockOutsideLogo({baseImage:base,generatedImage:base,guideImage:guide,maskImage:mask,feather:0,foilFinish:'gold'});
 assert.deepEqual(result,repeated,'纹理必须稳定，不能每次保存随机变化');
});

test('AI成图只保留Logo区域，Logo之外恢复原图',async()=>{
  const base=await sharp({create:{width:2,height:1,channels:4,background:{r:10,g:20,b:30,alpha:1}}}).png().toBuffer();
  const generated=await sharp({create:{width:2,height:1,channels:4,background:{r:200,g:0,b:0,alpha:1}}}).composite([{input:await sharp({create:{width:1,height:1,channels:4,background:{r:0,g:200,b:0,alpha:1}}}).png().toBuffer(),left:1,top:0}]).png().toBuffer();
  const mask=await sharp({create:{width:2,height:1,channels:3,background:{r:0,g:0,b:0}}}).composite([{input:await sharp({create:{width:1,height:1,channels:3,background:{r:255,g:255,b:255}}}).png().toBuffer(),left:0,top:0}]).grayscale().png().toBuffer();
  const result=await lockOutsideLogo({baseImage:base,generatedImage:generated,maskImage:mask,feather:0});
  const raw=await sharp(result).raw().toBuffer();
  assert.deepEqual([...raw.subarray(0,4)],[200,0,0,255]);
  assert.deepEqual([...raw.subarray(4,8)],[10,20,30,255]);
});

test('AI不能重绘Logo字形，只能为原始Logo增加材质明暗',async()=>{
  const base=await sharp({create:{width:2,height:1,channels:4,background:{r:10,g:20,b:30,alpha:1}}}).png().toBuffer();
  const generated=await sharp({create:{width:2,height:1,channels:4,background:{r:10,g:20,b:30,alpha:1}}}).png().toBuffer();
  const guide=await sharp({create:{width:2,height:1,channels:4,background:{r:80,g:120,b:160,alpha:1}}}).png().toBuffer();
  const mask=await sharp({create:{width:2,height:1,channels:3,background:{r:0,g:0,b:0}}}).composite([{input:await sharp({create:{width:1,height:1,channels:3,background:{r:255,g:255,b:255}}}).png().toBuffer(),left:0,top:0}]).grayscale().png().toBuffer();
  const result=await lockOutsideLogo({baseImage:base,generatedImage:generated,guideImage:guide,maskImage:mask,feather:0});
  const raw=await sharp(result).raw().toBuffer();
  assert.deepEqual([...raw.subarray(0,4)],[80,120,160,255]);
  assert.deepEqual([...raw.subarray(4,8)],[10,20,30,255]);
});

test('金属材质保留可见明暗纹理，同时避免银箔通道饱和偏色',async()=>{
  const base=await sharp({create:{width:1,height:1,channels:4,background:{r:0,g:0,b:0,alpha:1}}}).png().toBuffer();
  const generated=await sharp({create:{width:1,height:1,channels:4,background:{r:255,g:255,b:255,alpha:1}}}).png().toBuffer();
  const guide=await sharp({create:{width:1,height:1,channels:4,background:{r:191,g:195,b:201,alpha:1}}}).png().toBuffer();
  const mask=await sharp({create:{width:1,height:1,channels:3,background:{r:255,g:255,b:255}}}).png().toBuffer();
  const result=await lockOutsideLogo({baseImage:base,generatedImage:generated,guideImage:guide,maskImage:mask,feather:0});
  const raw=await sharp(result).raw().toBuffer();
  assert.deepEqual([...raw],[225,230,237,255]);
});
