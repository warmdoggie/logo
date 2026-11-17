import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';
import {createSchemes} from './schemes.mjs';
import {preparePlacementLogo} from './placement-logo.mjs';

async function workspace(run){
 const dir=await mkdtemp(join(tmpdir(),'s7-logo-asset-')),calls=[],processed=[];
 const pixels=await sharp({create:{width:2048,height:1024,channels:4,background:{r:120,g:40,b:80,alpha:.5}}}).raw().toBuffer();pixels[3]=0;
 const original=await sharp(pixels,{raw:{width:2048,height:1024,channels:4}}).png().toBuffer();let logo=original;
 const photo=await sharp({create:{width:80,height:60,channels:4,background:'#ddd'}}).png().toBuffer();
 const template={zones:[{id:'body',zoneType:'logo',x:.2,y:.2,width:.3,height:.1}]};
 const server=createDemoServer({spaceDir:dir,authenticate:async req=>({id:req.headers.cookie||'alice'}),productCatalog:async()=>['p','q'].map(id=>({id,sku:id,imageBytes:photo,template})),logoImage:async()=>logo,aiProcessor:async bytes=>{processed.push(bytes);return {bytes:original};},saveLogoToLibrary:async()=>({id:'saved'}),mockupRenderer:async input=>{calls.push(input);return input.selectedVersions.map(version=>({version,bytes:photo}));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,input,headers={})=>fetch(base+path,{method:input?'POST':'GET',headers:{'content-type':'application/json',...headers},...(input?{body:JSON.stringify(input)}:{})});
 const task=await(await call('/api/my-space/tasks',{title:'selection'})).json();
 try{await run({call,task,original,calls,processed,replace:bytes=>logo=bytes});}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep)&&basename(dir).startsWith('s7-logo-asset-'));await rm(dir,{recursive:true,force:true});}
}

test('选择 Logo 返回轻量预览，并在当前用户任务内保存完整原图',()=>workspace(async({call,task,original,replace})=>{
 const response=await call('/api/logo-library/one/image?selection=1',null,{'X-S7-Task-Id':task.id}),url=response.headers.get('X-S7-Task-Asset');
 assert.equal(response.status,200);assert.ok(url?.startsWith(`/api/my-space/tasks/${task.id}/assets/`));
 const meta=await sharp(Buffer.from(await response.arrayBuffer())).metadata();assert.equal(meta.width,512);assert.equal(meta.height,256);assert.ok(meta.hasAlpha);
 replace(Buffer.alloc(1));const saved=await call(url);assert.ok(Buffer.from(await saved.arrayBuffer()).equals(original));
 assert.equal((await call(url,null,{cookie:'bob'})).status,404);
 assert.equal((await call('/api/logo-library/one/image?selection=1',null,{cookie:'bob','X-S7-Task-Id':task.id})).status,404);
}));

test('centering a selected library Logo uses its full-resolution task snapshot',()=>workspace(async({call,task,original})=>{
 const response=await call('/api/logo-library/one/image?selection=1',null,{'X-S7-Task-Id':task.id});
 const logo={logoImage:Buffer.from(await response.arrayBuffer()).toString('base64'),logoAssetUrl:response.headers.get('X-S7-Task-Asset'),aiRefined:true};
 await preparePlacementLogo(logo,(url,options)=>call(url,JSON.parse(options.body)),task.id);
 const bytes=Buffer.from(logo.logoImage,'base64'),meta=await sharp(bytes).metadata();
 assert.deepEqual([meta.width,meta.height],[2172,1148]);
 assert.deepEqual(await sharp(bytes).extract({left:62,top:62,width:2048,height:1024}).raw().toBuffer(),await sharp(original).raw().toBuffer());
 assert.ok(logo.logoAssetUrl?.startsWith(`/api/my-space/tasks/${task.id}/assets/`),'generation and explicit AI processing retain the full-resolution original');
}));

for(const mode of ['single','background','multi-product','multi-logo','processing'])test(`${mode} 使用快照完整 Logo，忽略客户端轻量预览`,()=>workspace(async({call,task,original,calls,processed})=>{
 const selected=await call('/api/logo-library/one/image?selection=1',null,{'X-S7-Task-Id':task.id}),logoAssetUrl=selected.headers.get('X-S7-Task-Asset');await selected.arrayBuffer();
 const targets=[{id:'body',x:.5,y:.5,widthRatio:.2,rotation:0}],schemes=createSchemes(targets).schemes;
 const base=await sharp({create:{width:80,height:60,channels:4,background:'#ddd'}}).png().toBuffer();
 const input={taskId:task.id,logoAssetUrl,logoImage:base.toString('base64'),baseImage:base.toString('base64'),targets,schemes,selectedVersions:['ORIGINAL'],model:'test'};
 let path='/api/ai-render';if(mode==='background')input.background=true;
 if(mode==='multi-product'){path='/api/ai-render-multi';input.background=true;input.productIds=['p','q'];}
 if(mode==='multi-logo'){path='/api/ai-render-logos';input.productId='p';input.logos=['one','two'].map(id=>({id,name:id,logoAssetUrl,logoImage:base.toString('base64')}));}
 if(mode==='processing'){path='/api/ai-process-logo';input.targetColor='original';}
 const response=await call(path,input);assert.equal(response.status,['background','multi-product','multi-logo'].includes(mode)?202:200,await response.clone().text());await response.text();
 if(['background','multi-product','multi-logo'].includes(mode))for(let n=0;n<100;n++){const job=await(await call(`/api/my-space/tasks/${task.id}/generation`)).json();if(job.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
 const expected=await sharp(original).raw().toBuffer(),inputs=mode==='processing'?processed:calls.map(input=>Buffer.from(input.logoImage.split(',')[1],'base64'));
 assert.equal(inputs.length,['multi-product','multi-logo'].includes(mode)?2:1);
 for(const bytes of inputs){assert.ok((await sharp(bytes).raw().toBuffer()).equals(expected),'必须保留完整原图像素');}
 const denied=await call(path,input,{cookie:'bob'});assert.equal(denied.status,404);
}));

test('主工作区 Logo 库列表使用缩略图，原图只供下载和查看',async()=>{
 const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(source,/<img class="logo-library-image" src="\$\{esc\(item.imageUrl\+'\?thumbnail=1'\)\}"[^>]*loading="lazy"/);
});
