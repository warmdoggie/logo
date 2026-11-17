import {constants} from 'node:fs';
import {lstat,readdir,realpath,open,readFile,rename,rm} from 'node:fs/promises';
import {join,dirname,resolve,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {writePlan} from './plans.mjs';

const decompress=promisify(gunzip);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.mode].join(':');
async function saveReceipt(path,value){
 const pending=path+'.'+randomUUID();
 try{
  const handle=await open(pending,'wx',0o600);try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}
  await rename(pending,path);
  if(process.platform!=='win32'){const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}}
 }finally{await rm(pending,{force:true});}
}
export async function migratePlans({directory,archives,mode='inventory',storage,receiptFile}){
 if(!['inventory','publish','evict'].includes(mode))throw Error('Invalid plan maintenance mode');
 const files=[];
 async function walk(path,compressed){
  const details=await lstat(path);if(details.isSymbolicLink())throw Error('Plan migration cannot follow symbolic links');
  if(details.isDirectory()){for(const name of (await readdir(path)).sort())await walk(join(path,name),compressed);return;}
  if(!details.isFile())throw Error('Unsupported plan migration source');
  const match=(compressed?/^([a-f0-9]{64})\.json\.gz$/:/^([a-f0-9]{64})\.json$/).exec(basename(path));
  if(match)files.push({path,hash:match[1],compressed,bytes:details.size,identity:identity(details)});
 }
 for(const [path,compressed] of [[join(directory,'plans'),false],[archives,true]]){
  if(await realpath(path)!==resolve(path))throw Error('Plan migration root must be a real directory');
  await walk(path,compressed);
 }
 const groups=Map.groupBy(files,file=>file.hash),report={mode,plans:groups.size,files:files.length,sourceBytes:files.reduce((sum,file)=>sum+file.bytes,0),evicted:0,freedBytes:0};
 if(mode==='inventory')return report;
 if(!storage||!receiptFile)throw Error('Plan migration requires cloud storage and a durable receipt');
 let receipt;try{receipt=JSON.parse(await readFile(receiptFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;receipt={version:1,plans:{}};}
 if(receipt.version!==1||!receipt.plans||typeof receipt.plans!=='object')throw Error('Invalid plan migration receipt');
 for(const [hash,sources] of groups){
  let original;
  for(const source of sources){
   const handle=await open(source.path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
   try{
    if(identity(await handle.stat())!==source.identity)throw Error('Plan source changed during migration');
    const bytes=await handle.readFile(),raw=source.compressed?await decompress(bytes,{maxOutputLength:512*1024*1024}):bytes;
    if(digest(raw)!==hash)throw Error('Image plan checksum mismatch');
    if(identity(await handle.stat())!==source.identity)throw Error('Plan source changed during migration');
    original??=raw;
   }finally{await handle.close();}
  }
  const verified=mode==='publish'?await storage.publish(hash,original):await storage.verify(hash);
  for(const source of sources)if(identity(await lstat(source.path))!==source.identity)throw Error('Plan source changed during migration');
  receipt.plans[hash]={...verified,verifiedAt:new Date().toISOString(),files:sources.map(({path,bytes,compressed})=>({path,bytes,compressed}))};
  await saveReceipt(receiptFile,receipt);
  if(mode==='evict')for(const source of sources){
   if(await realpath(source.path)!==resolve(source.path))throw Error('Plan source path changed during migration');
   if(identity(await lstat(source.path))!==source.identity)throw Error('Plan source changed during migration');
   await rm(source.path);report.evicted++;report.freedBytes+=source.bytes;
  }
 }
 return report;
}
export async function restorePlans({directory,hashes,storage}){
 let restored=0;
 for(const hash of new Set(hashes)){
  if(!/^[a-f0-9]{64}$/.test(hash||''))throw Error('Invalid plan hash');
  const bytes=await storage.read(hash);if(digest(bytes)!==hash)throw Error('Image plan checksum mismatch');
  await writePlan(directory,bytes,{storage:null});restored++;
 }
 return {restored};
}
