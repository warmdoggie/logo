import {randomUUID} from 'node:crypto';
import {generationVersions as versions,selectGenerationVersions} from './generation-versions.mjs';

export function createGenerationJobs(spaces){
 const active=new Map(),key=(user,taskId)=>`${user.id}:${taskId}`;
 async function read(user,taskId){
  const record=await spaces.generation(user,taskId);
  if(['multi-logo','multi-product'].includes(record?.kind))return record;
  if(record?.status==='running'&&active.get(key(user,taskId))!==record.id)return spaces.updateGeneration(user,taskId,current=>current.kind==='multi-logo'||current.id!==record.id||current.status!=='running'||active.get(key(user,taskId))===current.id?current:({...current,status:'interrupted',stages:Object.fromEntries(Object.entries(current.stages).map(([version,value])=>[version,value.stage==='complete'?value:{stage:'failed',error:'服务重启导致生成中断，请重试'}]))}));
  return record;
 }
 async function start(user,taskId,metadata,run){
  await read(user,taskId);
  const selected=selectGenerationVersions(metadata);
  if(selected.some(version=>!versions.includes(version)))throw Object.assign(Error('生成版本无效'),{status:400});
  const legacyOutputs=[];
  if(metadata.onlyVersion||metadata.preserveResults)for(const entry of await spaces.history(user,taskId))for(const image of entry.images)if(versions.includes(image.label)&&!legacyOutputs.some(output=>output.version===image.label))legacyOutputs.push({version:image.label,dataUrl:image.url});
  const record=await spaces.updateGeneration(user,taskId,previous=>{
   if(previous?.status==='running')throw Object.assign(Error('当前任务正在生成，请等待完成'),{status:409});
   const stamp=new Date().toISOString();return {...metadata,id:randomUUID(),status:'running',createdAt:stamp,updatedAt:stamp,remoteTasks:previous?.remoteTasks||{},
    outputs:metadata.onlyVersion||metadata.preserveResults?(previous?.outputs||legacyOutputs):[],
    stages:{...((metadata.onlyVersion||metadata.preserveResults)?(previous?.stages||Object.fromEntries(versions.map(version=>[version,legacyOutputs.some(output=>output.version===version)?{stage:'complete'}:{stage:'failed',error:'尚未生成，请重试'}]))):{}),...Object.fromEntries(selected.map(version=>[version,{stage:'submitting'}]))}};
  });
  const activeKey=key(user,taskId);active.set(activeKey,record.id);
  const update=change=>spaces.updateGeneration(user,taskId,current=>{if(current.id!==record.id)return current;return {...change(current),updatedAt:new Date().toISOString()};});
  const onStage=(version,stage,error)=>update(current=>({...current,stages:{...current.stages,[version]:{stage,error:error?.message,...(error?.diagnostic?{diagnostic:error.diagnostic}:{})}}}));
  const onCheckpoint=(version,checkpoint)=>update(current=>{const remoteTasks={...current.remoteTasks};if(checkpoint)remoteTasks[version]=checkpoint;else delete remoteTasks[version];return {...current,remoteTasks};});
  const onOutput=async output=>{
   const saved=await spaces.save(user,{taskId,kind:'AI上样',model:metadata.model,images:[{label:output.version,bytes:output.bytes}]});
   await update(current=>{const remoteTasks={...current.remoteTasks};delete remoteTasks[output.version];return {...current,remoteTasks,outputs:[...current.outputs.filter(item=>item.version!==output.version),{version:output.version,dataUrl:saved.images[0].url,...(metadata.schemeSignatures?.[output.version]?{schemeSignature:metadata.schemeSignatures[output.version]}:{})}],stages:{...current.stages,[output.version]:{stage:'complete'}}};});
  };
  void (async()=>{
   try{
    const outputs=await run({onStage,onOutput,onCheckpoint,resumeTasks:record.remoteTasks});
    for(const output of outputs)if((await spaces.generation(user,taskId)).stages[output.version]?.stage!=='complete')await onOutput(output);
    await update(current=>({...current,status:'complete',stages:Object.fromEntries(Object.entries(current.stages).map(([version,value])=>[version,['complete','failed'].includes(value.stage)?value:{stage:'failed',error:'未返回图片，请重试'}]))}));
   }catch(error){await update(current=>({...current,status:'failed',stages:Object.fromEntries(Object.entries(current.stages).map(([version,value])=>[version,value.stage==='complete'?value:{stage:'failed',error:error.message||'生成失败'}]))})).catch(error=>console.error('S7 生成状态保存失败',error));}
   finally{if(active.get(activeKey)===record.id)active.delete(activeKey);}
  })();
  return record;
 }
 return {read,start};
}
