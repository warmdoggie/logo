import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import sharp from 'sharp';
import {createAiMockupRenderer} from './ai-mockup-provider.mjs';
import {renderLogoSet} from './index.mjs';

test('GPT and Flux preserve thin silver and surface-aware black ink in the same image',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-print-surface-'));
  try{
    const configPath=join(dir,'ai-provider.json'),dataUrl=bytes=>`data:image/png;base64,${bytes.toString('base64')}`;
    const base=await sharp({create:{width:64,height:32,channels:4,background:'#c9aaa0'}}).png().toBuffer();
    const logo=await sharp(Buffer.from('<svg width="24" height="12"><path fill="black" fill-rule="evenodd" d="M0 0H24V12H0Z M7 3V9H17V3Z"/></svg>')).png().toBuffer();
    const targets=[{id:'body',x:.25,y:.5,widthRatio:.35,printFinish:'VERSION'},{id:'carton',x:.75,y:.5,widthRatio:.35,carrierType:'CARTON_FRONT',printFinish:'INK',color:'#000000'}];
    const set=await renderLogoSet({baseImage:base,logoImage:logo,targets,originalColor:'#000000'});
    const guide=set.outputs.find(o=>o.version==='SILVER FOIL');
    const generated=await sharp({create:{width:64,height:32,channels:4,background:'#ffffff'}}).png().toBuffer();
    let expected;
    for(const model of ['flux-3-image','gpt-image-2.5-flare']){
      await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model,endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
      const renderer=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async url=>String(url).endsWith('/v1/images/generations')?Response.json({data:[{url:'https://getapib.org/f/surface.png'}]}):new Response(generated)});
      const [result]=await renderer({model,originalColor:'#000000',onlyVersion:'SILVER FOIL',baseImage:dataUrl(base),logoImage:dataUrl(logo),targets,guides:[{version:'SILVER FOIL',dataUrl:dataUrl(guide.bytes),maskDataUrl:dataUrl(guide.mask),foilMaskDataUrl:dataUrl(guide.foilMask),goldMaskDataUrl:dataUrl(guide.goldMask)}]});
      const output=await sharp(result.bytes).ensureAlpha().raw().toBuffer(),original=await sharp(base).ensureAlpha().raw().toBuffer();
      const mask=await sharp(guide.mask).greyscale().raw().toBuffer(),foil=await sharp(guide.foilMask).greyscale().raw().toBuffer();
      let inkCount=0,silverCount=0;
      for(let i=0;i<mask.length;i++){
        if(mask[i]===0)assert.deepEqual(output.subarray(i*4,i*4+4),original.subarray(i*4,i*4+4));
        if(mask[i]!==255)continue;
        if(foil[i]){silverCount++;assert.ok(output[i*4]>120&&output[i*4]<255);}
        else{inkCount++;assert.ok(output[i*4]>0&&output[i*4]<=22);}
      }
      assert.ok(inkCount>0&&silverCount>0);
      if(expected)assert.deepEqual(output,expected);else expected=output;
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

for(const version of ['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL'])test(`${version} renders locally without provider configuration and preserves ink and cutouts`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-local-mockup-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    const base=await sharp({create:{width:128,height:64,channels:4,background:'#c9aaa0'}}).png().toBuffer();
    const logo=await sharp(Buffer.from('<svg width="24" height="12"><path fill="#235689" fill-rule="evenodd" d="M0 0H24V12H0Z M7 3V9H17V3Z"/></svg>')).png().toBuffer();
    const targets=[{id:'body',x:.25,y:.5,widthRatio:.4,printFinish:'VERSION',preserveOriginalColor:true},{id:'carton',x:.75,y:.5,widthRatio:.4,carrierType:'CARTON_FRONT',printFinish:'INK',color:'#000000'}];
    const set=await renderLogoSet({baseImage:base,logoImage:logo,targets,originalColor:'#000000'});
    const guide=set.outputs.find(item=>item.version===version);
    let calls=0;const stages=[];
    const renderer=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async()=>{calls++;throw Error('local mockups must not be sent to APIMart');}});
    const [result]=await renderer({model:'local',onlyVersion:version,baseImage:`data:image/png;base64,${base.toString('base64')}`,logoImage:`data:image/png;base64,${logo.toString('base64')}`,targets,originalColor:'#000000',guides:[{version,dataUrl:`data:image/png;base64,${guide.bytes.toString('base64')}`,maskDataUrl:`data:image/png;base64,${guide.mask.toString('base64')}`,foilMaskDataUrl:`data:image/png;base64,${guide.foilMask.toString('base64')}`,goldMaskDataUrl:`data:image/png;base64,${guide.goldMask.toString('base64')}`}],onStage:(_version,stage)=>stages.push(stage)});
    assert.equal(calls,0);
    assert.ok(!result.bytes.equals(base));
    assert.deepEqual(stages,['generating','saving']);
    const pixels=await sharp(result.bytes).ensureAlpha().raw().toBuffer(),original=await sharp(base).ensureAlpha().raw().toBuffer();
    const mask=await sharp(guide.mask).greyscale().raw().toBuffer(),foil=await sharp(guide.foilMask).greyscale().raw().toBuffer();
    const tones=new Set();let ink=0;
    for(let i=0;i<mask.length;i++){
      const k=i*4;
      if(!mask[i])assert.deepEqual(pixels.subarray(k,k+4),original.subarray(k,k+4));
      if(mask[i]!==255)continue;
      if(!foil[i]){ink++;if(version!=='ORIGINAL'||i%128>=64)assert.ok(pixels[k]<=22);continue;}
      tones.add(pixels[k]);
      if(version==='GOLD FOIL')assert.ok(pixels[k]>pixels[k+1]&&pixels[k+1]>pixels[k+2]);
    }
    assert.ok(ink>0);
    if(version==='ORIGINAL')assert.deepEqual([...pixels.subarray((32*128+13)*4,(32*128+13)*4+3)],[35,86,137]);
    if(version==='ORIGINAL'||version==='BLACK')assert.deepEqual(pixels,await sharp(guide.bytes).ensureAlpha().raw().toBuffer(),'ordinary ink must retain the exact guide colors and antialiased edges');
    else assert.ok(tones.size>2);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('Flux 生成后通过 mask 锁定 Logo 区域，框选外恢复原图',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-flux-mask-lock-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'flux-3-image',endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
    const base=await sharp({create:{width:2,height:1,channels:4,background:{r:10,g:20,b:30,alpha:1}}}).png().toBuffer();
    const generated=await sharp({create:{width:2,height:1,channels:4,background:{r:220,g:30,b:40,alpha:1}}}).png().toBuffer();
    const guide=await sharp({create:{width:2,height:1,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:await sharp({create:{width:1,height:1,channels:4,background:{r:50,g:100,b:150,alpha:1}}}).png().toBuffer(),left:0,top:0}]).png().toBuffer();
    const mask=await sharp({create:{width:2,height:1,channels:3,background:{r:0,g:0,b:0}}}).composite([{input:await sharp({create:{width:1,height:1,channels:3,background:{r:255,g:255,b:255}}}).png().toBuffer(),left:0,top:0}]).png().toBuffer();
    let submitted;
    const renderer=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async(url,options)=>{
      if(String(url).endsWith('/v1/images/generations')){submitted=JSON.parse(options.body);return Response.json({data:[{url:'https://getapib.org/f/masked.png'}]});}
      return new Response(generated);
    }});
    const result=await renderer({model:'flux-3-image',onlyVersion:'ORIGINAL',baseImage:`data:image/png;base64,${base.toString('base64')}`,logoImage:'data:image/png;base64,LOGO',maskImage:`data:image/png;base64,${mask.toString('base64')}`,guides:[{version:'ORIGINAL',dataUrl:`data:image/png;base64,${guide.toString('base64')}`}],originalColor:'#000000'});
    const output=await sharp(result[0].bytes).ensureAlpha().raw().toBuffer();
    const original=await sharp(base).ensureAlpha().raw().toBuffer();
    const guidePixels=await sharp(guide).ensureAlpha().raw().toBuffer();
    assert.equal('mask_url' in submitted,false);
    assert.deepEqual([...output.subarray(0,4)],[...guidePixels.subarray(0,4)]);
    assert.deepEqual([...output.subarray(4,8)],[...original.subarray(4,8)]);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('四个生图任务在任何一个完成前全部提交，GPT 和 Flux 均并行', {timeout:5000}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-parallel-submit-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    const image=await sharp({create:{width:2,height:2,channels:3,background:'#fff'}}).png().toBuffer();
    for(const model of ['gpt-image-2.5-flare','flux-3-image']){
      await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model,endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
      let submitted=0,release,allSubmitted;
      const gate=new Promise(resolve=>{release=resolve;});
      const ready=new Promise(resolve=>{allSubmitted=resolve;});
      const renderer=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async(url)=>{
        if(String(url).endsWith('/v1/images/generations')){
          submitted++;if(submitted===4)allSubmitted();
          await gate;
          return Response.json({data:[{url:'https://getapib.org/f/parallel.png'}]});
        }
        return new Response(image);
      }});
      const rendering=renderer({model,baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',guides:['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL'].map(version=>({version,dataUrl:'data:image/png;base64,GUIDE'})),originalColor:'#000000'});
      let timer;
      try{
        await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`${model} 未同时提交四个任务`)),1500);})]);
        assert.equal(submitted,4);
      }finally{clearTimeout(timer);release();await rendering;}
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

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

test('四张成图逐张报告提交、生成、保存，单张失败不丢失已完成版本',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-ai-mockup-progress-'));
  try{
    const configPath=join(dir,'ai-provider.json');
    await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'flux-3-image',endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
    const output=await sharp({create:{width:4,height:4,channels:3,background:'#fff'}}).png().toBuffer();
    const events=[],results=[];
    const renderer=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async(url,options)=>{
      if(String(url).endsWith('/v1/images/generations')){
        const plan=JSON.parse(options.body);
        if(plan.prompt.includes('neutral metallic reflection'))throw Error('one version failed');
        return Response.json({data:[{url:'https://getapib.org/f/progress.png'}]});
      }
      return new Response(output);
    }});
    const result=await renderer({baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',guides:['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL'].map(version=>({version,dataUrl:'data:image/png;base64,GUIDE'})),originalColor:'#000000',onStage:(version,stage)=>events.push(`${version}:${stage}`),onOutput:output=>results.push(output.version)});
    assert.deepEqual(result.map(item=>item.version),['ORIGINAL','BLACK','GOLD FOIL']);
    for(const version of ['ORIGINAL','BLACK','GOLD FOIL'])assert.deepEqual(events.filter(event=>event.startsWith(`${version}:`)).map(event=>event.split(':')[1]),['submitting','generating','saving']);
    assert.ok(events.includes('SILVER FOIL:failed'));
    assert.deepEqual(results.sort(),['BLACK','GOLD FOIL','ORIGINAL']);
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
