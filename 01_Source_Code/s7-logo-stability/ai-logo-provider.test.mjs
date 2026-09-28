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
    const result=await processor(png);
    assert.equal(sent.url,'http://127.0.0.1:3999/edit');
    assert.equal(sent.options.headers.Authorization,'Bearer test-key');
    assert.equal(sent.body.targetColor,'#000000');
    assert.equal(result.width,6);
    assert.equal(result.height,4);
    assert.equal(getAiLogoProviderStatus(configPath).configured,true);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('AI Logo服务适配器支持APIMart提交任务、轮询并下载结果',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-apimart-logo-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'wan2.7-image-pro',endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
    const raw=Buffer.alloc(6*4*4);
    for(let y=1;y<3;y++)for(let x=1;x<5;x++){const i=(y*6+x)*4;raw[i+3]=255;}
    const png=await sharp(raw,{raw:{width:6,height:4,channels:4}}).png().toBuffer();
    let submitted,downloaded=false;
    const processor=createAiLogoProcessor({configPath,pollIntervalMs:0,transport:async(url,options)=>{
      if(String(url).endsWith('/v1/images/generations')){submitted=JSON.parse(options.body);return Response.json({data:[{task_id:'task_logo_1',status:'processing'}]});}
      if(String(url).includes('/v1/tasks/task_logo_1'))return Response.json({data:{status:'completed',progress:100,result:{images:[{url:['https://upload.apimart.ai/logo.png']}]}}});
      downloaded=true;return new Response(png);
    }});
    const result=await processor(png);
    assert.equal(submitted.model,'wan2.7-image-pro');
    assert.equal(submitted.n,1);
    assert.match(submitted.image_urls[0],/^data:image\/png;base64,/);
    assert.match(submitted.prompt,/transparent/i);
    assert.match(submitted.prompt,/black/i);
    assert.equal(downloaded,true);
    assert.equal(result.provider,'APIMART');
  }finally{await rm(dir,{recursive:true,force:true});}
});
