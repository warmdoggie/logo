import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import sharp from 'sharp';
import {createDemoHandler} from './demo-server.mjs';

test('生成接口强制执行母版工艺，彩盒确认后才调用渲染器',async()=>{
 const base=await sharp({create:{width:200,height:200,channels:4,background:'#eeeeee'}}).png().toBuffer();
 const logo=await sharp(Buffer.from('<svg width="40" height="20"><rect x="5" y="5" width="30" height="10" fill="black"/></svg>')).png().toBuffer();
 const product={id:'p',sku:'E0049',name:'测试产品'},zones=[{id:'body',zoneType:'logo',name:'产品',x:.1,y:.1,width:.3,height:.8},{id:'carton',zoneType:'logo',name:'彩盒',x:.5,y:.1,width:.4,height:.8}];
 const template={id:'master',version:1,zones,automation:{carriers:[{id:'b',type:'BODY'},{id:'c',type:'CARTON'}],areas:[{zoneId:'body',carrierId:'b',foilProcesses:[]},{zoneId:'carton',carrierId:'c',foilProcesses:[]}]}};
 let rendered=0,renderedTargets;
 const server=createServer(createDemoHandler({authenticate:null,productCatalog:async()=>[product],productTemplate:async()=>({template}),productImage:async()=>({bytes:base,contentType:'image/png'}),mockupRenderer:async input=>{rendered++;renderedTargets=input.schemes[0].targets;return [{version:'GOLD FOIL',bytes:base}];}}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 const targets=[{id:'a',masterZoneId:'body',carrierType:'BODY',x:.25,y:.5,widthRatio:.1},{id:'b',masterZoneId:'carton',carrierType:'CARTON_FRONT',printFinish:'INK',x:.7,y:.5,widthRatio:.1}];
 const input={productId:'p',model:'local',baseImage:base.toString('base64'),logoImage:logo.toString('base64'),selectedVersions:['GOLD FOIL'],foilRegions:['product','carton'],targets,schemes:[{version:'GOLD FOIL',targets}]};
 const post=async(path,value)=>{const r=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});return {status:r.status,body:await r.json()};};
 try{
  let r=await post('/api/foil-preflight',input);assert.equal(r.status,200);assert.equal(r.body.blocked.length,1);assert.equal(r.body.warnings.length,1);
  r=await post('/api/ai-render',{...input,foilAcknowledgement:'forged'});assert.equal(r.status,422);assert.equal(rendered,0);
  input.foilRegions=['carton'];
  const preview=await post('/api/foil-preflight',input);assert.equal(preview.body.blocked.length,0);assert.ok(preview.body.confirmationToken);
  r=await post('/api/ai-render',input);assert.equal(r.status,409);assert.equal(rendered,0);
  r=await post('/api/ai-render',{...input,foilAcknowledgement:preview.body.confirmationToken});assert.equal(r.status,200);assert.equal(rendered,1);
  assert.equal(renderedTargets[0].printFinish,'INK');assert.equal(renderedTargets[1].printFinish,'GOLD FOIL');
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('流式单产品重试只生成经过工艺校验的产品',async()=>{
 const image=await sharp({create:{width:64,height:64,channels:4,background:'#888888'}}).png().toBuffer();
 const products=['p','q'].map(id=>({id,sku:id,name:id,imageBytes:image})),rendered=[];
 const templateFor=product=>({template:{id:'master-'+product.id,version:1,zones:[{id:'body',zoneType:'logo',x:.1,y:.1,width:.8,height:.8}],automation:{carriers:[{id:'b',type:'BODY'}],areas:[{zoneId:'body',carrierId:'b',foilProcesses:product.id==='p'?['GOLD FOIL']:[]}]}}});
 const server=createServer(createDemoHandler({authenticate:null,productCatalog:async()=>products,productTemplate:async product=>templateFor(product),mockupRenderer:async input=>{rendered.push(input);return [{version:'GOLD FOIL',bytes:image}];}}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/ai-render-multi',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productIds:['p','q'],onlyProductId:'p',selectedVersions:['GOLD FOIL'],foilRegions:['product'],logoImage:image.toString('base64'),model:'local'})});
  assert.equal(response.status,200);const stream=await response.text();
  assert.equal(rendered.length,1);assert.match(stream,/"total":1/);assert.doesNotMatch(stream,/"id":"q"/);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
