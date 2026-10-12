import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import sharp from 'sharp';
import {createAiMockupRenderer} from './ai-mockup-provider.mjs';

test('AI上样渲染器提交四个工艺请求并下载成图',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-ai-mockup-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'gpt-image-2',endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
    const output=await sharp({create:{width:12,height:8,channels:3,background:{r:220,g:210,b:200}}}).png().toBuffer();
    const sent=[];
    const renderer=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async(url,options)=>{
      if(String(url).endsWith('/v1/images/generations')){sent.push(JSON.parse(options.body));return Response.json({data:[{task_id:`task_${sent.length}`}]});}
      if(String(url).includes('/v1/tasks/'))return Response.json({data:{status:'completed',result:{images:[{url:['https://getapib.org/f/image/mockup.png']}]}}});
      return new Response(output);
    }});
    const result=await renderer({
      baseImage:'data:image/png;base64,BASE',
      logoImage:'data:image/png;base64,LOGO',
      guides:[
        {version:'ORIGINAL',dataUrl:'data:image/png;base64,GUIDE_1'},
        {version:'BLACK',dataUrl:'data:image/png;base64,GUIDE_2'},
        {version:'GOLD FOIL',dataUrl:'data:image/png;base64,GUIDE_3'},
        {version:'SILVER FOIL',dataUrl:'data:image/png;base64,GUIDE_4'}
      ],
      originalColor:'#C54B78',size:'1:1'
    });
    assert.deepEqual(result.map(item=>item.version),['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL']);
    assert.equal(sent.length,4);
    assert.equal(sent.every(request=>request.image_urls[1]==='data:image/png;base64,BASE'),true);
    assert.equal(sent.every(request=>!/ORIGINAL composition master/i.test(request.prompt)),true);
    assert.deepEqual(sent.map(request=>request.image_urls[2]),[
      'data:image/png;base64,GUIDE_1','data:image/png;base64,GUIDE_2',
      'data:image/png;base64,GUIDE_3','data:image/png;base64,GUIDE_4'
    ]);
    assert.match(sent[2].prompt,/thin gold foil/i);
    assert.equal(result.every(item=>item.bytes.equals(output)),true);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('APIMart gpt-image-2.5-flare configuration is accepted for mockups',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-gpt-image-2-5-flare-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'gpt-image-2.5-flare',endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
    const output=await sharp({create:{width:12,height:8,channels:3,background:{r:220,g:210,b:200}}}).png().toBuffer();
    let submitted;
    const renderer=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async(url,options)=>{
      if(String(url).endsWith('/v1/images/generations')){submitted=JSON.parse(options.body);return Response.json({data:[{url:'https://getapib.org/f/mockup.png'}]});}
      return new Response(output);
    }});
    await renderer({baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',guides:[
      {version:'ORIGINAL',dataUrl:'data:image/png;base64,G1'},{version:'BLACK',dataUrl:'data:image/png;base64,G2'},
      {version:'GOLD FOIL',dataUrl:'data:image/png;base64,G3'},{version:'SILVER FOIL',dataUrl:'data:image/png;base64,G4'}
    ],originalColor:'#000000'});
    assert.equal(submitted.model,'gpt-image-2.5-flare');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('APIMart mockup requests use the configured proxy',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-apimart-mockup-proxy-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'gpt-image-2',endpoint:'https://api.apimart.ai',proxyUrl:'http://127.0.0.1:7897',apiKey:'test-key'}));
    const output=await sharp({create:{width:2,height:2,channels:3,background:{r:220,g:210,b:200}}}).png().toBuffer();
    let dispatcher,requestHeaders;
    const renderer=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async(url,options)=>{
      dispatcher=options.dispatcher;
      requestHeaders=options.headers||requestHeaders;
      if(String(url).endsWith('/v1/images/generations'))return Response.json({data:[{url:'https://getapib.org/f/mockup.png'}]});
      return new Response(output);
    }});
    await renderer({baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',guides:[
      {version:'ORIGINAL',dataUrl:'data:image/png;base64,G1'},{version:'BLACK',dataUrl:'data:image/png;base64,G2'},
      {version:'GOLD FOIL',dataUrl:'data:image/png;base64,G3'},{version:'SILVER FOIL',dataUrl:'data:image/png;base64,G4'}
    ],originalColor:'#000000'});
    assert.ok(dispatcher,'APIMart mockup transport should receive a proxy dispatcher');
    assert.equal(new Headers(requestHeaders).get('accept-encoding'),'identity');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('APIMart mockup rejects an invalid provider JSON response with a provider error',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-apimart-invalid-json-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'gpt-image-2',endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
    const renderer=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async()=>new Response('not-json',{status:200})});
    await assert.rejects(()=>renderer({baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',guides:[
      {version:'ORIGINAL',dataUrl:'data:image/png;base64,G1'},{version:'BLACK',dataUrl:'data:image/png;base64,G2'},
      {version:'GOLD FOIL',dataUrl:'data:image/png;base64,G3'},{version:'SILVER FOIL',dataUrl:'data:image/png;base64,G4'}
    ],originalColor:'#000000'}),/APIMart 返回了无法解析的 JSON 响应/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
