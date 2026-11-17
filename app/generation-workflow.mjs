const fail=(m,s=400)=>{throw Object.assign(Error(m),{status:s});};
export function generationWorkflow(automatic,transparent,enhancement){
 const busy=new Set();
 async function generate(id,input,actor){if(enhancement?.isBusy(id)||busy.has(id)||automatic.isBusy(id)||transparent.isBusy(id))fail('此任务正在处理，请等待完成',409);const initial=automatic.page(id);if(!input||!Array.isArray(input.taskProductIds)||!input.taskProductIds.length||input.taskProductIds.length>20||input.taskProductIds.some(k=>!initial.items.some(i=>i.id===k)))fail('请选择本任务中的有效产品');if((initial.requirements.current?.version||0)!==input.requirementVersion||initial.targetOptions.version!==input.targetVersion)fail('任务要求或摆放已变化，请刷新',409);busy.add(id);try{
  // Persist explicit customer choices before any rendering, never infer them from prose.
  const draftMode=Number.isInteger(input.draftVersion),saved=draftMode?automatic.saveDraft(id,{...input.requirements,baseDraftRevision:input.draftVersion},actor):automatic.ensureRequirements(id,input.requirements,actor),version=draftMode?input.requirementVersion:saved.current.version;
  let logo=transparent.page(id);if(!logo.activeProductionLogoId){const source=logo.sources[0];if(!source)fail('缺少客户 Logo，请先上传');logo=await transparent.prepare(id,{sourceId:source.id});const master=logo.masters.find(m=>m.sourceId===source.id);if(master?.status!=='READY')fail(master?.status==='REVIEW_REQUIRED'?'Logo 背景处理需要设计师复核，已保存处理结果；请设计师完成后重试。':('Logo 需要设计师处理：'+(master?.details.reason||'无法可靠识别图形')));await transparent.activate(id,{masterId:master.id,expectedActiveProductionLogoId:null},actor);}
  if(draftMode)await automatic.generateDraft(id,{taskProductIds:input.taskProductIds,targetVersion:input.targetVersion,requirementVersion:version,draftRevision:saved.revision},actor);
  else await automatic.generate(id,{taskProductIds:input.taskProductIds,processType:'AUTO',targetVersion:input.targetVersion,requirementVersion:version},actor);
  const result=automatic.page(id);
  if(enhancement){result.enhancement={...enhancement.page(id),message:'二维预览已保存'};if(enhancement.config().enabled){const accepted=new Set((result.runs[0]?.report||[]).filter(r=>r.outputId).map(r=>r.outputId));const outputIds=result.latestOutputs.filter(o=>accepted.has(o.id)&&o.currentStatus!=='NEEDS_UPDATE').map(o=>o.id);if(outputIds.length)try{result.enhancement=await enhancement.create(id,{outputIds});}catch{result.enhancement.message='二维图已保存，增强前检查未通过，请刷新并联系设计师';}}}
  return result;
 }finally{busy.delete(id);}}
 return {generate,isBusy:id=>busy.has(id)};
}
