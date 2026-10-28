import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';

test('母版与图库使用轻量预览，原始尺寸、历史图片与原图下载不变',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'template-preview-')),child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,APP_DATA_DIR:dir,APP_NO_SEED:'1',APP_MULTI_USER:'0',PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 try{
  const origin=await new Promise((resolve,reject)=>{let text='';child.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});child.once('error',reject);child.once('exit',code=>reject(Error('startup '+code)));setTimeout(()=>reject(Error('startup timeout')),10000).unref();});
  const png=await sharp({create:{width:3201,height:1601,channels:4,background:'#abc'}}).png().toBuffer();
  const rotated=await sharp({create:{width:2400,height:1200,channels:3,background:'#123'}}).jpeg().withMetadata({orientation:6}).toBuffer();
  for(const [index,bytes,width,height]of [[0,png,3201,1601],[1,rotated,1200,2400]]){
   const form=new FormData();for(const [key,value]of Object.entries({sku:'F000'+index,name:'preview',category:'脸部'}))form.set(key,value);form.set('image',new Blob([bytes]),'photo.png');
   const created=await fetch(origin+'/api/products',{method:'POST',body:form});assert.equal(created.status,201);const {id}=await created.json(),{product}=await(await fetch(origin+'/api/templates/'+id)).json(),url=origin+'/files/'+product.standardImage;
   const response=await fetch(url+'?preview=1');assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');assert.equal(Number(response.headers.get('X-Image-Width')),width);assert.equal(Number(response.headers.get('X-Image-Height')),height);
   const preview=await sharp(Buffer.from(await response.arrayBuffer())).metadata();assert.equal(Math.max(preview.width,preview.height),1600);assert.ok(Math.abs(preview.width/preview.height-width/height)<.001);
   const thumbnail=await fetch(url+'?thumbnail=1');assert.equal(thumbnail.headers.get('content-type'),'image/webp');const meta=await sharp(Buffer.from(await thumbnail.arrayBuffer())).metadata();assert.equal(Math.max(meta.width,meta.height),192);
   for(const suffix of ['', '?download=1', '?download=1&preview=1'])assert.ok(Buffer.from(await(await fetch(url+suffix)).arrayBuffer()).equals(bytes));
  }
 }finally{if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}await rm(dir,{recursive:true,force:true});}
});
