import {mkdir,readdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const fail=(message,status)=>{throw Object.assign(Error(message),{status});};
const safe=value=>{if(typeof value!=='string'||! /^[a-zA-Z0-9_-]{1,80}$/.test(value))fail('文件不存在',404);return value;};
export async function authenticateWorkspace(req){
 const base=process.env.S7_WORKSPACE_URL||'http://127.0.0.1:3210';
 const response=await fetch(base+'/api/auth/session',{headers:{cookie:req.headers.cookie||''},signal:AbortSignal.timeout(5000)});
 if(!response.ok)fail(response.status===401?'请先在主工作空间登录':'工作空间认证暂不可用',response.status===401?401:503);
 return response.json();
}
export function userSpace(root){
 const directory=user=>join(root,safe(user.id));
 async function save(user,{kind,model,images}){
  const parent=directory(user),id=randomUUID(),pending=join(parent,'.'+id),target=join(parent,id);await mkdir(pending,{recursive:true});
  try{const entries=[];for(let i=0;i<images.length;i++){const image=images[i],name=`image-${i}.png`;await writeFile(join(pending,name),image.bytes,{flag:'wx'});entries.push({name,label:image.label,url:`/api/my-space/image/${id}/${name}`});}
   const record={id,kind,model:model||null,createdAt:new Date().toISOString(),images:entries};await writeFile(join(pending,'record.json'),JSON.stringify(record),{flag:'wx'});await rename(pending,target);return record;
  }catch(error){await rm(pending,{recursive:true,force:true});throw error;}
 }
 async function history(user){let names;try{names=await readdir(directory(user));}catch(e){if(e.code==='ENOENT')return [];throw e;}const records=[];for(const name of names){if(!/^[a-f0-9-]{36}$/.test(name))continue;records.push(JSON.parse(await readFile(join(directory(user),name,'record.json'),'utf8')));}return records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 async function image(user,id,name){safe(id);if(!/^image-\d+\.png$/.test(name))fail('文件不存在',404);try{return await readFile(join(directory(user),id,name));}catch(e){if(e.code==='ENOENT')fail('文件不存在',404);throw e;}}
 return {save,history,image};
}
