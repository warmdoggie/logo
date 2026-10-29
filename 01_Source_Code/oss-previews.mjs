import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';

export const LOGO_OSS_ORIGIN='https://heci-002.oss-cn-heyuan.aliyuncs.com';
export const LOGO_PREVIEW_PREFIX='s7-logo/previews/v1/';
const edges=[192,1600];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const objectKey=(hash,edge)=>`${LOGO_PREVIEW_PREFIX}${hash}/${edge}.webp`;

export function createOssPreviews({directory,client}){
 async function recordFor(hash){
  let record;try{record=JSON.parse(await readFile(join(directory,hash+'.json'),'utf8'));}
  catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return null;throw error;}
  return record?.hash===hash&&Number.isSafeInteger(record.width)&&Number.isSafeInteger(record.height)&&record.width>0&&record.height>0?record:null;
 }
 async function publish(bytes){
  const hash=digest(bytes),existing=await recordFor(hash);if(existing)return existing;
  const meta=await sharp(bytes).metadata(),rotated=meta.orientation>=5;
  const width=rotated?meta.height:meta.width,height=rotated?meta.width:meta.height;
  if(!(width>0&&height>0))throw Error('预览原图尺寸无效');
  const writer=await client(true);
  for(const edge of edges){
   const preview=await sharp(bytes).rotate().resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).webp({quality:edge===192?76:85}).toBuffer();
   await writer.put(objectKey(hash,edge),preview,{headers:{'Content-Type':'image/webp','Cache-Control':'private, max-age=60','x-oss-meta-image-width':String(width),'x-oss-meta-image-height':String(height)}});
  }
  await mkdir(directory,{recursive:true});
  const temporary=join(directory,`${hash}.${randomUUID()}.tmp`);
  try{await writeFile(temporary,JSON.stringify({hash,width,height}));await rename(temporary,join(directory,hash+'.json'));}
  finally{await rm(temporary,{force:true});}
  return {hash,width,height};
 }
 async function find(bytes,edge){
  if(!edges.includes(edge))return null;
  const hash=digest(bytes),record=await recordFor(hash);if(!record)return null;
  let timer;
  try{
   const url=await Promise.race([
    Promise.resolve().then(()=>client(false)).then(reader=>reader.signatureUrl(objectKey(hash,edge),{expires:60})),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('OSS signing timeout')),800);})
   ]);
   return {url,width:record.width,height:record.height};
  }catch{return null;}finally{clearTimeout(timer);}
 }
 return {publish,find};
}
