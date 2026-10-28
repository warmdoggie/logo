import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';
import {createSchemes} from './schemes.mjs';

async function workspace(run){
 const dir=await mkdtemp(join(tmpdir(),'s7-product-preview-')),calls=[];
 const original=await sharp({create:{width:2400,height:1200,channels:4,background:'#246'}}).png().toBuffer();
 const template={zones:[{id:'body',zoneType:'logo',x:.2,y:.2,width:.3,height:.1}]};
 const server=createDemoServer({spaceDir:dir,authenticate:async req=>({id:req.headers.cookie||'alice'}),productCatalog:async()=>[{id:'p',sku:'P',imageBytes:original,template}],mockupRenderer:async input=>{calls.push(input);return input.selectedVersions.map(version=>({version,bytes:original}));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,input,headers={})=>fetch(base+path,{method:input?'POST':'GET',headers:{'content-type':'application/json',...headers},...(input?{body:JSON.stringify(input)}:{})});
 const task=await(await call('/api/my-space/tasks',{title:'preview'})).json();
 try{await run({call,task,original,calls});}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep)&&basename(dir).startsWith('s7-product-preview-'));await rm(dir,{recursive:true,force:true});}
}

test('产品编辑只返回轻量 WebP，任务快照保留完整原图并可读取轻量预览',()=>workspace(async({call,task,original})=>{
 const response=await call('/api/product-library/image/p?selection=1',null,{'X-S7-Task-Id':task.id}),url=response.headers.get('X-S7-Task-Asset');
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');assert.ok(url);
 const meta=await sharp(Buffer.from(await response.arrayBuffer())).metadata();assert.equal(meta.width,1200);assert.equal(meta.height,600);
 const saved=await call(url);assert.ok(Buffer.from(await saved.arrayBuffer()).equals(original));
 const preview=await call(url+'?preview=1');assert.equal(preview.headers.get('content-type'),'image/webp');assert.equal((await sharp(Buffer.from(await preview.arrayBuffer())).metadata()).width,1200);
 assert.equal((await call(url+'?preview=1',null,{cookie:'bob'})).status,404);
 assert.equal((await call('/api/product-library/image/p?selection=1',null,{cookie:'bob','X-S7-Task-Id':task.id})).status,404);
}));

for(const background of [false,true])test(`单产品${background?'后台':'直接'}生成使用原图，不能使用编辑预览`,()=>workspace(async({call,task,original,calls})=>{
 const selected=await call('/api/product-library/image/p',null,{'X-S7-Task-Id':task.id}),baseAssetUrl=selected.headers.get('X-S7-Task-Asset');await selected.arrayBuffer();
 const preview=await sharp({create:{width:120,height:60,channels:4,background:'#f00'}}).png().toBuffer(),logo=await sharp({create:{width:16,height:8,channels:4,background:'#000'}}).png().toBuffer();
 const targets=[{id:'body',x:.5,y:.5,widthRatio:.2,rotation:0}],schemes=createSchemes(targets).schemes;
 const response=await call('/api/ai-render',{taskId:task.id,background,baseAssetUrl,baseImage:preview.toString('base64'),logoImage:logo.toString('base64'),targets,schemes,model:'test',selectedVersions:['ORIGINAL']});
 assert.equal(response.status,background?202:200);await response.text();
 if(background)for(let n=0;n<100;n++){const record=await(await call(`/api/my-space/tasks/${task.id}/generation`)).json();if(record.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.equal(calls.length,1);assert.ok((await sharp(Buffer.from(calls[0].baseImage.split(',')[1],'base64')).raw().toBuffer()).equals(await sharp(original).raw().toBuffer()));
}));
