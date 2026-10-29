import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

const image=()=>sharp({create:{width:2400,height:1200,channels:3,background:'#abc'}}).jpeg().withMetadata({orientation:6}).toBuffer();
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

test('OSS 预览只写入 Logo 专属目录，保留原图坐标并可跨重启读取',async()=>{
 const {createOssPreviews}=await import('./oss-previews.mjs');
 const directory=await mkdtemp(join(tmpdir(),'oss-preview-')),objects=new Map();
 const client={put:async(key,bytes,options)=>objects.set(key,{bytes,options}),signatureUrl:key=>'https://heci-002.oss-cn-heyuan.aliyuncs.com/'+key+'?test-signature'};
 try{
  const bytes=await image(),hash=digest(bytes),previews=createOssPreviews({directory,client:async()=>client});
  await previews.publish(bytes);
  assert.equal(objects.size,2);
  for(const edge of [192,1600]){
   const object=objects.get(`s7-logo/previews/v1/${hash}/${edge}.webp`);assert.ok(object);
   const meta=await sharp(object.bytes).metadata();assert.equal(Math.max(meta.width,meta.height),edge);
   assert.equal(object.options.headers['x-oss-meta-image-width'],'1200');assert.equal(object.options.headers['x-oss-meta-image-height'],'2400');
  }
  const restarted=createOssPreviews({directory,client:async()=>client});
  const ready=await restarted.find(bytes,1600);assert.equal(ready.width,1200);assert.equal(ready.height,2400);assert.match(ready.url,/\/s7-logo\/previews\/v1\/[a-f0-9]{64}\/1600\.webp\?/);
  const noUpload=createOssPreviews({directory,client:async()=>{throw Error('already published preview should not upload again');}});await noUpload.publish(bytes);
  assert.equal(await restarted.find(Buffer.from('new content'),1600),null);
  assert.equal(await restarted.find(bytes,1200),null);
  assert.equal(await restarted.find(bytes,'../../frame/private'),null);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('未完成同步或 OSS 签名失败时返回本地回退，不发布半份清单',async()=>{
 const {createOssPreviews}=await import('./oss-previews.mjs');
 const directory=await mkdtemp(join(tmpdir(),'oss-failure-'));
 try{
  const bytes=await image();let puts=0;
  const broken=createOssPreviews({directory,client:async()=>({put:async()=>{if(++puts===2)throw Error('unavailable');}})});
  assert.equal(await broken.find(bytes,1600),null);
  await assert.rejects(broken.publish(bytes),/unavailable/);assert.deepEqual(await readdir(directory),[]);
  const healthy=createOssPreviews({directory,client:async()=>({put:async()=>{}})});await healthy.publish(bytes);
  const offline=createOssPreviews({directory,client:async()=>{throw Error('credentials unavailable');}});
  assert.equal(await offline.find(bytes,1600),null);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('被修改的清单不能把图片签名指向 FRAME 路径',async()=>{
 const {createOssPreviews}=await import('./oss-previews.mjs');
 const directory=await mkdtemp(join(tmpdir(),'oss-scope-'));let signed;
 const client={put:async()=>{},signatureUrl:key=>{signed=key;return 'https://heci-002.oss-cn-heyuan.aliyuncs.com/'+key;}};
 try{
  const bytes=await image(),hash=digest(bytes),store=createOssPreviews({directory,client:async()=>client});await store.publish(bytes);
  const file=join(directory,hash+'.json'),record=JSON.parse(await readFile(file,'utf8'));record.keys={'1600':'frame/backups/private'};await writeFile(file,JSON.stringify(record));
  const ready=await store.find(bytes,1600);assert.ok(ready);assert.equal(signed,`s7-logo/previews/v1/${hash}/1600.webp`);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('空清单应回退本地并允许重新同步修复',async()=>{
 const {createOssPreviews}=await import('./oss-previews.mjs');const directory=await mkdtemp(join(tmpdir(),'oss-null-'));
 try{
  const bytes=await image(),hash=digest(bytes),store=createOssPreviews({directory,client:async()=>({put:async()=>{}})});
  await writeFile(join(directory,hash+'.json'),'null');assert.equal(await store.find(bytes,1600),null);
  await store.publish(bytes);assert.equal(JSON.parse(await readFile(join(directory,hash+'.json'),'utf8')).width,1200);
 }finally{await rm(directory,{recursive:true,force:true});}
});
