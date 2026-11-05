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

test('browser downloads at most two originals at once and builds the ZIP without using the server archive path',async()=>{
 assert.equal(typeof browserArchive.fetchArchive,'function','saved task downloads need browser-side image retrieval');
 const server=(await import('node:http')).createServer((req,res)=>{active++;peak=Math.max(peak,active);setTimeout(()=>{active--;res.end(req.url);},20);});let active=0,peak=0;
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{const zip=await browserArchive.fetchArchive([1,2,3,4,5].map(n=>({url:origin+'/image-'+n,name:n+'.png'})));const files=unzipStored(Buffer.from(zip));assert.deepEqual(files.map(file=>file.bytes.toString()),['/image-1','/image-2','/image-3','/image-4','/image-5']);assert.equal(peak,2);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('browser archive stops oversized downloads before building a large ZIP',async()=>{
 const chunk=new Uint8Array(8*1024*1024);let sent=0;
 const request=async()=>new Response(new ReadableStream({pull(controller){if(sent++<38)controller.enqueue(chunk);else controller.close();}}));
 await assert.rejects(browserArchive.fetchArchive([{url:'/large',name:'large.png'}],{request}),/300 MB/);
 await assert.rejects(browserArchive.fetchArchive(Array.from({length:201},()=>({url:'/image',name:'image.png'}))),/1–200/);
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
  const manifest=await fetch(`${base}/api/my-space/tasks/${task.id}/download`,{method:'POST',headers:{cookie:'alice','content-type':'application/json'},body:JSON.stringify({manifest:true,urls:[a.images[0].url,b.images[0].url]})});
  assert.match(manifest.headers.get('content-type'),/application\/json/);const plan=await manifest.json();assert.equal(plan.filename,'任务一.zip');assert.equal(plan.folderName,'任务一');assert.deepEqual(plan.files.map(file=>file.url),[a.images[0].url,b.images[0].url]);
  const browserZip=await browserArchive.fetchArchive(plan.files.map(file=>({...file,url:base+file.url})));assert.deepEqual(unzipStored(Buffer.from(browserZip)),files);
  assert.equal((await call(task.id,[])).status,400);
  assert.equal((await call(task.id,[foreign.images[0].url])).status,400);
  assert.equal((await call(task.id,['https://example.com/image.png'])).status,400);
  assert.equal((await call(task.id,[a.images[0].url],'bob')).status,404);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
