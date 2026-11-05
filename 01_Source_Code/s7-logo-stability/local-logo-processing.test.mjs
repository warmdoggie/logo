import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';
import {createSchemes} from './schemes.mjs';

async function workspace(run){
 const dir=await mkdtemp(join(tmpdir(),'s7-auto-logo-')),calls=[];
 const width=64,height=40,raw=Buffer.alloc(width*height*4);
 for(let i=3;i<raw.length;i+=4)raw[i]=255;
 for(let y=8;y<32;y++)for(let x=12;x<44;x++)raw.set([200,40,60,255],(y*width+x)*4);
 raw.set([200,40,60,255],(35*width+55)*4);
 const logo=await sharp(raw,{raw:{width,height,channels:4}}).png().toBuffer();
 const baseImage=await sharp({create:{width:80,height:60,channels:4,background:'#eeeeee'}}).png().toBuffer();
 const targets=[{id:'body',x:.5,y:.5,widthRatio:.4,rotation:0}],schemes=createSchemes(targets).schemes;
 const template={zones:[{id:'body',zoneType:'logo',x:.3,y:.3,width:.4,height:.2}]};
 let aiCalls=0;
 const server=createDemoServer({spaceDir:dir,authenticate:async()=>({id:'auto-logo-user'}),productCatalog:async()=>['p','q'].map(id=>({id,sku:id,imageBytes:baseImage,template})),logoImage:async()=>logo,
  aiProcessor:async()=>{aiCalls++;throw Error('Logo processing must remain local');},mockupRenderer:async input=>{calls.push(input);return input.selectedVersions.map(version=>({version,bytes:baseImage}));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,input,headers={})=>fetch(base+path,{method:input?'POST':'GET',headers:{'content-type':'application/json',...headers},...(input?{body:JSON.stringify(input)}:{})});
 try{
  const task=await(await call('/api/my-space/tasks',{title:'自动加工'})).json();
  await run({call,task,calls,logo,baseImage,targets,schemes});
  assert.equal(aiCalls,0);
 }finally{
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true});
 }
}

for(const mode of ['single','background','multi-product','multi-logo'])test(`${mode}: generation locally cleans the full-resolution Logo before rendering`,()=>workspace(async({call,task,calls,baseImage,targets,schemes})=>{
 const selection=await call('/api/logo-library/one/image?selection=1',null,{'X-S7-Task-Id':task.id});
 const logoAssetUrl=selection.headers.get('X-S7-Task-Asset');await selection.arrayBuffer();
 const input={taskId:task.id,processLogo:true,logoAssetUrl,logoImage:'invalid-preview',baseImage:baseImage.toString('base64'),targets,schemes,selectedVersions:['ORIGINAL'],model:'test'};
 let path='/api/ai-render';
 if(mode==='background')input.background=true;
 if(mode==='multi-product'){path='/api/ai-render-multi';input.background=true;input.productIds=['p','q'];}
 if(mode==='multi-logo'){path='/api/ai-render-logos';input.productId='p';input.logos=['one','two'].map(id=>({id,name:id,logoAssetUrl,logoImage:'invalid-preview'}));}
 const response=await call(path,input);assert.equal(response.status,mode==='single'?200:202,await response.clone().text());await response.text();
 if(mode!=='single'){
  let job;
  for(let n=0;n<100;n++){job=await(await call(`/api/my-space/tasks/${task.id}/generation`)).json();if(job.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(job.status,'complete',JSON.stringify(job));
 }
 assert.equal(calls.length,mode.startsWith('multi-')?2:1);
 for(const input of calls){
  const {data,info}=await sharp(Buffer.from(input.logoImage.split(',')[1],'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,64);assert.equal(info.height,40,'placement dimensions must not change');
  assert.equal(data[3],0,'opaque background must be removed automatically');
  assert.equal(data[(35*64+55)*4+3],0,'isolated dust must be removed automatically');
  assert.deepEqual([...data.subarray((20*64+25)*4,(20*64+25)*4+4)],[200,40,60,255]);
 }
}));

test('automatic Logo processing failure prevents generation from starting',()=>workspace(async({call,task,calls,baseImage,targets,schemes})=>{
 const response=await call('/api/ai-render',{taskId:task.id,background:true,processLogo:true,baseImage:baseImage.toString('base64'),logoImage:baseImage.toString('base64'),targets,schemes,selectedVersions:['ORIGINAL']});
 assert.equal(response.status,400);assert.match((await response.json()).error,/没有可见像素/);assert.equal(calls.length,0);
}));
