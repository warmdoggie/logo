import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {renderLogoSet} from '../s7-logo-stability/index.mjs';
import {buildAiMockupPlan} from '../s7-logo-stability/ai-mockup-generation.mjs';
import {processScheduledImage} from './images.mjs';

test('the worker renders local gold from the product without a downloaded image',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'scheduler-local-gold-'));
 try{
  const base=await sharp({create:{width:64,height:32,channels:4,background:'#cccccc'}}).png().toBuffer();
  const logo=await sharp(Buffer.from('<svg width="24" height="12"><path fill="black" fill-rule="evenodd" d="M0 0H24V12H0Z M7 3V9H17V3Z"/></svg>')).png().toBuffer();
  const targets=[{id:'front',x:.5,y:.5,widthRatio:.5}],data=b=>'data:image/png;base64,'+b.toString('base64');
  const set=await renderLogoSet({baseImage:base,logoImage:logo,targets,originalColor:'#000000'}),gold=set.outputs[2];
  const [plan]=buildAiMockupPlan({model:'flux-3-image',baseImage:data(base),logoImage:data(logo),targets,originalColor:'#000000',onlyVersion:'GOLD FOIL',guides:[{version:gold.version,dataUrl:data(gold.bytes),maskDataUrl:data(gold.mask),foilMaskDataUrl:data(gold.foilMask),goldMaskDataUrl:data(gold.goldMask)}]});
  const serialized=JSON.stringify({...plan,local:true}),hash=createHash('sha256').update(serialized).digest('hex');
  await mkdir(join(folder,'plans'));await writeFile(join(folder,'plans',hash+'.json'),serialized);
  const path=await processScheduledImage({id:randomUUID(),lease_token:randomUUID(),params:{batchId:randomUUID(),planHash:hash,local:true}},{directory:folder});
  const pixels=await sharp(await readFile(path)).ensureAlpha().raw().toBuffer(),mask=await sharp(gold.mask).greyscale().raw().toBuffer();
  let printed=0;
  for(let i=0;i<mask.length;i++){
   const k=i*4;
   if(!mask[i])assert.deepEqual([...pixels.subarray(k,k+4)],[204,204,204,255]);
   if(mask[i]===255){printed++;assert.ok(pixels[k]>pixels[k+1]&&pixels[k+1]>pixels[k+2]);}
  }
  assert.ok(printed>0);
 }finally{await rm(folder,{recursive:true,force:true});}
});

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
