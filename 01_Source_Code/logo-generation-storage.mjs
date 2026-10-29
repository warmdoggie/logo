import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {createLogoStorageClients} from './logo-oss-client.mjs';

const prefix='s7-logo/generations/v1/';
const valid=new RegExp('^'+prefix+'[0-9a-f-]{36}/[0-9a-f]{64}\\.(png|webp)$');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function createGenerationStorage({client=createLogoStorageClients()}={}){
 return {
  async publish(id,file){
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))throw Error('Invalid generation id');
   const bytes=await readFile(file),preview=await sharp(bytes,{limitInputPixels:40000000}).resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).webp({quality:84}).toBuffer();
   const remote=await client(true),descriptor={};
   for(const [name,content,extension] of [['original',bytes,'png'],['preview',preview,'webp']]){
    const digest=hash(content),key=prefix+id+'/'+digest+'.'+extension;
    await remote.put(key,content,{headers:{'Content-Type':'image/'+extension,'Cache-Control':'private, max-age=31536000, immutable'}});
    if(hash((await remote.get(key)).content)!==digest)throw Error('OSS image checksum mismatch');
    descriptor[name]=key;
   }
   return descriptor;
  },
  async url(descriptor,preview=false){
   if(!valid.test(descriptor?.original||'')||!valid.test(descriptor?.preview||''))throw Error('Invalid generation storage descriptor');
   return (await client(false)).signatureUrl(preview?descriptor.preview:descriptor.original,{expires:60});
  }
 };
}
