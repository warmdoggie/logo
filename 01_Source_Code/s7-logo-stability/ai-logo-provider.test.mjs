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

test('APIMart model access errors are surfaced',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-apimart-error-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'wan2.7-image-pro',endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
    const png=await sharp({create:{width:1,height:1,channels:4,background:{r:0,g:0,b:0,alpha:1}}}).png().toBuffer();
    const processor=createAiLogoProcessor({configPath,pollIntervalMs:0,transport:async()=>new Response(JSON.stringify({error:{message:'This API key does not have access to model `wan2.7-image-pro`.'}}),{status:403,headers:{'content-type':'application/json'}})});
    await assert.rejects(()=>processor(png),/does not have access to model/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('APIMart network errors are surfaced',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-apimart-network-error-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'gpt-image-2',endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
    const png=await sharp({create:{width:1,height:1,channels:4,background:{r:0,g:0,b:0,alpha:1}}}).png().toBuffer();
    const processor=createAiLogoProcessor({configPath,transport:async()=>{throw Object.assign(Error('fetch failed'),{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});}});
    await assert.rejects(()=>processor(png),/UND_ERR_CONNECT_TIMEOUT/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('APIMart failed tasks surface the provider reason',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-apimart-task-error-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'gpt-image-2',endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
    const png=await sharp({create:{width:1,height:1,channels:4,background:{r:0,g:0,b:0,alpha:1}}}).png().toBuffer();
    const processor=createAiLogoProcessor({configPath,pollIntervalMs:0,transport:async(url)=>String(url).endsWith('/v1/images/generations')?Response.json({data:[{task_id:'task_failed_1'}]}):Response.json({data:{status:'failed',error:{message:'input image is not supported'}}})});
    await assert.rejects(()=>processor(png),/input image is not supported/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('APIMart gpt-image-2 configuration is accepted',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-gpt-image-2-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'gpt-image-2',endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
    assert.deepEqual(getAiLogoProviderStatus(configPath),{configured:true,provider:'APIMART',model:'gpt-image-2'});
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('APIMart gpt-image-2.5-flare configuration is accepted for Logo processing',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-gpt-image-2-5-flare-logo-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'gpt-image-2.5-flare',logoModel:'gpt-image-2.5-flare',endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
    assert.deepEqual(getAiLogoProviderStatus(configPath),{configured:true,provider:'APIMART',model:'gpt-image-2.5-flare'});
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('APIMart official suffix model is rejected because the project model is exactly gpt-image-2',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-gpt-image-2-official-rejected-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'gpt-image-2-official',endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
    assert.deepEqual(getAiLogoProviderStatus(configPath),{configured:false,provider:null,model:null});
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('APIMart gpt-image-2 direct image response is downloaded',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-gpt-image-2-response-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'gpt-image-2',endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
    const png=await sharp({create:{width:2,height:2,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:Buffer.from([0,0,0,255]),raw:{width:1,height:1,channels:4},left:0,top:0}]).png().toBuffer();
    let submitted;
    const processor=createAiLogoProcessor({configPath,pollIntervalMs:0,transport:async(url,options)=>{if(String(url).endsWith('/v1/images/generations')){submitted=JSON.parse(options.body);return Response.json({data:[{url:'https://upload.apimart.ai/logo.png'}]});}return new Response(png);}});
    const result=await processor(png);
    assert.equal(submitted.size,'1:1');
    assert.equal(submitted.resolution,'2K');
    assert.equal('enable_sequential' in submitted,false);
    assert.equal(result.provider,'APIMART');
    assert.equal(result.model,'gpt-image-2');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('APIMart uses a dedicated transparent logo model without changing the mockup model',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-logo-model-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'gpt-image-2',logoModel:'gpt-image-2.5-flare',endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
    const png=await sharp({create:{width:2,height:2,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:Buffer.from([0,0,0,255]),raw:{width:1,height:1,channels:4},left:0,top:0}]).png().toBuffer();
    let submitted;
    const processor=createAiLogoProcessor({configPath,pollIntervalMs:0,transport:async(url,options)=>{if(String(url).endsWith('/v1/images/generations')){submitted=JSON.parse(options.body);return Response.json({data:[{url:'https://upload.apimart.ai/logo.png'}]});}return new Response(png);}});
    const result=await processor(png);
    assert.equal(submitted.model,'gpt-image-2.5-flare');
    assert.equal(submitted.background,'transparent');
    assert.equal(result.model,'gpt-image-2.5-flare');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('APIMart Logo processing permits a five-minute async generation window',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-logo-timeout-'));
  const originalTimeout=AbortSignal.timeout;
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'gpt-image-2',logoModel:'gpt-image-2.5-flare',endpoint:'https://api.apimart.ai',apiKey:'test-key',timeoutMs:300000}));
    const png=await sharp({create:{width:2,height:2,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:Buffer.from([0,0,0,255]),raw:{width:1,height:1,channels:4},left:0,top:0}]).png().toBuffer();
    const requested=[];
    AbortSignal.timeout=duration=>{requested.push(duration);return new AbortController().signal;};
    const processor=createAiLogoProcessor({configPath,pollIntervalMs:0,transport:async url=>String(url).endsWith('/v1/images/generations')?Response.json({data:[{url:'https://upload.apimart.ai/logo.png'}]}):new Response(png)});
    await processor(png);
    assert.deepEqual(requested,[300000]);
  }finally{AbortSignal.timeout=originalTimeout;await rm(dir,{recursive:true,force:true});}
});

test('APIMart gpt-image-2 result hosted on getapib is downloaded',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-gpt-image-2-getapib-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'gpt-image-2',endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
    const png=await sharp({create:{width:2,height:2,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:Buffer.from([0,0,0,255]),raw:{width:1,height:1,channels:4},left:0,top:0}]).png().toBuffer();
    const processor=createAiLogoProcessor({configPath,pollIntervalMs:0,transport:async(url)=>String(url).endsWith('/v1/images/generations')?Response.json({data:[{url:'https://getapib.org/f/image/logo.png'}]}):new Response(png)});
    const result=await processor(png);
    assert.equal(result.width,2);
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
