import {createHash} from 'node:crypto';
import {createWriteStream,constants} from 'node:fs';
import {lstat,readdir,mkdir,rename,rm,open,chmod,chown} from 'node:fs/promises';
import {join,dirname,basename,isAbsolute} from 'node:path';
import {Transform,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGunzip} from 'node:zlib';
import {createLogoStorageClients} from './logo-oss-client.mjs';
import {createPlanStorage} from './logo-plan-storage.mjs';

const prefix='s7-logo/scheduler-backups/v1/blobs/';
const hashOf=bytes=>createHash('sha256').update(bytes).digest('hex');
async function digest(stream){let bytes=0;const hash=createHash('sha256');for await(const chunk of stream){hash.update(chunk);bytes+=chunk.length;}return {sha256:hash.digest('hex'),bytes};}
async function remoteDigest(remote,key){return digest((await remote.getStream(key,{timeout:120000})).stream);}
function same(a,b){return a.sha256===b.sha256&&a.bytes===b.bytes;}
const permissions=details=>({mode:details.mode&0o777,uid:details.uid,gid:details.gid});
const identity=details=>[details.dev,details.ino,details.size,details.mtimeMs,details.ctimeMs,details.mode,details.uid,details.gid].join(':');
function validEntry(entry){
 if(!/^[a-z][a-z0-9-]*$/.test(entry.root)||!entry.path||entry.path.includes('\\')||entry.path.startsWith('/')||entry.path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Unsafe snapshot path');
 if(!/^[a-f0-9]{64}$/.test(entry.sha256)||entry.key!==prefix+entry.sha256||!Number.isSafeInteger(entry.bytes)||entry.bytes<0)throw Error('Invalid snapshot object');
 if(!Number.isInteger(entry.mode)||entry.mode<0||entry.mode>0o777||![entry.uid,entry.gid].every(value=>Number.isInteger(value)&&value>=0&&value<4294967295))throw Error('Invalid snapshot permissions');
}
async function verifyPlans(remote,files,hashes){
 const remotePlans=[],storage=createPlanStorage({client:async()=>remote});
 for(const hash of hashes){
  if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid plan hash');
  const entry=files.find(file=>file.root==='results'&&file.path==='plans/'+hash+'.json')||files.find(file=>file.root==='archives'&&basename(file.path)===hash+'.json.gz');
  if(!entry){
   try{remotePlans.push({hash,...await storage.verify(hash)});}
   catch(error){throw Error('Snapshot is missing a verified referenced plan',{cause:error});}
   continue;
  }
  const source=(await remote.getStream(entry.key,{timeout:120000})).stream;
  const result=createHash('sha256'),output=new Writable({write(chunk,encoding,done){result.update(chunk);done();}});
  await pipeline(...(entry.path.endsWith('.gz')?[source,createGunzip(),output]:[source,output]));
  if(result.digest('hex')!==hash)throw Error('Snapshot plan checksum mismatch');
 }
 return remotePlans;
}
export async function uploadDataSnapshot({roots,stamp,planHashes=[],client=createLogoStorageClients()}){
 if(!/^\d{8}T\d{6}Z$/.test(stamp||''))throw Error('Invalid snapshot timestamp');
 const remote=await client(true),files=[],directories=[],tree=new Map();
 async function walk(root,path,relative=''){
  const before=await lstat(path);
  tree.set(root+'/'+relative,identity(before));
  if(before.isSymbolicLink())throw Error('Snapshot cannot follow symbolic links');
  if(before.isDirectory()){directories.push({root,path:relative,...permissions(before)});for(const name of (await readdir(path)).sort())await walk(root,join(path,name),relative?relative+'/'+name:name);return;}
  if(!before.isFile())throw Error('Unsupported snapshot source');
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try{
   if(identity(await handle.stat())!==identity(before))throw Error('Snapshot source changed during backup');
   const value=await digest(handle.createReadStream({start:0,autoClose:false})),entry={root,path:relative,...value,...permissions(before),key:prefix+value.sha256};validEntry(entry);
   let exists=true;try{await remote.head(entry.key,{timeout:120000});}catch(error){if(error.status!==404)throw error;exists=false;}
   if(exists)exists=same(await remoteDigest(remote,entry.key),entry);
   if(!exists){await remote.putStream(entry.key,handle.createReadStream({start:0,autoClose:false}),{timeout:120000,contentLength:value.bytes,headers:{'Content-Type':'application/octet-stream'}});if(!same(await remoteDigest(remote,entry.key),entry))throw Error('Snapshot cloud checksum mismatch');}
   if(identity(await handle.stat())!==identity(before)||identity(await lstat(path))!==identity(before))throw Error('Snapshot source changed during backup');
   files.push(entry);
  }finally{await handle.close();}
 }
 for(const [root,path] of Object.entries(roots))await walk(root,path);
 const remotePlans=await verifyPlans(remote,files,planHashes);
 const seen=new Set();
 async function unchanged(root,path,relative=''){
  const details=await lstat(path),key=root+'/'+relative;seen.add(key);
  if(tree.get(key)!==identity(details))throw Error('Snapshot tree changed during backup');
  if(details.isDirectory())for(const name of await readdir(path))await unchanged(root,join(path,name),relative?relative+'/'+name:name);
 }
 for(const [root,path] of Object.entries(roots))await unchanged(root,path);
 if(seen.size!==tree.size)throw Error('Snapshot tree changed during backup');
 const manifest={version:2,stamp,files,directories,planHashes,remotePlans,verifiedAt:new Date().toISOString()},bytes=Buffer.from(JSON.stringify(manifest));
 const key='s7-logo/scheduler-backups/v1/snapshots/'+stamp+'/manifest.json';
 await remote.put(key,bytes,{timeout:120000,headers:{'Content-Type':'application/json'}});
 if(!same(await remoteDigest(remote,key),{sha256:hashOf(bytes),bytes:bytes.length}))throw Error('Snapshot manifest checksum mismatch');
 return {...manifest,manifestKey:key};
}
export async function restoreDataSnapshot({manifest,roots,client=createLogoStorageClients()}){
 if(manifest.version!==2||!Array.isArray(manifest.files))throw Error('Unsupported data snapshot');
 const remote=await client(true),seen=new Set();
 for(const entry of manifest.files){
  validEntry(entry);if(!Object.hasOwn(roots,entry.root))throw Error('Missing restore root');
  const key=entry.root+'/'+entry.path;if(seen.has(key))throw Error('Duplicate snapshot path');seen.add(key);
 }
 for(const directory of manifest.directories||[]){
  validEntry({...directory,path:directory.path||'root',sha256:'0'.repeat(64),bytes:0,key:prefix+'0'.repeat(64)});
  if(!Object.hasOwn(roots,directory.root))throw Error('Missing restore root');
 }
 for(const root of Object.values(roots)){
  if(!isAbsolute(root))throw Error('Restore root must be absolute');
  const parent=dirname(root),details=await lstat(parent);
  if(process.platform!=='win32'&&(details.uid!==process.getuid()||details.mode&0o022))throw Error('Restore parent must be private');
  for(let path=parent;;path=dirname(path)){if((await lstat(path)).isSymbolicLink())throw Error('Restore path cannot follow symbolic links');if(dirname(path)===path)break;}
  await mkdir(root,{mode:0o700});
 }
 for(const entry of manifest.files){
  const file=join(roots[entry.root],entry.path),pending=file+'.pending';await mkdir(dirname(file),{recursive:true,mode:0o700});
  const hash=createHash('sha256');let bytes=0;
  try{
   await pipeline((await remote.getStream(entry.key,{timeout:120000})).stream,new Transform({transform(chunk,encoding,done){hash.update(chunk);bytes+=chunk.length;done(null,chunk);}}),createWriteStream(pending,{flags:'wx',mode:0o600}));
   if(!same({sha256:hash.digest('hex'),bytes},entry))throw Error('Restored file checksum mismatch');
   const handle=await open(pending,'r+');try{await handle.sync();}finally{await handle.close();}await rename(pending,file);
   if(process.platform!=='win32'){await chown(file,entry.uid,entry.gid);await chmod(file,entry.mode);}
  }catch(error){await rm(pending,{force:true});throw error;}
 }
 await verifyPlans(remote,manifest.files,manifest.planHashes||[]);
 for(const directory of [...(manifest.directories||[])].sort((a,b)=>b.path.length-a.path.length)){
  if(directory.path)validEntry({...directory,sha256:'0'.repeat(64),bytes:0,key:prefix+'0'.repeat(64)});
  if(!roots[directory.root])throw Error('Missing restore root');
  const path=join(roots[directory.root],directory.path);await mkdir(path,{recursive:true,mode:0o700});
  if(process.platform!=='win32'){await chown(path,directory.uid,directory.gid);await chmod(path,directory.mode);}
 }
 return {files:manifest.files.length,verified:true};
}
