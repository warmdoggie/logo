import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';
import {userSpace} from './user-space.mjs';

test('only the owning account receives a short signed OSS image redirect, while local copies remain readable',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-private-oss-')),user={id:'alice'};
 let signingFails=false;
 const descriptor={original:'private-original',preview:'private-preview'},generationStorage={async url(value,preview){if(signingFails)throw Error('STS temporarily unavailable');assert.deepEqual(value,descriptor);return 'https://heci-002.oss-cn-heyuan.aliyuncs.com/'+(preview?'preview.webp':'original.png')+'?signed';}};
 const image=await sharp({create:{width:20,height:20,channels:4,background:'#000'}}).png().toBuffer();
 const spaces=userSpace(dir),task=await spaces.createTask(user,{title:'private'});
 const record=await spaces.save(user,{taskId:task.id,kind:'AI上样',images:[{label:'BLACK',bytes:image,storage:descriptor}]});
 const server=createDemoServer({spaceDir:dir,generationStorage,authenticate:async req=>({id:req.headers.cookie||'bob'})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  for(const [suffix,name] of [['','original.png'],['?preview=1','preview.webp']]){
   const response=await fetch(base+record.images[0].url+suffix,{headers:{cookie:'alice'},redirect:'manual'});
   assert.equal(response.status,302);assert.equal(response.headers.get('location'),'https://heci-002.oss-cn-heyuan.aliyuncs.com/'+name+'?signed');assert.equal(response.headers.get('cache-control'),'private, no-store');
  }
  assert.equal((await fetch(base+record.images[0].url,{headers:{cookie:'bob'},redirect:'manual'})).status,404);
  signingFails=true;const fallback=await fetch(base+record.images[0].url,{headers:{cookie:'alice'},redirect:'manual'});assert.equal(fallback.status,200);assert.deepEqual(Buffer.from(await fallback.arrayBuffer()),image);
  assert.deepEqual(await spaces.image(user,record.id,'image-0.png',task.id),image);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});

test('草稿增量保存保留素材且返回轻量摘要',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-delta-')),spaces=userSpace(dir),user={id:'alice'};
 try{
  const task=await spaces.createTask(user,{title:'delta'});
  await spaces.updateTask(user,task.id,{revision:0,state:{baseData:'large image',targets:[{x:.2}]}});
  const saved=await spaces.updateTask(user,task.id,{revision:1,mergeState:true,summary:true,state:{targets:[{x:.4}]}});
  assert.equal(saved.state,undefined);assert.equal(saved.revision,2);
  assert.deepEqual((await spaces.task(user,task.id)).state,{baseData:'large image',targets:[{x:.4}]});
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('S7 requires a session and saves generation history and images separately for each user',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-users-'));
 const image=await sharp({create:{width:20,height:20,channels:4,background:'#000'}}).png().toBuffer();
 const server=createDemoServer({spaceDir:dir,authenticate:async req=>{const id=req.headers.cookie;if(!['alice','bob'].includes(id))throw Object.assign(Error('请先登录'),{status:401});return {id,username:id};},mockupRenderer:async()=>[{version:'ORIGINAL',bytes:image}],productCatalog:async()=>[{id:'shared',sku:'SHARED',imageBytes:image}]});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(base+'/api/product-library')).status,401);
  const result=await fetch(base+'/api/ai-render',{method:'POST',headers:{cookie:'alice','content-type':'application/json'},body:JSON.stringify({selectedVersions:['ORIGINAL'],baseImage:image.toString('base64'),logoImage:image.toString('base64'),targets:[{id:'p',x:.5,y:.5,widthRatio:.2,rotation:0}]})});assert.equal(result.status,200);
  const history=await(await fetch(base+'/api/my-space/history',{headers:{cookie:'alice'}})).json();assert.equal(history.length,1);assert.ok(history[0].images.length);
  assert.deepEqual(await(await fetch(base+'/api/my-space/history',{headers:{cookie:'bob'}})).json(),[]);
  const file=history[0].images[0].url;assert.equal((await fetch(base+file,{headers:{cookie:'alice'}})).status,200);assert.equal((await fetch(base+file,{headers:{cookie:'bob'}})).status,404);
  for(const id of ['alice','bob'])assert.equal((await fetch(base+'/api/product-library',{headers:{cookie:id}})).status,200);
  assert.equal((await fetch(base+'/api/ai-render',{method:'POST',headers:{cookie:'alice',origin:'https://evil.example','content-type':'application/json'},body:'{}'})).status,403);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});

test('S7 rechecks a revoked account before saving or returning a pending generation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-revoke-'));const image=await sharp({create:{width:20,height:20,channels:4,background:'#000'}}).png().toBuffer();let revoked=false,release,started;
 const entered=new Promise(resolve=>{started=resolve;}),pending=new Promise(resolve=>{release=resolve;});
 const server=createDemoServer({spaceDir:dir,authenticate:async()=>{if(revoked)throw Object.assign(Error('请先登录'),{status:401});return {id:'alice'};},mockupRenderer:async()=>{started();await pending;return [{version:'ORIGINAL',bytes:image}];}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{const result=fetch(base+'/api/ai-render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({selectedVersions:['ORIGINAL'],baseImage:image.toString('base64'),logoImage:image.toString('base64'),targets:[{id:'p',x:.5,y:.5,widthRatio:.2,rotation:0}]})});await entered;revoked=true;release();assert.equal((await result).status,401);revoked=false;assert.deepEqual(await(await fetch(base+'/api/my-space/history')).json(),[]);}finally{release();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
