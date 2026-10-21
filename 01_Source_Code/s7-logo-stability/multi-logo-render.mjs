import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {generationVersions as versions,selectGenerationVersions} from './generation-versions.mjs';
import {validateAiLogoOutput} from './ai-logo-processing.mjs';
import {createSchemes} from './schemes.mjs';
import {renderLogoSet} from './index.mjs';
import {pickAspectRatio} from './ai-mockup-generation.mjs';

const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const dataUrl=bytes=>`data:image/png;base64,${bytes.toString('base64')}`;
const key=(id,version)=>`${id}:${version}`;

// Runs multi-logo batches from both ordinary tasks and saved legacy tasks.
export function createMultiLogoJobs(spaces,mockupRenderer){
 const active=new Map(),taskKey=(user,id)=>`${user.id}:${id}`;
 async function read(user,taskId){
  const record=await spaces.generation(user,taskId);
  if(record?.kind==='multi-logo'&&record.status==='running'&&active.get(taskKey(user,taskId))!==record.id){
   return spaces.updateGeneration(user,taskId,current=>current.kind!=='multi-logo'||current.id!==record.id||current.status!=='running'||active.get(taskKey(user,taskId))===current.id?current:{...current,status:'interrupted',stages:Object.fromEntries(Object.entries(current.stages).map(([id,value])=>[id,value.stage==='complete'?value:{stage:'failed',error:'服务重启导致生成中断，请重试未完成图片'}]))});
  }
  return record;
 }
 async function start(user,taskId,input){
  const task=await spaces.task(user,taskId);
  if(task.state?.multiPackageProducts?.length>1)fail('多个 Logo 只能搭配一个产品');
  const previous=await read(user,taskId);
  if(previous?.status==='running')fail('当前任务正在生成，请等待完成',409);
  if(!Array.isArray(input.logos)||input.logos.length<2||input.logos.length>20)fail('请选择 2–20 个 Logo');
  if(input.logos.some(logo=>!logo||typeof logo.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(logo.id)||typeof logo.name!=='string'||!logo.name.trim()||logo.name.length>120||typeof logo.logoImage!=='string')||new Set(input.logos.map(logo=>logo.id)).size!==input.logos.length)fail('Logo 名称或标识无效，且标识不能重复');
  const layouts=input.logoLayouts??[];
  if(!Array.isArray(layouts)||new Set(layouts.map(layout=>layout?.logoId)).size!==layouts.length||layouts.some(layout=>!layout||!input.logos.some(logo=>logo.id===layout.logoId)||!Array.isArray(layout.targets)||!layout.targets.length||!Array.isArray(layout.schemes)||layout.schemes.length!==versions.length||versions.some(version=>layout.schemes.filter(scheme=>scheme?.version===version&&Array.isArray(scheme.targets)&&scheme.targets.length).length!==1)))fail('Logo 方案与所选素材不匹配');
  if(input.onlyLogoId&&(!input.logos.some(logo=>logo.id===input.onlyLogoId)||previous?.kind!=='multi-logo'||previous.product.id!==input.product.id))fail('请先生成所选 Logo 的效果图');
  const requested=input.onlyLogoId?selectGenerationVersions(input):versions;
  if(typeof input.model!=='string'||!input.model.trim())fail('请选择成图模型');
  if(!Array.isArray(input.targets)||!input.targets.length)fail('产品尚无有效的 Logo 区域，请先发布产品母版');
  const targets=input.targets.map(target=>({...target,preserveOriginalColor:target.preserveOriginalColor??!target.color,autoContrast:target.autoContrast!==false}));
  const basePng=await sharp(input.baseImage).png().toBuffer(),schemes=createSchemes(targets).schemes;
  const logos=[];
  // Validate all assets before any paid model request is submitted.
  for(const logo of input.logos){
   const layout=layouts.find(layout=>layout.logoId===logo.id),logoTargets=layout?.targets||targets,logoSchemes=layout?.schemes||schemes;
   let normalized;
   try{normalized=await validateAiLogoOutput(Buffer.from(logo.logoImage,'base64'));}
   catch(error){fail(`${logo.name}：请上传有可见内容的透明 Logo，或先使用 AI 加工。${error.message}`);}
   const bytes=await sharp(normalized.bytes).png().toBuffer();
   const fingerprint=createHash('sha256').update(basePng).update(bytes).update(JSON.stringify([input.product.id,logoTargets,logoSchemes,input.model])).digest('hex');
   logos.push({id:logo.id,name:logo.name.trim(),bytes,width:normalized.width,height:normalized.height,fingerprint,targets:logoTargets,schemes:logoSchemes,schemeSignatures:layout?.schemeSignatures||{}});
  }
  const retry=input.retryFailed===true;
  if(retry&&(!previous||previous.kind!=='multi-logo'||previous.logos.length!==logos.length||logos.some(logo=>previous.logos.find(old=>old.id===logo.id)?.fingerprint!==logo.fingerprint)))fail('素材、产品或模型已修改，请重新生成全部 Logo',409);
  const selected=new Map(logos.map(logo=>[logo.id,input.onlyLogoId&&logo.id!==input.onlyLogoId?[]:requested.filter(version=>!retry||previous.stages[key(logo.id,version)]?.stage!=='complete')]));
  if(![...selected.values()].some(list=>list.length))fail('所有图片均已完成');
  const job=await spaces.updateGeneration(user,taskId,current=>{
   if(current?.status==='running')fail('当前任务正在生成，请等待完成',409);
   const stamp=new Date().toISOString();
   return {id:randomUUID(),kind:'multi-logo',status:'running',createdAt:stamp,updatedAt:stamp,product:input.product,model:input.model,
    logos:logos.map(({id,name,fingerprint})=>({id,name,fingerprint})),outputs:retry||input.onlyLogoId?current.outputs.filter(output=>logos.some(logo=>logo.id===output.logoId)):[],remoteTasks:retry||input.onlyLogoId?current.remoteTasks||{}:{},
    stages:Object.fromEntries(logos.flatMap(logo=>versions.map(version=>[key(logo.id,version),(retry||input.onlyLogoId)&&!selected.get(logo.id).includes(version)?current.stages[key(logo.id,version)]||{stage:'failed',error:'尚未生成'}:{stage:'queued'}])))};
  });
  const activeKey=taskKey(user,taskId);active.set(activeKey,job.id);
  const update=change=>spaces.updateGeneration(user,taskId,current=>current.id!==job.id?current:{...change(current),updatedAt:new Date().toISOString()});
  void (async()=>{
   try{
    for(const logo of logos){
     const {targets,schemes}=logo;
     const selectedVersions=selected.get(logo.id);if(!selectedVersions.length)continue;
     const onStage=(version,stage,error)=>update(current=>({...current,stages:{...current.stages,[key(logo.id,version)]:{stage,error:error?.message}}}));
     const onOutput=async output=>{
      if(!selectedVersions.includes(output.version))fail('成图版本与请求不一致');
      const saved=await spaces.save(user,{taskId,kind:'多 Logo 印刷效果',model:input.model,images:[{label:`${input.product.sku} · ${logo.name} · ${output.version}`,bytes:output.bytes}]});
      await update(current=>{const remoteTasks={...current.remoteTasks};delete remoteTasks[key(logo.id,output.version)];return {...current,remoteTasks,
       outputs:[...current.outputs.filter(item=>item.logoId!==logo.id||item.version!==output.version),{logoId:logo.id,logoName:logo.name,version:output.version,dataUrl:saved.images[0].url,...(logo.schemeSignatures[output.version]?{schemeSignature:logo.schemeSignatures[output.version]}:{})}],
       stages:{...current.stages,[key(logo.id,output.version)]:{stage:'complete'}}};});
     };
     try{
      const guides=await renderLogoSet({baseImage:basePng,logoImage:logo.bytes,targets,schemes,originalColor:'#000000'});
      const current=await spaces.generation(user,taskId);
      const outputs=await mockupRenderer({baseImage:dataUrl(basePng),logoImage:dataUrl(logo.bytes),model:input.model,targets,schemes,originalColor:'#000000',selectedVersions,
       size:pickAspectRatio(guides.width,guides.height),logoAspectRatio:logo.height/logo.width,maskImage:dataUrl(guides.mask),
       guides:guides.outputs.map(output=>({version:output.version,dataUrl:dataUrl(output.bytes),maskDataUrl:dataUrl(output.mask),foilMaskDataUrl:dataUrl(output.foilMask),goldMaskDataUrl:dataUrl(output.goldMask)})),
       onStage,onOutput,
       resumeTasks:Object.fromEntries(selectedVersions.map(version=>[version,current.remoteTasks[key(logo.id,version)]])),
       onCheckpoint:(version,checkpoint)=>update(record=>{const remoteTasks={...record.remoteTasks};if(checkpoint)remoteTasks[key(logo.id,version)]=checkpoint;else delete remoteTasks[key(logo.id,version)];return {...record,remoteTasks};})
      });
      for(const output of outputs)if((await spaces.generation(user,taskId)).stages[key(logo.id,output.version)]?.stage!=='complete')await onOutput(output);
      for(const version of selectedVersions){const stage=(await spaces.generation(user,taskId)).stages[key(logo.id,version)];if(!['complete','failed'].includes(stage.stage))await onStage(version,'failed',Error('未返回图片，请重试'));}
     }catch(error){for(const version of selectedVersions)if((await spaces.generation(user,taskId)).stages[key(logo.id,version)]?.stage!=='complete')await onStage(version,'failed',error);}
    }
    await update(current=>({...current,status:Object.values(current.stages).every(value=>value.stage==='complete')?'complete':current.outputs.length?'partial':'failed'}));
   }catch(error){await update(current=>({...current,status:'failed',stages:Object.fromEntries(Object.entries(current.stages).map(([id,value])=>[id,value.stage==='complete'?value:{stage:'failed',error:error.message||'生成失败'}]))})).catch(error=>console.error('多 Logo 状态保存失败',error));}
   finally{if(active.get(activeKey)===job.id)active.delete(activeKey);}
  })();
  return job;
 }
 return {read,start};
}
