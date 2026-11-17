import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';

async function image(width,height,background){
  return sharp({create:{width,height,channels:4,background}}).png().toBuffer();
}

async function openServer(options={}){
  const template={id:'master',version:1,zones:[{id:'body-zone',zoneType:'logo',name:'产品正面',x:.1,y:.1,width:.8,height:.8}],automation:{carriers:[{id:'body',type:'BODY'}],areas:[{id:'area',zoneId:'body-zone',carrierId:'body',foilProcesses:['GOLD FOIL','SILVER FOIL']}],schemes:[]}};
  const server=createDemoServer({productCatalog:async()=>[{id:'product-1',sku:'P01',status:'ACTIVE'}],productTemplate:async()=>({template}),...options});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {server,base:`http://127.0.0.1:${server.address().port}`};
}

test('AI Logo network failures log only connection metadata while retaining the client error',async t=>{
 const entries=[];t.mock.method(console,'error',(...args)=>entries.push(args));
 const message='APIMart 提交生成请求网络连接失败（ECONNRESET），请检查网络或代理后重试';
 const diagnostic={action:'提交生成请求',host:'api.apimart.ai',route:'direct',code:'ECONNRESET',phase:'request',responseStatus:null,tlsHandshakeFailure:true,elapsedMs:4,requestBytes:1234,method:'POST',message:'private provider detail',authorization:'Bearer private-key',body:'private-logo'};
 const {server,base}=await openServer({aiProcessor:async()=>{throw Object.assign(Error(message),{code:'APIMART_NETWORK_ERROR',diagnostic});}});
 try{
  const png=await image(2,2,{r:0,g:0,b:0,alpha:1});
  const response=await fetch(base+'/api/ai-process-logo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({logoImage:png.toString('base64')})});
  assert.equal(response.status,400);assert.equal((await response.json()).error,message);
  assert.equal(entries.length,1);assert.equal(entries[0][0],'apimart_network_failure');
  const logged=JSON.parse(entries[0][1]);
  for(const key of ['action','host','route','code','phase','responseStatus','tlsHandshakeFailure','elapsedMs','requestBytes','method'])assert.equal(logged[key],diagnostic[key]);
  assert.match(logged.at,/^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(JSON.stringify(entries),/private-key|private-logo|private provider detail/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('展示界面提供静态页面并生成四个预览版本',async()=>{
  const {server,base}=await openServer();
  try{
    const page=await fetch(base+'/');
    assert.equal(page.status,200);
    const pageText=await page.text();
    assert.match(pageText,/S7 Logo Stability/);
    assert.match(pageText,/auto-contrast/);
    const baseImage=await image(80,40,{r:240,g:230,b:220,alpha:1});
    const logo=await image(8,4,{r:255,g:255,b:255,alpha:1});
    const response=await fetch(base+'/api/render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({productId:'product-1',baseImage:baseImage.toString('base64'),logoImage:logo.toString('base64'),targets:[{id:'compact',masterZoneId:'body-zone',x:.5,y:.5,widthRatio:.2,rotation:0}]})});
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.equal(payload.outputs.length,4);
    assert.ok(payload.outputs.every(output=>output.dataUrl.startsWith('data:image/png;base64,')));
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('S7 内嵌任务页隐藏重复说明并压缩顶部留白',async()=>{
  const {server,base}=await openServer();
  try{
    const page=await fetch(base+'/demo.html');
    const html=await page.text();
    assert.doesNotMatch(html,/Logo 稳定上样演示|先拖动锁定 Logo 布局|class="badge"/);
    const script=await fetch(base+'/demo.js');
    assert.doesNotMatch(await script.text(),/querySelector\('\.badge'\)/);
    const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
    assert.doesNotMatch(app,/Back to tasks|s7-module-actions|heading\('S7 Logo Stability'/);
    assert.match(app,/classList\.toggle\('s7-module'/);
    const styles=await readFile(new URL('../public/style.css',import.meta.url),'utf8');
    assert.match(styles,/\.s7-module \.topbar\{display:none\}/);
    assert.match(styles,/\.s7-module main\{max-width:none;margin:0;padding:0\}/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('browser can load the shared laser material without caching an old version',async()=>{
 const {server,base}=await openServer();
 try{
  const response=await fetch(base+'/laser-foil-texture.mjs');
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/javascript/);
  assert.match(response.headers.get('cache-control'),/must-revalidate/);
  assert.ok(response.headers.get('etag'));
  assert.equal(await response.text(),await readFile(new URL('./laser-foil-texture.mjs',import.meta.url),'utf8'));
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('素材区只从商品库选择产品，并提供 Logo 库选择入口',async()=>{
  const {server,base}=await openServer();
  try{
    const html=await(await fetch(base+'/')).text();
    assert.doesNotMatch(html,/id="base-image"/);
    assert.match(html,/id="choose-product"[^>]*>从产品库选择/);
    assert.match(html,/id="choose-logo-library"[^>]*>从 Logo 库选择/);
    assert.match(html,/id="logo-image"/);
    assert.match(html,/id="selected-logo-thumbnail"/);
    assert.match(html,/id="process-logo"[^>]*>logo处理<\/button>\s*<button id="generate"/);
    const script=await(await fetch(base+'/demo.js')).text();
    assert.match(script,/logoLibraryPath=value=>S7_BASE\?new URL\(value,location\.origin\)\.href:s7Path\(value\)/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('S7 通过当前用户会话读取 Logo 库图片',async()=>{
  const imageBytes=await image(5,4,{r:20,g:40,b:60,alpha:1});
  const {server,base}=await openServer({logoCatalog:async()=>[{id:'logo-1',name:'测试Logo',createdAt:'2026-10-14T00:00:00.000Z'}],logoImage:async(req,id)=>{assert.equal(id,'logo-1');return imageBytes;}});
  try{
    const list=await fetch(base+'/api/logo-library');
    assert.equal(list.status,200);
    assert.deepEqual(await list.json(),[{id:'logo-1',name:'测试Logo',createdAt:'2026-10-14T00:00:00.000Z',imageUrl:'/api/logo-library/logo-1/image'}]);
    const selected=await fetch(base+'/api/logo-library/logo-1/image');
    assert.equal(selected.headers.get('content-type'),'image/png');
    assert.deepEqual(Buffer.from(await selected.arrayBuffer()),imageBytes);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('Logo 列表缩略图保留透明度和比例，选择仍读取原图',async()=>{
  const original=await image(2048,1024,{r:20,g:40,b:60,alpha:.5});
  const {server,base}=await openServer({logoImage:async()=>original});
  try{
    const response=await fetch(base+'/api/logo-library/logo-1/image?thumbnail=1');
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    const thumbnail=Buffer.from(await response.arrayBuffer()),meta=await sharp(thumbnail).metadata();
    assert.equal(meta.width,192);assert.equal(meta.height,96);assert.equal(meta.hasAlpha,true);
    assert.ok(thumbnail.length<original.length);
    assert.deepEqual(Buffer.from(await(await fetch(base+'/api/logo-library/logo-1/image')).arrayBuffer()),original);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('产品库选择器读取主工作区产品并返回标准图',async()=>{
  const productImage=await image(16,10,{r:230,g:220,b:210,alpha:1});
  const {server,base}=await openServer({productCatalog:async()=>[{
    id:'product-1',sku:'E0034',name:'眉胶',category:'EYEBROW',status:'ACTIVE',standardImage:'product.png',imageBytes:productImage
  }]});
  try{
    const html=await fetch(base+'/');
    assert.equal(html.status,200);
    assert.match(await html.text(),/从产品库选择/);
    const script=await fetch(base+'/demo.js');
    assert.equal(script.status,200);
    const categories=await fetch(base+'/product-categories.js');
    assert.equal(categories.status,200);
    assert.match(categories.headers.get('content-type'),/^text\/javascript/);
    const catalog=await fetch(base+'/api/product-library');
    assert.equal(catalog.status,200);
    const products=await catalog.json();
    assert.deepEqual(products.map(({id,sku,name})=>({id,sku,name})),[{id:'product-1',sku:'E0034',name:'眉胶'}]);
    assert.equal(products[0].imageUrl,'/api/product-library/image/product-1');
    const selected=await fetch(base+products[0].imageUrl);
    assert.equal(selected.status,200);
    assert.equal(selected.headers.get('content-type'),'image/png');
    assert.deepEqual(Buffer.from(await selected.arrayBuffer()),productImage);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('提供不调用外部服务的健康检查端点',async()=>{
  const {server,base}=await openServer();
  try{
    const response=await fetch(base+'/healthz');
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{ok:true,service:'s7-logo-stability'});
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('展示界面对非法输入返回可读的400错误',async()=>{
  const {server,base}=await openServer();
  try{
    const response=await fetch(base+'/api/render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({selectedVersions:['ORIGINAL'],baseImage:'not-image',logoImage:'not-image',targets:[]})});
    assert.equal(response.status,400);
    assert.match((await response.json()).error,/至少需要一个上样目标|图片/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('展示界面可以先加工Logo再用于上样',async()=>{
  const {server,base}=await openServer();
  try{
    const raw=Buffer.alloc(20*12*4,255);
    for(let y=4;y<8;y++)for(let x=7;x<13;x++){const i=(y*20+x)*4;raw[i]=0;raw[i+1]=0;raw[i+2]=0;raw[i+3]=255;}
    const response=await fetch(base+'/api/process-logo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({logoImage:(await sharp(raw,{raw:{width:20,height:12,channels:4}}).png().toBuffer()).toString('base64'),threshold:24})});
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.match(payload.dataUrl,/^data:image\/png;base64,/);
    assert.deepEqual({width:payload.width,height:payload.height},{width:12,height:10});
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('展示界面通过AI接口生成透明底黑字Logo',async()=>{
  const processedRaw=Buffer.alloc(6*4*4);
  for(let y=1;y<3;y++)for(let x=1;x<5;x++){const i=(y*6+x)*4;processedRaw[i]=0;processedRaw[i+1]=0;processedRaw[i+2]=0;processedRaw[i+3]=255;}
  const processed=await sharp(processedRaw,{raw:{width:6,height:4,channels:4}}).png().toBuffer();
  let librarySave;
  const {server,base}=await openServer({aiProcessor:async(source,options)=>{
    assert.ok(source.length>0);
    assert.equal(options.targetColor,'#000000');
    return processed;
  },saveLogoToLibrary:async(req,bytes,name)=>{librarySave={bytes,name};return {id:'library-logo-1',name,imageUrl:'/api/logo-library/library-logo-1/image'};}});
  try{
    const response=await fetch(base+'/api/ai-process-logo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({logoImage:'AQIDBA=='})});
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.equal(payload.width,6);
    assert.equal(payload.height,4);
    assert.match(payload.dataUrl,/^data:image\/png;base64,/);
    assert.equal(payload.logoLibrary.id,'library-logo-1');
    assert.deepEqual(librarySave.bytes,Buffer.from(payload.dataUrl.split(',')[1],'base64'));
    assert.equal(librarySave.name,'AI 加工 Logo（黑色）.png');
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('AI加工接口把所选原色模式传给处理器并保存结果',async()=>{
  const raw=Buffer.alloc(6*4*4);for(let y=1;y<3;y++)for(let x=1;x<5;x++){const index=(y*6+x)*4;raw[index]=120;raw[index+1]=30;raw[index+2]=200;raw[index+3]=255;}const processed=await sharp(raw,{raw:{width:6,height:4,channels:4}}).png().toBuffer();
  let receivedColor,savedName;
  const {server,base}=await openServer({aiProcessor:async(source,options)=>{receivedColor=options.targetColor;return processed;},saveLogoToLibrary:async(req,bytes,name)=>{savedName=name;return {id:'original-color-logo',name,imageUrl:'/api/logo-library/original-color-logo/image'};}});
  try{
    const response=await fetch(base+'/api/ai-process-logo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({logoImage:'AQIDBA==',targetColor:'original'})});
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.equal(receivedColor,'original');
    assert.match(payload.dataUrl,/^data:image\/png;base64,/);
    assert.equal(savedName,'AI 加工 Logo（保留原色）.png');
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('展示界面由AI生成四张自然上样成图',async()=>{
  const rendered=await image(12,8,{r:210,g:200,b:190,alpha:1});
  const {server,base}=await openServer({mockupRenderer:async input=>{
    assert.equal(input.model,'flux-3-image');
    assert.equal(input.originalColor,'#C54B78');
    assert.equal(input.guides.length,4);
    assert.deepEqual(input.targets,[{id:'product',masterZoneId:'body-zone',carrierType:'BODY',x:.5,y:.5,widthRatio:.2,rotation:0}]);
    assert.equal(input.baseImage.startsWith('data:image/png;base64,'),true);
    assert.equal(input.logoImage.startsWith('data:image/png;base64,'),true);
    assert.equal(input.maskImage.startsWith('data:image/png;base64,'),true);
    assert.equal(input.finishReferenceImage,'data:image/png;base64,FINISH');
    return ['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL'].map(version=>({version,bytes:rendered}));
  }});
  try{
    const baseImage=await image(80,40,{r:240,g:230,b:220,alpha:1});
    const logo=await image(8,4,{r:0,g:0,b:0,alpha:1});
    const response=await fetch(base+'/api/ai-render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({productId:'product-1',model:'flux-3-image',baseImage:baseImage.toString('base64'),logoImage:logo.toString('base64'),finishReferenceImage:'FINISH',targets:[{id:'product',masterZoneId:'body-zone',x:.5,y:.5,widthRatio:.2,rotation:0}],originalColor:'#C54B78'})});
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.deepEqual(payload.outputs.map(output=>output.version),['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL']);
    assert.equal(payload.outputs.every(output=>output.dataUrl.startsWith('data:image/png;base64,')),true);
    const first=Buffer.from(payload.outputs[0].dataUrl.split(',')[1],'base64');
    assert.deepEqual(await sharp(first).metadata().then(meta=>({width:meta.width,height:meta.height})),{width:12,height:8});
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('流式 AI 接口在每张结果到达时立即发送并逐张保存',async()=>{
  const rendered=await image(12,8,{r:210,g:200,b:190,alpha:1});
  let saved=[];
  const {server,base}=await openServer({mockupRenderer:async input=>{
    const outputs=[];
    for(const version of ['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL']){
      await input.onStage(version,'submitting');await input.onStage(version,'generating');await input.onStage(version,'saving');
      const output={version,bytes:rendered};outputs.push(output);await input.onOutput(output);
    }
    return outputs;
  }});
  try{
    const response=await fetch(base+'/api/ai-render',{method:'POST',headers:{'content-type':'application/json','accept':'text/event-stream'},body:JSON.stringify({productId:'product-1',model:'flux-3-image',baseImage:(await image(80,40,{r:240,g:230,b:220,alpha:1})).toString('base64'),logoImage:(await image(8,4,{r:0,g:0,b:0,alpha:1})).toString('base64'),targets:[{id:'product',masterZoneId:'body-zone',x:.5,y:.5,widthRatio:.2,rotation:0}],originalColor:'#C54B78'})});
    assert.match(response.headers.get('content-type'),/text\/event-stream/);
    const stream=await response.text();
    assert.match(stream,/event: started/);assert.match(stream,/"stage":"submitting"/);assert.match(stream,/"stage":"saving"/);
    assert.equal((stream.match(/event: output/g)||[]).length,4);assert.match(stream,/event: done/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('展示界面将人工定位参考交给AI生成最终四个版本',async()=>{
  const {server,base}=await openServer();
  try{
    const script=await fetch(base+'/demo.js');
    assert.equal(script.status,200);
    const source=await script.text();
    assert.match(source,/fetch\('\/api\/ai-render'/);
    assert.doesNotMatch(source,/fetch\('\/api\/render'/);
    assert.match(source,/background:true/);
    assert.match(source,/mockupModel\.value/);
    assert.match(await (await fetch(base+'/')).text(),/id="mockup-model"/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('预览会同步显示图位设置的曲面弯曲',async()=>{
  const {server,base}=await openServer();
  try{
    const script=await fetch(base+'/demo.js');
    const source=await script.text();
    assert.match(source,/curvePreviewLogo/);
    assert.match(source,/target\.curve/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('四点透视会直接变形预览Logo，而非只显示辅助线',async()=>{
  const {server,base}=await openServer();
  try{
    const script=await fetch(base+'/demo.js');
    const source=await script.text();
    assert.match(source,/drawQuadPreview/);
    assert.match(source,/if\(target\.quad\)drawQuadPreview/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('单张结果重新生成只提交选中的工艺版本',async()=>{
  const rendered=await image(12,8,{r:210,g:200,b:190,alpha:1});
  const {server,base}=await openServer({mockupRenderer:async input=>{
    assert.equal(input.onlyVersion,'BLACK');
    return [{version:'BLACK',bytes:rendered}];
  }});
  try{
    const baseImage=await image(80,40,{r:240,g:230,b:220,alpha:1});
    const logo=await image(8,4,{r:0,g:0,b:0,alpha:1});
    const response=await fetch(base+'/api/ai-render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({onlyVersion:'BLACK',baseImage:baseImage.toString('base64'),logoImage:logo.toString('base64'),targets:[{id:'product',x:.5,y:.5,widthRatio:.2,rotation:0}],originalColor:'#C54B78'})});
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).outputs.map(output=>output.version),['BLACK']);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('结果界面提供单张重生成与可缩放大图预览',async()=>{
  const {server,base}=await openServer();
  try{
    const script=await fetch(base+'/demo.js');
    const html=await fetch(base+'/');
    const source=await script.text();
    const markup=await html.text();
    assert.match(source,/regenerate-result/);
    assert.match(source,/image-preview/);
    assert.match(source,/onlyVersion/);
    assert.match(markup,/id="image-preview"/);
    assert.match(markup,/zoom-in/);
    assert.match(markup,/zoom-out/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('S7 表单不再展示或提交工艺质感参考图',async()=>{
  const {server,base}=await openServer();
  try{
    const [htmlResponse,scriptResponse]=await Promise.all([fetch(base+'/'),fetch(base+'/demo.js')]);
    const [markup,source]=await Promise.all([htmlResponse.text(),scriptResponse.text()]);
    assert.doesNotMatch(markup,/finish-reference-image|工艺质感参考图/);
    assert.doesNotMatch(source,/finishReferenceData|finishReferenceImage:|finish-reference-image|finish-reference-name/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
