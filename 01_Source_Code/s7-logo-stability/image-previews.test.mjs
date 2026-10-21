import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomFillSync} from 'node:crypto';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';
import {userSpace} from './user-space.mjs';

test('成图预览缩小传输并复用派生文件，原图下载和账号隔离不变',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-preview-')),spaces=userSpace(dir),user={id:'alice'};
 const pixels=randomFillSync(Buffer.alloc(1800*1400*3));for(let i=0;i<pixels.length;i++)pixels[i]=180+pixels[i]%24;
 const original=await sharp(pixels,{raw:{width:1800,height:1400,channels:3}}).png().toBuffer();
 const task=await spaces.createTask(user,{title:'preview'}),record=await spaces.save(user,{taskId:task.id,kind:'AI上样',images:[{label:'ORIGINAL',bytes:original}]});
 const server=createDemoServer({spaceDir:dir,authenticate:async req=>({id:req.headers.cookie||'alice'}),productCatalog:async()=>[{id:'p',sku:'P',name:'P',imageBytes:original}]});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,url=record.images[0].url;
 try{
  const response=await fetch(base+url+'?preview=1');assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');
  const bytes=Buffer.from(await response.arrayBuffer()),meta=await sharp(bytes).metadata();assert.ok(meta.width<=1200&&meta.height<=1200);assert.ok(bytes.length<original.length/3,'卡片不应传输整张 PNG');
  const folder=join(dir,user.id,record.id),cache=(await readdir(folder)).find(name=>name.endsWith('.webp'));assert.ok(cache);
  const before=await stat(join(folder,cache));assert.deepEqual(Buffer.from(await(await fetch(base+url+'?preview=1')).arrayBuffer()),bytes);assert.equal((await stat(join(folder,cache))).mtimeMs,before.mtimeMs);
  assert.deepEqual(Buffer.from(await(await fetch(base+url)).arrayBuffer()),original);
  assert.deepEqual(await readFile(join(folder,record.images[0].name)),original);
  assert.equal((await fetch(base+url+'?preview=1',{headers:{cookie:'bob'}})).status,404);
  const thumbnail=await fetch(base+'/api/product-library/image/p?thumbnail=1');assert.equal(thumbnail.headers.get('content-type'),'image/webp');const small=await sharp(Buffer.from(await thumbnail.arrayBuffer())).metadata();assert.ok(small.width<=192&&small.height<=192);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
