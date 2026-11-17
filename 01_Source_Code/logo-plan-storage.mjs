import {createHash} from 'node:crypto';
import {gzip,createGunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createLogoStorageClients} from './logo-oss-client.mjs';

const compress=promisify(gzip);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function keyOf(hash){
 if(!/^[a-f0-9]{64}$/.test(hash||''))throw Error('Invalid plan hash');
 return 's7-logo/scheduler-backups/v1/plans/'+hash+'.json.gz';
}
export function createPlanStorage({client=createLogoStorageClients()}={}){
 async function download(hash,retain){
  const key=keyOf(hash),remote=await client(true),sum=createHash('sha256'),chunks=[];let size=0;
  await pipeline((await remote.getStream(key,{timeout:120000})).stream,createGunzip(),new Writable({write(chunk,encoding,done){
   size+=chunk.length;
   if(size>512*1024*1024){done(Error('Image plan exceeds input limit'));return;}
   sum.update(chunk);if(retain)chunks.push(chunk);done();
  }}));
  if(sum.digest('hex')!==hash)throw Error('Image plan checksum mismatch');
  return retain?Buffer.concat(chunks,size):{key,bytes:size};
 }
 return {
  async remove(hash){const key=keyOf(hash);await (await client(true)).delete(key);},
  read:hash=>download(hash,true),
  verify:hash=>download(hash,false),
  async publish(hash,bytes){
   const key=keyOf(hash);if(digest(bytes)!==hash)throw Error('Image plan checksum mismatch');
   const compressed=await compress(bytes),remote=await client(true);
   await remote.put(key,compressed,{timeout:120000,headers:{'Content-Type':'application/gzip','Cache-Control':'private, max-age=31536000, immutable'}});
   await download(hash,false);
   return {key,bytes:bytes.length,compressedBytes:compressed.length};
  }
 };
}
