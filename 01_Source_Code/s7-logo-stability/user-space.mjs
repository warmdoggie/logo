import {mkdir,readdir,readFile,writeFile,rename,rm,stat} from 'node:fs/promises';
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
 const taskFile=(user,id)=>join(directory(user),'tasks',safe(id),'task.json');
 const updates=new Map();
 async function serialized(file,operation){const previous=updates.get(file)||Promise.resolve(),current=previous.catch(()=>{}).then(operation);updates.set(file,current);try{return await current;}finally{if(updates.get(file)===current)updates.delete(file);}}
 async function task(user,id){try{return JSON.parse(await readFile(taskFile(user,id),'utf8'));}catch(e){if(e.code==='ENOENT')fail('任务不存在',404);throw e;}}
 async function ensureTask(user,id){try{await stat(taskFile(user,id));}catch(e){if(e.code==='ENOENT')fail('任务不存在',404);throw e;}}
 const summary=({state,...record})=>({...record,...(state?.mode?{mode:state.mode}:{})});
 async function taskSummary(user,id){await ensureTask(user,id);try{return JSON.parse(await readFile(join(taskFile(user,id),'..','summary.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return summary(await task(user,id));throw e;}}
 async function writeSummary(file,record){const path=join(file,'..','summary.json'),temporary=path+'.'+randomUUID();try{await writeFile(temporary,JSON.stringify(summary(record)),{flag:'wx'});await rename(temporary,path);}finally{await rm(temporary,{force:true});}}
 function title(value){if(typeof value!=='string'||!value.trim()||value.trim().length>80)fail('任务名称需为 1–80 个字',400);return value.trim();}
 async function createTask(user,input){const stamp=new Date().toISOString(),record={id:randomUUID(),title:title(input.title),createdAt:stamp,updatedAt:stamp,revision:0,state:{}};const file=taskFile(user,record.id);await mkdir(join(file,'..'),{recursive:true});await writeFile(file,JSON.stringify(record),{flag:'wx'});await writeSummary(file,record);return record;}
 async function tasks(user){let names;try{names=await readdir(join(directory(user),'tasks'));}catch(e){if(e.code==='ENOENT')return [];throw e;}const list=await Promise.all(names.map(async id=>{try{return await taskSummary(user,id);}catch(e){if(e.status===404)return null;throw e;}}));return list.filter(Boolean).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
 async function updateTask(user,id,input){
  const file=taskFile(user,id);return serialized(file,async()=>{
   const record=await task(user,id);if(input.revision!==record.revision)fail('任务已在其他页面更新，请刷新后继续',409);
   if(input.state!==undefined){if(!input.state||typeof input.state!=='object'||Array.isArray(input.state))fail('任务草稿格式不正确',400);record.state=input.mergeState?{...record.state,...input.state}:input.state;for(const key of ['base','logo'])if(record.state[key+'Data']&&record.state[key+'DataUrl']===`data:image/png;base64,${record.state[key+'Data']}`)delete record.state[key+'DataUrl'];}
   if(input.title!==undefined)record.title=title(input.title);
   if(input.state!==undefined)record.revision++;record.updatedAt=new Date().toISOString();const temporary=file+'.'+randomUUID();
   try{await writeFile(temporary,JSON.stringify(record),{flag:'wx'});await rename(temporary,file);await writeSummary(file,record);}catch(e){await rm(temporary,{force:true});throw e;}return input.summary?summary(record):record;
  });
 }
 async function deleteTask(user,id){
  const file=taskFile(user,id),folder=join(directory(user),'tasks',safe(id));return serialized(file,async()=>{
   if((await readGeneration(user,id))?.status==='running')fail('任务正在生成，请完成后再删除',409);
   await task(user,id);let names;try{names=await readdir(directory(user));}catch(e){if(e.code==='ENOENT')names=[];else throw e;}
   for(const name of names){if(!/^[a-f0-9-]{36}$/.test(name))continue;const recordFile=join(directory(user),name,'record.json');let record;try{record=JSON.parse(await readFile(recordFile,'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}if(record.taskId===id)await rm(join(directory(user),name),{recursive:true,force:true});}
   await rm(folder,{recursive:true,force:true});
  });
 }
 async function save(user,{taskId,kind,model,images}){
  const persist=async()=>{
  if(taskId)await ensureTask(user,taskId);
  const parent=directory(user),id=randomUUID(),pending=join(parent,'.'+id),target=join(parent,id);await mkdir(pending,{recursive:true});
  try{const entries=[];for(let i=0;i<images.length;i++){const image=images[i],name=`image-${i}.png`;await writeFile(join(pending,name),image.bytes,{flag:'wx'});entries.push({name,label:image.label,url:taskId?`/api/my-space/tasks/${taskId}/image/${id}/${name}`:`/api/my-space/image/${id}/${name}`});}
   const record={id,taskId:taskId||null,kind,model:model||null,createdAt:new Date().toISOString(),images:entries};await writeFile(join(pending,'record.json'),JSON.stringify(record),{flag:'wx'});await rename(pending,target);return record;
  }catch(error){await rm(pending,{recursive:true,force:true});throw error;}
  };
  return taskId?serialized(taskFile(user,taskId),persist):persist();
 }
 async function history(user,taskId){if(taskId)await ensureTask(user,taskId);let names;try{names=await readdir(directory(user));}catch(e){if(e.code==='ENOENT')return [];throw e;}const records=[];for(const name of names){if(!/^[a-f0-9-]{36}$/.test(name))continue;let record;try{record=JSON.parse(await readFile(join(directory(user),name,'record.json'),'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}if((record.taskId||null)===(taskId||null))records.push(record);}return records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 async function image(user,id,name,taskId){safe(id);if(!/^image-\d+\.png$/.test(name))fail('文件不存在',404);if(taskId)await ensureTask(user,taskId);try{const record=JSON.parse(await readFile(join(directory(user),id,'record.json'),'utf8'));if((record.taskId||null)!==(taskId||null))fail('文件不存在',404);return await readFile(join(directory(user),id,name));}catch(e){if(e.code==='ENOENT')fail('文件不存在',404);throw e;}}
 async function readGeneration(user,id){await ensureTask(user,id);try{return JSON.parse(await readFile(join(taskFile(user,id),'..','generation.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 function generation(user,id){return serialized(taskFile(user,id),()=>readGeneration(user,id));}
 async function updateGeneration(user,id,change){return serialized(taskFile(user,id),async()=>{
  const record=await change(await readGeneration(user,id)),file=join(taskFile(user,id),'..','generation.json'),temporary=file+'.'+randomUUID();
  try{await writeFile(temporary,JSON.stringify(record),{flag:'wx'});await rename(temporary,file);}catch(e){await rm(temporary,{force:true});throw e;}return record;
 });}
 return {save,history,image,task,taskSummary,tasks,createTask,updateTask,deleteTask,generation,updateGeneration};
}
