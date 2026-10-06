import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {lockOutsideLogo} from './mockup-lock.mjs';

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
