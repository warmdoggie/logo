import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';

async function image(width,height,background){
  return sharp({create:{width,height,channels:4,background}}).png().toBuffer();
}

async function openServer(options={}){
  const server=createDemoServer(options);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {server,base:`http://127.0.0.1:${server.address().port}`};
}

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
    const response=await fetch(base+'/api/render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({baseImage:baseImage.toString('base64'),logoImage:logo.toString('base64'),targets:[{id:'compact',x:.5,y:.5,widthRatio:.2,rotation:0}]})});
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.equal(payload.outputs.length,4);
    assert.ok(payload.outputs.every(output=>output.dataUrl.startsWith('data:image/png;base64,')));
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
    assert.match(await script.text(),/if\(!query\)/);
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
    const response=await fetch(base+'/api/render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({baseImage:'not-image',logoImage:'not-image',targets:[]})});
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
    assert.deepEqual({width:payload.width,height:payload.height},{width:6,height:4});
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('展示界面通过AI接口生成透明底黑字Logo',async()=>{
  const processedRaw=Buffer.alloc(6*4*4);
  for(let y=1;y<3;y++)for(let x=1;x<5;x++){const i=(y*6+x)*4;processedRaw[i]=0;processedRaw[i+1]=0;processedRaw[i+2]=0;processedRaw[i+3]=255;}
  const processed=await sharp(processedRaw,{raw:{width:6,height:4,channels:4}}).png().toBuffer();
  const {server,base}=await openServer({aiProcessor:async(source,options)=>{
    assert.ok(source.length>0);
    assert.equal(options.targetColor,'#000000');
    return processed;
  }});
  try{
    const response=await fetch(base+'/api/ai-process-logo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({logoImage:'AQIDBA=='})});
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.equal(payload.width,6);
    assert.equal(payload.height,4);
    assert.match(payload.dataUrl,/^data:image\/png;base64,/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('展示界面由AI生成四张自然上样成图',async()=>{
  const rendered=await image(12,8,{r:210,g:200,b:190,alpha:1});
  const {server,base}=await openServer({mockupRenderer:async input=>{
    assert.equal(input.model,'flux-3-image');
    assert.equal(input.originalColor,'#C54B78');
    assert.equal(input.guides.length,4);
    assert.deepEqual(input.targets,[{id:'product',x:.5,y:.5,widthRatio:.2,rotation:0}]);
    assert.equal(input.baseImage.startsWith('data:image/png;base64,'),true);
    assert.equal(input.logoImage.startsWith('data:image/png;base64,'),true);
    assert.equal(input.maskImage.startsWith('data:image/png;base64,'),true);
    assert.equal(input.finishReferenceImage,'data:image/png;base64,FINISH');
    return ['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL'].map(version=>({version,bytes:rendered}));
  }});
  try{
    const baseImage=await image(80,40,{r:240,g:230,b:220,alpha:1});
    const logo=await image(8,4,{r:0,g:0,b:0,alpha:1});
    const response=await fetch(base+'/api/ai-render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'flux-3-image',baseImage:baseImage.toString('base64'),logoImage:logo.toString('base64'),finishReferenceImage:'FINISH',targets:[{id:'product',x:.5,y:.5,widthRatio:.2,rotation:0}],originalColor:'#C54B78'})});
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.deepEqual(payload.outputs.map(output=>output.version),['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL']);
    assert.equal(payload.outputs.every(output=>output.dataUrl.startsWith('data:image/png;base64,')),true);
    const first=Buffer.from(payload.outputs[0].dataUrl.split(',')[1],'base64');
    assert.deepEqual(await sharp(first).metadata().then(meta=>({width:meta.width,height:meta.height})),{width:12,height:8});
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
    assert.match(source,/finishReferenceImage/);
    assert.match(source,/mockupModel\.value/);
    assert.match(await (await fetch(base+'/')).text(),/id="mockup-model"/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('上样目标可明确选择彩盒平面或圆管曲面',async()=>{
  const {server,base}=await openServer();
  try{
    const script=await fetch(base+'/demo.js');
    const source=await script.text();
    assert.match(source,/data-key="surface"/);
    assert.match(source,/value="cylinder"/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('上样目标默认使用自由光泽参考，不强制指定材质类别',async()=>{
  const {server,base}=await openServer();
  try{
    const script=await fetch(base+'/demo.js');
    const source=await script.text();
    assert.match(source,/value="free"/);
    assert.match(source,/自由光泽/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('平面上样目标提供四点透视编辑入口',async()=>{
  const {server,base}=await openServer();
  try{
    const script=await fetch(base+'/demo.js');
    const source=await script.text();
    assert.match(source,/quad-target/);
    assert.match(source,/quadFromTarget/);
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
