import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDemoServer} from './demo-server.mjs';
import {userSpace} from './user-space.mjs';
import {zipStore} from '../zip.mjs';
import * as browserArchive from './download-archive.mjs';

test('独立预览入口也能在浏览器把所选图片打包为相同的 ZIP',()=>{
 assert.equal(typeof browserArchive.zipStore,'function');
 const files=[{name:'L0048-原色.png',bytes:new Uint8Array([1,2,3])},{name:'L0049-黑白.png',bytes:new Uint8Array([4,5])}];
 assert.deepEqual(Buffer.from(browserArchive.zipStore(files)),zipStore(files));
});

function unzipStored(bytes){
 const files=[];let offset=0;
 while(bytes.readUInt32LE(offset)===0x04034b50){
  const size=bytes.readUInt32LE(offset+18),length=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),start=offset+30+length+extra;
  files.push({name:bytes.subarray(offset+30,offset+30+length).toString(),bytes:bytes.subarray(start,start+size)});offset=start+size;
 }
 return files;
}

test('批量下载只打包当前任务选中的跨产品图片，并隔离其他任务和账号',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-download-')),spaces=userSpace(dir),user={id:'alice'};
 const server=createDemoServer({spaceDir:dir,authenticate:async req=>({id:req.headers.cookie||'alice'})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const call=(id,urls,cookie='alice')=>fetch(`${base}/api/my-space/tasks/${id}/download`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({urls})});
 try{
  const task=await spaces.createTask(user,{title:'任务一'}),other=await spaces.createTask(user,{title:'其他任务'});
  const a=await spaces.save(user,{taskId:task.id,kind:'多包材印刷效果',images:[{label:'L0048 · ORIGINAL',bytes:Buffer.from('first')},{label:'L0048 · BLACK',bytes:Buffer.from('unselected')}]});
  const b=await spaces.save(user,{taskId:task.id,kind:'多包材印刷效果',images:[{label:'L0049 · ORIGINAL',bytes:Buffer.from('second')}]});
  const foreign=await spaces.save(user,{taskId:other.id,kind:'AI上样',images:[{label:'ORIGINAL',bytes:Buffer.from('private')}]});
  const response=await call(task.id,[a.images[0].url,b.images[0].url,a.images[0].url]);
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/zip');assert.match(response.headers.get('content-disposition'),/attachment/);
  const files=unzipStored(Buffer.from(await response.arrayBuffer()));assert.equal(files.length,2);assert.deepEqual(files.map(f=>f.bytes.toString()),['first','second']);assert.match(files[0].name,/L0048/);assert.match(files[1].name,/L0049/);
  assert.equal((await call(task.id,[])).status,400);
  assert.equal((await call(task.id,[foreign.images[0].url])).status,400);
  assert.equal((await call(task.id,['https://example.com/image.png'])).status,400);
  assert.equal((await call(task.id,[a.images[0].url],'bob')).status,404);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
