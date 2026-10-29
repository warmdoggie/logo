import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createLogoStorageClients} from './logo-oss-client.mjs';

async function digest(stream){const hash=createHash('sha256');for await(const bytes of stream)hash.update(bytes);return hash.digest('hex');}
export async function uploadSchedulerBackup({directory,stamp,client=createLogoStorageClients()}){
 if(!/^\d{8}T\d{6}Z$/.test(stamp||''))throw Error('Invalid backup timestamp');
 const remote=await client(true),prefix='s7-logo/scheduler-backups/v1/'+stamp+'/',files=[];
 async function upload(key,input,sha256){
  await remote.put(key,input,{headers:{'Content-Type':'application/octet-stream'}});
  if(await digest((await remote.getStream(key)).stream)!==sha256)throw Error('OSS backup checksum mismatch');
 }
 for(const suffix of ['.dump','.artifacts.tar']){
  const name=stamp+suffix,path=join(directory,name),details=await stat(path),sha256=await digest(createReadStream(path));
  if(!details.isFile()||details.size>4*1024**3)throw Error('Backup exceeds verified single-upload limit');
  const key=prefix+name;await upload(key,path,sha256);files.push({key,bytes:details.size,sha256});
 }
 const manifest=prefix+'manifest.json',bytes=Buffer.from(JSON.stringify({version:1,stamp,files}));
 await upload(manifest,bytes,createHash('sha256').update(bytes).digest('hex'));
 return {manifest,files:files.length,verified:true};
}
