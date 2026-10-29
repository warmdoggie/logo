import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';

test('the image worker preserves the product outside the print mask at original resolution',async()=>{
 let module;try{module=await import('./images.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
 assert.ok(module?.processScheduledImage,'business images need their print masks applied in the worker');
 const folder=await mkdtemp(join(tmpdir(),'scheduler-print-'));
 try{
  const base=await sharp({create:{width:80,height:80,channels:4,background:'#eeeeee'}}).png().toBuffer();
  const generated=await sharp({create:{width:80,height:80,channels:4,background:'#ff0000'}}).png().toBuffer();
  const mask=await sharp({create:{width:80,height:80,channels:3,background:'#000'}}).composite([{input:await sharp({create:{width:10,height:10,channels:3,background:'#fff'}}).png().toBuffer(),left:30,top:30}]).png().toBuffer();
  const data=b=>'data:image/png;base64,'+b.toString('base64');
  const plan=JSON.stringify({version:'BLACK',baseImage:data(base),placementGuide:data(generated),maskImage:data(mask)}),hash=createHash('sha256').update(plan).digest('hex');
  const {mkdir}=await import('node:fs/promises');await mkdir(join(folder,'plans'));await writeFile(join(folder,'plans',hash+'.json'),plan);
  const original=join(folder,'download.original');await writeFile(original,generated);
  const id=randomUUID(),descriptor={original:'s7-logo/generations/v1/original.png',preview:'s7-logo/generations/v1/preview.webp'};
  const path=await module.processScheduledImage({id,lease_token:randomUUID(),params:{batchId:randomUUID(),planHash:hash},file_path:original},{directory:folder,storage:{async publish(jobId,file){assert.equal(jobId,id);assert.equal((await sharp(await readFile(file)).metadata()).width,80);return descriptor;}}});
  const {data:pixel,info}=await sharp(await readFile(path)).raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,80);assert.equal(info.height,80);assert.deepEqual([...pixel.subarray(0,3)],[238,238,238]);
  const center=(35*80+35)*info.channels;assert.ok(pixel[center]>pixel[center+1]);
  assert.deepEqual(JSON.parse(await readFile(join(folder,id+'.storage.json'),'utf8')),descriptor);
  const pending={id:randomUUID(),lease_token:randomUUID(),params:{batchId:randomUUID(),planHash:hash},file_path:original};
  await assert.rejects(module.processScheduledImage(pending,{directory:folder,storage:{async publish(){throw Error('OSS unavailable');}}}),{code:'STORAGE_PENDING'});
  await rm(join(folder,'plans',hash+'.json'));await rm(original);
  await module.processScheduledImage({...pending,error_code:'storage_pending'},{directory:folder,storage:{async publish(){return descriptor;}}});
  assert.deepEqual(JSON.parse(await readFile(join(folder,pending.id+'.storage.json'),'utf8')),descriptor);
 }finally{await rm(folder,{recursive:true,force:true});}
});
