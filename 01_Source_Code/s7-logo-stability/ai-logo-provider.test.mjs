import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import sharp from 'sharp';
import {createAiLogoProcessor,getAiLogoProviderStatus} from './ai-logo-provider.mjs';

test('AI Logo服务适配器发送透明底黑字请求并接收PNG',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-ai-logo-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'JSON_IMAGE_EDIT_V1',model:'test-model',endpoint:'http://127.0.0.1:3999/edit',apiKey:'test-key'}));
    const raw=Buffer.alloc(6*4*4);
    for(let y=1;y<3;y++)for(let x=1;x<5;x++){const i=(y*6+x)*4;raw[i+3]=255;}
    const png=await sharp(raw,{raw:{width:6,height:4,channels:4}}).png().toBuffer();
    let sent;
    const processor=createAiLogoProcessor({configPath,transport:async(url,options)=>{sent={url,options,body:JSON.parse(options.body)};return Response.json({imageBase64:png.toString('base64')});}});
    const result=await processor(Buffer.from('source-logo'));
    assert.equal(sent.url,'http://127.0.0.1:3999/edit');
    assert.equal(sent.options.headers.Authorization,'Bearer test-key');
    assert.equal(sent.body.targetColor,'#000000');
    assert.equal(result.width,6);
    assert.equal(result.height,4);
    assert.equal(getAiLogoProviderStatus(configPath).configured,true);
  }finally{await rm(dir,{recursive:true,force:true});}
});
