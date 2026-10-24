import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {createCleanupHandler} from './server.mjs';

const source=()=>sharp({create:{width:40,height:40,channels:4,background:'#778899'}}).png().toBuffer();
async function setup(t,provider){
  const dataDir=await mkdtemp(join(tmpdir(),'cleanup-http-'));
  const handler=createCleanupHandler({dataDir,provider,authenticate:req=>{if(!req.headers['x-test-user'])throw Object.assign(Error('请登录'),{status:401});return {id:req.headers['x-test-user']};}});
  const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});});
  const call=(path='',{user='alice',method='GET',body}={})=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'x-test-user':user,...(body&&!(body instanceof FormData)?{'content-type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});
  const create=async()=>{const r=await call('/api/batches',{method:'POST',body:{}});assert.equal(r.status,201);return r.json();};
  const upload=async(id,name='product.jpg')=>{const form=new FormData();form.set('file',new File([await source()],name,{type:'image/png'}));const r=await call(`/api/batches/${id}/images`,{method:'POST',body:form});assert.equal(r.status,201);return r.json();};
  const idle=async(id)=>{for(let i=0;i<100;i++){const b=await(await call(`/api/batches/${id}`)).json();if(!b.busy)return b;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('batch did not finish');};
  return {call,create,upload,idle,dataDir,url:`http://127.0.0.1:${server.address().port}`};
}

test('batch detection, partial failure, retry and ZIP export survive page reloads',async t=>{
  let attempts=0;
  const provider={status:()=>({configured:true}),detect:async()=>[{x:.2,y:.2,width:.2,height:.1}],remove:async(bytes)=>{attempts++;if(attempts===2)throw Error('upstream failed');return bytes;}};
  const {call,create,upload,idle}=await setup(t,provider);
  const created=await create();await upload(created.id,'duplicate.jpg');const uploaded=await upload(created.id,'duplicate.jpg');
  assert.equal(uploaded.items.length,2);
  assert.equal((await call(`/api/batches/${created.id}/remove`,{method:'POST',body:{}})).status,400);
  assert.equal((await call(`/api/batches/${created.id}/detect`,{method:'POST',body:{}})).status,202);
  const detected=await idle(created.id);assert.ok(detected.items.every(item=>item.regions.length===1));
  assert.equal((await call(`/api/batches/${created.id}/remove`,{method:'POST',body:{}})).status,202);
  const partial=await idle(created.id);assert.equal(partial.items.filter(item=>item.status==='done').length,1);assert.equal(partial.items.filter(item=>item.status==='error').length,1);
  const retry=await call(`/api/batches/${created.id}/remove`,{method:'POST',body:{}});assert.equal(retry.status,202);
  const done=await idle(created.id);assert.ok(done.items.every(item=>item.status==='done'));assert.equal(attempts,3);
  const zip=await call(`/api/batches/${created.id}/download`);assert.equal(zip.status,200);
  const bytes=Buffer.from(await zip.arrayBuffer());assert.equal(bytes.readUInt32LE(0),0x04034b50);assert.equal(bytes.readUInt16LE(bytes.length-12),2);
  assert.ok(bytes.includes(Buffer.from('001_duplicate_clean.png')));assert.ok(bytes.includes(Buffer.from('002_duplicate_clean.png')));
  const result=await call(`/api/batches/${created.id}/images/${done.items[0].id}/result`);assert.equal(result.status,200);
  const restored=await(await call('/api/batches')).json();assert.equal(restored[0].id,created.id);
});

test('users cannot list, modify, process, view or export each other’s images',async t=>{
  const {call,create,upload}=await setup(t,{status:()=>({configured:true})});
  assert.equal((await call('/api/batches',{user:''})).status,401);
  const batch=await create(),uploaded=await upload(batch.id),item=uploaded.items[0];
  assert.deepEqual(await(await call('/api/batches',{user:'bob'})).json(),[]);
  for(const [path,method] of [[`/api/batches/${batch.id}`,'GET'],[`/api/batches/${batch.id}/images/${item.id}/original`,'GET'],[`/api/batches/${batch.id}/download`,'GET'],[`/api/batches/${batch.id}/detect`,'POST'],[`/api/batches/${batch.id}/images/${item.id}`,'PATCH']])assert.equal((await call(path,{user:'bob',method,...(method!=='GET'?{body:{regions:[]}}:{})})).status,404);
});

test('manual regions invalidate old results and running jobs reject edits or duplicate submission',async t=>{
  let finish;
  const {call,create,upload,idle}=await setup(t,{status:()=>({configured:true}),remove:()=>new Promise(resolve=>{finish=resolve;})});
  const batch=await create(),uploaded=await upload(batch.id),path=`/api/batches/${batch.id}/images/${uploaded.items[0].id}`;
  assert.equal((await call(path,{method:'PATCH',body:{regions:[{x:0,y:0,width:1,height:1}]}})).status,400);
  assert.equal((await call(path,{method:'PATCH',body:{regions:[{x:.2,y:.2,width:.2,height:.1}]}})).status,200);
  assert.equal((await call(`/api/batches/${batch.id}/remove`,{method:'POST',body:{}})).status,202);
  assert.equal((await call(path,{method:'PATCH',body:{regions:[]}})).status,409);
  assert.equal((await call(`/api/batches/${batch.id}/remove`,{method:'POST',body:{}})).status,409);
  finish(await source());await idle(batch.id);
  assert.equal((await call(path,{method:'PATCH',body:{regions:[]}})).status,200);
  assert.equal((await call(path+'/result')).status,404);
});

test('unreadable images and SVG uploads fail without adding batch items',async t=>{
  const {call,create}=await setup(t,{status:()=>({configured:true})});const batch=await create();
  for(const bytes of ['not an image','<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20"/></svg>']){
    const form=new FormData();form.set('file',new File([bytes],'bad.png'));
    assert.equal((await call(`/api/batches/${batch.id}/images`,{method:'POST',body:form})).status,400);
  }
  assert.equal((await(await call(`/api/batches/${batch.id}`)).json()).items.length,0);
});

test('an edit whose body arrives after processing starts cannot change the running regions',async t=>{
  let finish;
  const {call,create,upload,idle,url}=await setup(t,{status:()=>({configured:true}),remove:()=>new Promise(resolve=>{finish=resolve;})});
  const batch=await create(),uploaded=await upload(batch.id),path=`/api/batches/${batch.id}/images/${uploaded.items[0].id}`;
  await call(path,{method:'PATCH',body:{regions:[{x:.2,y:.2,width:.2,height:.1}]}});
  let patch;
  const pending=new Promise(resolve=>{patch=request(url+path,{method:'PATCH',headers:{'x-test-user':'alice','Content-Type':'application/json'}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});});
  patch.write('{"regions":');await new Promise(resolve=>setTimeout(resolve,30));
  const started=await call(`/api/batches/${batch.id}/remove`,{method:'POST',body:{}});assert.equal(started.status,202);
  patch.end('[]}');const status=await pending;
  finish(await source());const result=await idle(batch.id);
  assert.equal(status,409);assert.equal(result.items[0].regions.length,1);
});

test('batch queue thumbnails load small previews while originals keep full resolution',async t=>{
  const {call,create}=await setup(t,{status:()=>({configured:true})}),batch=await create();
  const bytes=await sharp({create:{width:600,height:400,channels:4,background:'silver'}}).png().toBuffer(),form=new FormData();form.set('file',new File([bytes],'large.png'));
  const uploaded=await(await call(`/api/batches/${batch.id}/images`,{method:'POST',body:form})).json(),path=`/api/batches/${batch.id}/images/${uploaded.items[0].id}/original`;
  const small=await call(path+'?thumbnail=1'),meta=await sharp(Buffer.from(await small.arrayBuffer())).metadata();
  assert.equal(meta.width,192);assert.equal(meta.height,128);
  assert.equal((await sharp(Buffer.from(await(await call(path)).arrayBuffer())).metadata()).width,600);
});

test('a new service instance recovers interrupted work and retries the saved remote task',async t=>{
  const {create,upload,dataDir}=await setup(t,{status:()=>({configured:true})}),batch=await create(),uploaded=await upload(batch.id);
  const folder=join(dataDir,createHash('sha256').update('alice').digest('hex'),batch.id),file=join(folder,'batch.json');
  const stored=JSON.parse(await readFile(file,'utf8'));stored.busy=true;Object.assign(stored.items[0],{status:'removing',regions:[{x:.2,y:.2,width:.2,height:.1}],removeRemote:{taskId:'existing-remote-task'}});await writeFile(file,JSON.stringify(stored));
  let resumed;
  const server=createServer(createCleanupHandler({dataDir,authenticate:()=>({id:'alice'}),provider:{status:()=>({configured:true}),remove:async(bytes,regions,options)=>{resumed=options.resume;return bytes;}}}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/batches/${batch.id}`;
  try{
    const recovered=await(await fetch(base)).json();assert.equal(recovered.busy,false);assert.equal(recovered.items[0].status,'error');
    assert.equal((await fetch(base+'/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,202);
    for(let i=0;i<100;i++){const value=await(await fetch(base)).json();if(!value.busy){assert.equal(value.items[0].status,'done');break;}await new Promise(resolve=>setTimeout(resolve,10));}
    assert.deepEqual(resumed,{taskId:'existing-remote-task'});
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('one request detects and removes an entire batch with three concurrent jobs and skips completed images',async t=>{
  let active=0,peak=0,detections=0,release;
  const gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  const {call,create,upload,idle}=await setup(t,{
    status:()=>({configured:true}),
    detect:async()=>{detections++;return [{x:.2,y:.2,width:.2,height:.1}];},
    remove:async bytes=>{active++;peak=Math.max(peak,active);await gate;active--;return bytes;}
  });
  const batch=await create();for(let i=0;i<5;i++)await upload(batch.id,`product-${i}.png`);
  const started=await call(`/api/batches/${batch.id}/auto`,{method:'POST',body:{}});
  assert.equal(started.status,202);
  try{
    for(let i=0;i<100&&active<3;i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(active,3);
    const current=await(await call(`/api/batches/${batch.id}`)).json();
    assert.equal(current.busy,true);assert.equal(current.items.filter(item=>item.status==='queued').length,2);
    assert.equal((await call(`/api/batches/${batch.id}/auto`,{method:'POST',body:{}})).status,409);
  }finally{release();}
  const done=await idle(batch.id);
  assert.ok(done.items.every(item=>item.status==='done'));assert.equal(peak,3);assert.equal(detections,5);
  assert.equal((await call(`/api/batches/${batch.id}/auto`,{method:'POST',body:{}})).status,400);
  assert.equal((await call(`/api/batches/${batch.id}/auto`,{method:'POST',body:{ids:[done.items[0].id]}})).status,400);
  assert.equal(detections,5);
  assert.equal((await call(`/api/batches/${batch.id}/download`)).status,200);
});

test('automatic processing keeps manual regions, reports missed text and retries only failed or unfinished images',async t=>{
  let detections=0,removals=0;
  const {call,create,upload,idle}=await setup(t,{
    status:()=>({configured:true}),
    detect:async()=>{detections++;return detections===1?[]:[{x:.3,y:.3,width:.2,height:.1}];},
    remove:async bytes=>{removals++;if(removals===1)throw Error('temporary failure');return bytes;}
  });
  const batch=await create();await upload(batch.id);const uploaded=await upload(batch.id);
  const manual=uploaded.items[0],regions=[{x:.2,y:.2,width:.2,height:.1,text:'manual'}];
  await call(`/api/batches/${batch.id}/images/${manual.id}`,{method:'PATCH',body:{regions}});
  assert.equal((await call(`/api/batches/${batch.id}/auto`,{method:'POST',body:{}})).status,202);
  const partial=await idle(batch.id);
  assert.equal(partial.items[0].status,'error');assert.equal(partial.items[1].status,'review');
  assert.deepEqual(partial.items[0].regions,regions);assert.equal(detections,1);
  assert.equal((await call(`/api/batches/${batch.id}/auto`,{method:'POST',body:{}})).status,202);
  const done=await idle(batch.id);assert.ok(done.items.every(item=>item.status==='done'));
  assert.equal(detections,2);assert.equal(removals,3);
});

test('concurrency is shared across batches and automatic jobs require an image provider',async t=>{
  let active=0,peak=0,release;
  const gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  const provider={status:()=>({configured:true}),detect:async()=>[{x:.2,y:.2,width:.2,height:.1}],remove:async bytes=>{active++;peak=Math.max(peak,active);await gate;active--;return bytes;}};
  const {call,create,upload,idle}=await setup(t,provider);
  const batches=[await create(),await create()];
  for(const batch of batches){await upload(batch.id);await upload(batch.id);}
  try{
    for(const batch of batches)assert.equal((await call(`/api/batches/${batch.id}/auto`,{method:'POST',body:{}})).status,202);
    for(let i=0;i<100&&active<3;i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(active,3);
  }finally{release();}
  for(const batch of batches)assert.ok((await idle(batch.id)).items.every(item=>item.status==='done'));
  assert.equal(peak,3);
  const unconfigured=await create();await upload(unconfigured.id);provider.status=()=>({configured:false});
  assert.equal((await call(`/api/batches/${unconfigured.id}/auto`,{method:'POST',body:{}})).status,400);
  assert.equal((await(await call(`/api/batches/${unconfigured.id}`)).json()).busy,false);
});

test('manual removal rejects images without regions even when selected explicitly',async t=>{
  const {call,create,upload}=await setup(t,{status:()=>({configured:true})});
  const batch=await create(),uploaded=await upload(batch.id);
  assert.equal((await call(`/api/batches/${batch.id}/remove`,{method:'POST',body:{ids:[uploaded.items[0].id]}})).status,400);
  const stored=await(await call(`/api/batches/${batch.id}`)).json();
  assert.equal(stored.busy,false);assert.equal(stored.items[0].status,'uploaded');
});
