import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {generationVersions as versions,selectGenerationVersions} from './generation-versions.mjs';
import {createSchemes} from './schemes.mjs';
import {masterTargetsFromTemplate} from './product-master.mjs';
import {renderLogoSet} from './index.mjs';
import {pickAspectRatio} from './ai-mockup-generation.mjs';

const key=(id,version)=>`${id}:${version}`;
const dataUrl=bytes=>`data:image/png;base64,${bytes.toString('base64')}`;
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};

export function createMultiProductJobs(spaces,{productTemplate,productImage,mockupRenderer}){
 const active=new Map(),taskKey=(user,id)=>`${user.id}:${id}`;
 async function read(user,taskId){
  let record=await spaces.generation(user,taskId);
  if(!record||(!['multi-product','multi-logo'].includes(record.kind)&&record.status!=='running')){
   const task=await spaces.task(user,taskId),products=task.state?.multiPackageProducts;
   if(!Array.isArray(products)||products.length<2)return record;
   const history=(await spaces.history(user,taskId)).filter(entry=>entry.kind==='多包材印刷效果'&&(!record||entry.createdAt>record.createdAt)),outputs=[];
   for(const entry of history)for(const image of entry.images){
    const product=products.find(product=>versions.some(version=>image.label===`${product.sku} · ${version}`));
    const version=product&&versions.find(version=>image.label===`${product.sku} · ${version}`);
    if(product&&version&&!outputs.some(output=>output.productId===product.id&&output.version===version))outputs.push({productId:product.id,version,dataUrl:image.url});
   }
   if(!outputs.length)return record;
   const stamp=history[0].createdAt,oldId=record?.id;
   record=await spaces.updateGeneration(user,taskId,current=>current&&(current.id!==oldId||['multi-product','multi-logo'].includes(current.kind)||current.status==='running')?current:({id:randomUUID(),kind:'multi-product',status:outputs.length===products.length*4?'complete':'partial',createdAt:stamp,updatedAt:stamp,products,outputs,remoteTasks:{},stages:Object.fromEntries(products.flatMap(product=>versions.map(version=>[key(product.id,version),outputs.some(o=>o.productId===product.id&&o.version===version)?{stage:'complete'}:{stage:'failed',error:'尚未生成'}])))}));
  }
  if(record.kind==='multi-product'&&record.status==='running'&&active.get(taskKey(user,taskId))!==record.id)return spaces.updateGeneration(user,taskId,current=>current.id!==record.id||current.status!=='running'||active.get(taskKey(user,taskId))===current.id?current:{...current,status:'interrupted',stages:Object.fromEntries(Object.entries(current.stages).map(([id,value])=>[id,value.stage==='complete'?value:{stage:'failed',error:'服务重启导致生成中断，请重试未完成图片'}]))});
  return record;
 }
 async function start(user,taskId,input,products,req){
  if((await spaces.task(user,taskId)).state?.mode==='multi-logo')fail('请使用多 Logo 上样的独立生成入口');
  const previous=await read(user,taskId),activeKey=taskKey(user,taskId);
  if(previous?.status==='running'||active.has(activeKey))fail('当前任务正在生成，请等待完成',409);
  const selected=selectGenerationVersions(input);
  if(input.onlyProductId&&(!products.some(product=>String(product.id)===input.onlyProductId)||previous?.kind!=='multi-product'))fail('请先生成所选产品的效果图');
  if(selected.some(version=>!versions.includes(version)))fail('生成版本无效');
  const logo=Buffer.from(input.logoImage,'base64'),logoMeta=await sharp(logo).metadata(),prepared=[];
  for(const product of products){
   const edited=input.productLayouts?.find(layout=>layout.productId===String(product.id));
   const master=edited?null:await productTemplate(product,req);
   if(master?.needsTemplateReview)fail('产品标准图已修改，请先重新确认并发布母版');
   const targets=edited?.targets||masterTargetsFromTemplate(master?.template);
   if(!Array.isArray(targets)||!targets.length)fail(`${product.sku} 尚无有效的产品 Logo 区域`);
   const schemes=edited?.schemes||createSchemes(targets).schemes;
   if(!Array.isArray(schemes))fail(`${product.sku} 的效果方案无效`);
   const source=edited?.baseAssetUrl?await spaces.taskAssetFromUrl(user,taskId,edited.baseAssetUrl):await productImage(product,req),base=await sharp(source.bytes).png().toBuffer();
   prepared.push({product:{id:String(product.id),sku:String(product.sku||''),name:String(product.name||'')},base,targets,schemes,schemeSignatures:edited?.schemeSignatures||{}});
  }
  if(active.has(activeKey))fail('当前任务正在生成，请等待完成',409);
  const id=randomUUID();active.set(activeKey,id);
  let job;
  try{job=await spaces.updateGeneration(user,taskId,current=>{
   if(current?.status==='running')fail('当前任务正在生成，请等待完成',409);
   const stamp=new Date().toISOString();return {id,kind:'multi-product',status:'running',createdAt:stamp,updatedAt:stamp,model:input.model,products:prepared.map(item=>item.product),
    outputs:current?.kind==='multi-product'?(current.outputs||[]).filter(output=>products.some(product=>String(product.id)===output.productId)):[],remoteTasks:current?.kind==='multi-product'?current.remoteTasks||{}:{},
    stages:{...(input.onlyProductId?current.stages:{}),...Object.fromEntries(prepared.filter(({product})=>!input.onlyProductId||product.id===input.onlyProductId).flatMap(({product})=>selected.map(version=>[key(product.id,version),{stage:'queued'}])))}};
  });}catch(error){if(active.get(activeKey)===id)active.delete(activeKey);throw error;}
  const update=change=>spaces.updateGeneration(user,taskId,current=>current.id!==id?current:{...change(current),updatedAt:new Date().toISOString()});
  void (async()=>{
   try{
    for(const {product,base,targets,schemes,schemeSignatures} of prepared){
     if(input.onlyProductId&&product.id!==input.onlyProductId)continue;
     const onStage=(version,stage,error)=>update(current=>({...current,stages:{...current.stages,[key(product.id,version)]:{stage,error:error?.message}}}));
     const onOutput=async output=>{
      if(!selected.includes(output.version))fail('成图版本与请求不一致');
      const saved=await spaces.save(user,{taskId,kind:'多包材印刷效果',model:input.model,images:[{label:`${product.sku} · ${output.version}`,bytes:output.bytes}]});
      await update(current=>{const remoteTasks={...current.remoteTasks};delete remoteTasks[key(product.id,output.version)];return {...current,remoteTasks,
       outputs:[...current.outputs.filter(item=>item.productId!==product.id||item.version!==output.version),{productId:product.id,version:output.version,dataUrl:saved.images[0].url,...(schemeSignatures[output.version]?{schemeSignature:schemeSignatures[output.version]}:{})}],
       stages:{...current.stages,[key(product.id,output.version)]:{stage:'complete'}}};});
     };
     try{
      const guides=await renderLogoSet({baseImage:base,logoImage:logo,targets,schemes,originalColor:input.originalColor||'#000000'}),current=await spaces.generation(user,taskId);
      const outputs=await mockupRenderer({baseImage:dataUrl(base),logoImage:dataUrl(logo),model:input.model,targets,schemes,originalColor:input.originalColor||'#000000',selectedVersions:selected,
       finishReferenceImage:input.finishReferenceImage?`data:image/png;base64,${input.finishReferenceImage}`:undefined,size:pickAspectRatio(guides.width,guides.height),logoAspectRatio:logoMeta.height/logoMeta.width,
       maskImage:dataUrl(guides.mask),guides:guides.outputs.map(output=>({version:output.version,dataUrl:dataUrl(output.bytes),maskDataUrl:dataUrl(output.mask),foilMaskDataUrl:dataUrl(output.foilMask),goldMaskDataUrl:dataUrl(output.goldMask)})),onStage,onOutput,
       resumeTasks:Object.fromEntries(selected.map(version=>[version,current.remoteTasks[key(product.id,version)]])),
       onCheckpoint:(version,checkpoint)=>update(record=>{const remoteTasks={...record.remoteTasks};if(checkpoint)remoteTasks[key(product.id,version)]=checkpoint;else delete remoteTasks[key(product.id,version)];return {...record,remoteTasks};})});
      for(const output of outputs)if((await spaces.generation(user,taskId)).stages[key(product.id,output.version)]?.stage!=='complete')await onOutput(output);
      for(const version of selected)if(!['complete','failed'].includes((await spaces.generation(user,taskId)).stages[key(product.id,version)].stage))await onStage(version,'failed',Error('未返回图片，请重试'));
     }catch(error){for(const version of selected)if((await spaces.generation(user,taskId)).stages[key(product.id,version)]?.stage!=='complete')await onStage(version,'failed',error);}
    }
    await update(current=>({...current,status:Object.values(current.stages).every(value=>value.stage==='complete')?'complete':current.outputs.length?'partial':'failed'}));
   }catch(error){await update(current=>({...current,status:'failed',stages:Object.fromEntries(Object.entries(current.stages).map(([id,value])=>[id,value.stage==='complete'?value:{stage:'failed',error:error.message||'生成失败'}]))})).catch(error=>console.error('批量生成状态保存失败',error));}
   finally{if(active.get(activeKey)===id)active.delete(activeKey);}
  })();
  return job;
 }
 return {read,start};
}
