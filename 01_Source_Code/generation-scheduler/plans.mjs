import {readFile,mkdir,open,rename,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

export const appModule=name=>new URL(name,pathToFileURL((process.env.APP_CODE_DIRECTORY||fileURLToPath(new URL('../',import.meta.url)))+'/'));
let cloud;
async function storageFor(storage){
 if(storage!==undefined)return storage;
 if(!process.env.LOGO_OSS_STORAGE_ROLE_ARN)return null;
 cloud??=import(appModule('logo-plan-storage.mjs')).then(module=>module.createPlanStorage());return cloud;
}
export async function removePlan(directory,hash,{storage}={}){
 if(!/^[a-f0-9]{64}$/.test(hash||''))throw Error('Invalid plan hash');
 const remote=await storageFor(storage);if(remote)await remote.remove(hash);
 await rm(join(directory,'plans',hash+'.json'),{force:true});
}
export async function readPlan(directory,hash,{storage}={}){
 try{
  if(!/^[a-f0-9]{64}$/.test(hash||''))throw Error('Invalid plan hash');
  let bytes;
  try{bytes=await readFile(join(directory,'plans',hash+'.json'));}
  catch(error){if(error.code!=='ENOENT')throw error;const remote=await storageFor(storage);if(!remote)throw error;bytes=await remote.read(hash);}
  if(createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('Image plan checksum mismatch');return JSON.parse(bytes);
 }catch(error){error.planUnavailable=true;throw error;}
}
export async function writePlan(directory,bytes,{storage}={}){
 const hash=createHash('sha256').update(bytes).digest('hex'),remote=await storageFor(storage);
 if(remote){await remote.publish(hash,bytes);return hash;}
 const folder=join(directory,'plans');await mkdir(folder,{recursive:true,mode:0o700});
 const path=join(folder,hash+'.json'),temporary=path+'.'+randomUUID();
 try{
  const file=await open(temporary,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  await rename(temporary,path);
  if(process.platform!=='win32'){const parent=await open(folder,'r');try{await parent.sync();}finally{await parent.close();}}
 }finally{await rm(temporary,{force:true});}
 return hash;
}
