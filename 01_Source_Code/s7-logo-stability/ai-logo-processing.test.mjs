import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {buildAiLogoRequest,buildApimartLogoRequest,validateAiLogoOutput} from './ai-logo-processing.mjs';

test('AI Logo请求明确要求透明底黑字并保持原Logo结构',()=>{
  const request=buildAiLogoRequest('AQIDBA==',{model:'test-model'});
  assert.equal(request.contract,'JSON_IMAGE_EDIT_V1');
  assert.equal(request.model,'test-model');
  assert.equal(request.logoImage,'AQIDBA==');
  assert.equal(request.targetColor,'#000000');
  assert.match(request.prompt,/transparent/i);
  assert.match(request.prompt,/black/i);
  assert.match(request.prompt,/exact|preserve/i);
});

test('AI Logo输出必须包含透明像素和可见像素',async()=>{
  const raw=Buffer.alloc(6*4*4);
  for(let y=1;y<3;y++)for(let x=1;x<5;x++){const i=(y*6+x)*4;raw[i]=0;raw[i+1]=0;raw[i+2]=0;raw[i+3]=255;}
  const png=await sharp(raw,{raw:{width:6,height:4,channels:4}}).png().toBuffer();
  const result=await validateAiLogoOutput(png);
  assert.deepEqual({width:result.width,height:result.height},{width:6,height:4});
});

test('AI Logo输出没有透明背景时拒绝继续',async()=>{
  const png=await sharp({create:{width:4,height:4,channels:3,background:{r:255,g:255,b:255}}}).png().toBuffer();
  await assert.rejects(()=>validateAiLogoOutput(png),/透明 PNG/);
});

test('APIMart官方GPT Image模型明确请求透明PNG',()=>{
  const request=buildApimartLogoRequest('data:image/png;base64,AQID',{model:'gpt-image-2'});
  assert.equal(request.background,'transparent');
  assert.equal(request.output_format,'png');
  assert.equal(request.quality,'high');
});
