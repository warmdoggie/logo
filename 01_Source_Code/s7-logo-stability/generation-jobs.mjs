import {randomUUID} from 'node:crypto';
import {generationVersions as versions,selectGenerationVersions} from './generation-versions.mjs';

export function createGenerationJobs(spaces){
 const active=new Map(),key=(user,taskId)=>`${user.id}:${taskId}`;
 async function read(user,taskId){
  const record=await spaces.generation(user,taskId);
  if(record?.status==='running'&&active.get(key(user,taskId))!==record.id)return spaces.updateGeneration(user,taskId,current=>current.status!=='running'||active.get(key(user,taskId))===current.id?current:({...current,status:'interrupted',stages:Object.fromEntries(Object.entries(current.stages).map(([version,value])=>[version,value.stage==='complete'?value:{stage:'failed',error:'服务重启导致生成中断，请重试'}]))}));
  return record;
 }
 async function start(user,taskId,metadata,run){
  await read(user,taskId);
  const selected=selectGenerationVersions(metadata);
  if(selected.some(version=>!versions.includes(version)))throw Object.assign(Error('生成版本无效'),{status:400});
  const legacyOutputs=[];
  if(metadata.onlyVersion)for(const entry of await spaces.history(user,taskId))for(const image of entry.images)if(versions.includes(image.label)&&!legacyOutputs.some(output=>output.version===image.label))legacyOutputs.push({version:image.label,dataUrl:image.url});
  const record=await spaces.updateGeneration(user,taskId,previous=>{
   if(previous?.status==='running')throw Object.assign(Error('当前任务正在生成，请等待完成'),{status:409});
   const stamp=new Date().toISOString();return {...metadata,id:randomUUID(),status:'running',createdAt:stamp,updatedAt:stamp,
    outputs:metadata.onlyVersion?(previous?.outputs||legacyOutputs).filter(output=>output.version!==metadata.onlyVersion):[],
    stages:{...(metadata.onlyVersion?(previous?.stages||Object.fromEntries(versions.map(version=>[version,legacyOutputs.some(output=>output.version===version)?{stage:'complete'}:{stage:'failed',error:'尚未生成，请重试'}]))):{}),...Object.fromEntries(selected.map(version=>[version,{stage:'submitting'}]))}};
  });
  const activeKey=key(user,taskId);active.set(activeKey,record.id);
  const update=change=>spaces.updateGeneration(user,taskId,current=>{if(current.id!==record.id)return current;return {...change(current),updatedAt:new Date().toISOString()};});
  const onStage=(version,stage,error)=>update(current=>({...current,stages:{...current.stages,[version]:{stage,error:error?.message}}}));
  const onOutput=async output=>{
   const saved=await spaces.save(user,{taskId,kind:'AI上样',model:metadata.model,images:[{label:output.version,bytes:output.bytes}]});
   await update(current=>({...current,outputs:[...current.outputs.filter(item=>item.version!==output.version),{version:output.version,dataUrl:saved.images[0].url}],stages:{...current.stages,[output.version]:{stage:'complete'}}}));
  };
  void (async()=>{
   try{
    const outputs=await run({onStage,onOutput});
    for(const output of outputs)if(!(await spaces.generation(user,taskId)).outputs.some(item=>item.version===output.version))await onOutput(output);
    await update(current=>({...current,status:'complete',stages:Object.fromEntries(Object.entries(current.stages).map(([version,value])=>[version,['complete','failed'].includes(value.stage)?value:{stage:'failed',error:'未返回图片，请重试'}]))}));
   }catch(error){await update(current=>({...current,status:'failed',stages:Object.fromEntries(Object.entries(current.stages).map(([version,value])=>[version,value.stage==='complete'?value:{stage:'failed',error:error.message||'生成失败'}]))})).catch(error=>console.error('S7 生成状态保存失败',error));}
   finally{if(active.get(activeKey)===record.id)active.delete(activeKey);}
  })();
  return record;
 }
 return {read,start};
}
