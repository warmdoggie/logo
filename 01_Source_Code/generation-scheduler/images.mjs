import sharp from 'sharp';
import {readFile,writeFile,rename,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {readPlan,appModule} from './plans.mjs';

export async function processScheduledImage(job,{directory,storage}){
 const business=!!job.params.batchId,extension=business?'.png':'.webp';
 const final=join(directory,job.id+extension),temporary=join(directory,job.id+'.'+job.lease_token+extension);
 try{
  let ready=false;if(job.error_code==='storage_pending'){try{ready=(await stat(final)).isFile();}catch(error){if(error.code!=='ENOENT')throw error;}}
  if(!ready){
  if(business){
   const plan=await readPlan(directory,job.params.planHash);
   const {preservePrintSurface,isLocalMockup}=await import(appModule('s7-logo-stability/ai-mockup-provider.mjs'));
   if(job.params.local&&!isLocalMockup(plan))throw Error('Invalid local print plan');
   const source=job.params.local?Buffer.from(plan.baseImage.split(',')[1],'base64'):await readFile(job.file_path);
   const pixels=await sharp(source,{limitInputPixels:40000000}).metadata();if(!pixels.width||!pixels.height)throw Error('Invalid image');
   const bytes=await preservePrintSurface(plan,source);
   const image=sharp(bytes,{limitInputPixels:40000000});
   if(job.params.local&&(await image.metadata()).format==='png'){
    await image.resize(1,1).raw().toBuffer();
    await writeFile(temporary,bytes);
   }else await image.png().toFile(temporary);
  }else await sharp(job.file_path,{limitInputPixels:40000000}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toFile(temporary);
  await rename(temporary,final);
  }
  if(business&&storage){
   try{
   const descriptor=await storage.publish(job.id,final),sidecar=join(directory,job.id+'.storage.json'),pending=sidecar+'.'+job.lease_token;
   try{await writeFile(pending,JSON.stringify(descriptor),{mode:0o600});await rename(pending,sidecar);}finally{await rm(pending,{force:true});}
   }catch{throw Object.assign(Error('OSS synchronization pending'),{code:'STORAGE_PENDING'});}
  }
  return final;
 }finally{await rm(temporary,{force:true});}
}
