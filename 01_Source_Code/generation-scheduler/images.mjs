import sharp from 'sharp';
import {readFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {readPlan,appModule} from './plans.mjs';

export async function processScheduledImage(job,{directory}){
 const business=!!job.params.batchId,extension=business?'.png':'.webp';
 const final=join(directory,job.id+extension),temporary=join(directory,job.id+'.'+job.lease_token+extension);
 try{
  if(business){
   const plan=await readPlan(directory,job.params.planHash);
   const {preservePrintSurface,isLocalSilver}=await import(appModule('s7-logo-stability/ai-mockup-provider.mjs'));
   if(job.params.local&&!await isLocalSilver(plan))throw Error('Invalid local print plan');
   const source=job.params.local?Buffer.from(plan.baseImage.split(',')[1],'base64'):await readFile(job.file_path);
   const pixels=await sharp(source,{limitInputPixels:40000000}).metadata();if(!pixels.width||!pixels.height)throw Error('Invalid image');
   const bytes=await preservePrintSurface(plan,source);
   await sharp(bytes,{limitInputPixels:40000000}).png().toFile(temporary);
  }else await sharp(job.file_path,{limitInputPixels:40000000}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toFile(temporary);
  await rename(temporary,final);return final;
 }finally{await rm(temporary,{force:true});}
}
