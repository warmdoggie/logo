import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';

test('S7 requires a session and saves generation history and images separately for each user',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-users-'));
 const image=await sharp({create:{width:20,height:20,channels:4,background:'#000'}}).png().toBuffer();
 const server=createDemoServer({spaceDir:dir,authenticate:async req=>{const id=req.headers.cookie;if(!['alice','bob'].includes(id))throw Object.assign(Error('请先登录'),{status:401});return {id,username:id};},mockupRenderer:async()=>[{version:'ORIGINAL',bytes:image}],productCatalog:async()=>[{id:'shared',sku:'SHARED',imageBytes:image}]});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(base+'/api/product-library')).status,401);
  const result=await fetch(base+'/api/ai-render',{method:'POST',headers:{cookie:'alice','content-type':'application/json'},body:JSON.stringify({baseImage:image.toString('base64'),logoImage:image.toString('base64'),targets:[{id:'p',x:.5,y:.5,widthRatio:.2,rotation:0}]})});assert.equal(result.status,200);
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
 try{const result=fetch(base+'/api/ai-render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({baseImage:image.toString('base64'),logoImage:image.toString('base64'),targets:[{id:'p',x:.5,y:.5,widthRatio:.2,rotation:0}]})});await entered;revoked=true;release();assert.equal((await result).status,401);revoked=false;assert.deepEqual(await(await fetch(base+'/api/my-space/history')).json(),[]);}finally{release();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
