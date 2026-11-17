import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {providerAdapter} from './ai-provider.mjs';
import {automaticBasis,automaticQuality,protectOutput} from './automatic-ai-pixels.mjs';
import {assertActive} from './task-products.mjs';
import {recolorSurfaces} from './surface-colors.mjs';
import {generationInput} from './generation-input.mjs';
import {digest} from './revision-drafts.mjs';
const now=()=>new Date().toISOString(),sha=b=>createHash('sha256').update(b).digest('hex');
const fail=(message,code='STALE_INPUT',status=409)=>{throw Object.assign(Error(message),{code,status});};
const pending=['QUEUED','RENDERING','QA','RETRYING'];
const safeMetadata=v=>({...Object.fromEntries(['calls','cost','tokens','credits'].filter(k=>Number.isFinite(v?.[k])&&v[k]>=0).map(k=>[k,v[k]])),...(typeof v?.providerTaskId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v.providerTaskId)?{providerTaskId:v.providerTaskId}:{}),...(Number.isFinite(v?.progress)?{progress:Math.max(0,Math.min(100,v.progress))}:{})});

export function automaticAIService(db,storage,rules,automatic,dataDir,options={}){
 const adapter=options.provider||providerAdapter(dataDir),queue=[],running=new Set();let workers=0;
 db.exec(`CREATE TABLE IF NOT EXISTS AutomaticAIJob(
 id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES Task(id) ON DELETE CASCADE,
 taskProductId TEXT NOT NULL REFERENCES TaskProduct(id) ON DELETE CASCADE,
 sourceOutputId TEXT NOT NULL REFERENCES AutomaticOutput(id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL UNIQUE,status TEXT NOT NULL,snapshotJson TEXT NOT NULL,
 resultPath TEXT,resultSha TEXT,attemptCount INTEGER NOT NULL DEFAULT 0,
 errorCode TEXT,message TEXT,createdAt TEXT NOT NULL,finishedAt TEXT);
 CREATE TABLE IF NOT EXISTS AutomaticAIAttempt(
 id TEXT PRIMARY KEY,jobId TEXT NOT NULL REFERENCES AutomaticAIJob(id) ON DELETE CASCADE,
 number INTEGER NOT NULL,status TEXT NOT NULL,qaJson TEXT,metadataJson TEXT NOT NULL,
 durationMs INTEGER NOT NULL,createdAt TEXT NOT NULL,UNIQUE(jobId,number));
 CREATE TABLE IF NOT EXISTS AutomaticAIFile(
 id TEXT PRIMARY KEY,jobId TEXT NOT NULL REFERENCES AutomaticAIJob(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,filePath TEXT NOT NULL,sha256 TEXT NOT NULL);`);
 db.prepare(`UPDATE AutomaticAIJob SET status='INTERRUPTED',errorCode='INTERRUPTED',message='服务曾中断，未自动重发接口请求；请先核对服务商记录',finishedAt=? WHERE status IN ('QUEUED','RENDERING','QA','RETRYING')`).run(now());
 function config(){
  let c={};try{c=JSON.parse(readFileSync(join(dataDir,'automatic-ai.local.json'),'utf8').replace(/^\uFEFF/,''));}catch{}
  const p=adapter.status(),mode=c.enabled===true&&['LOCAL_MOCK','PROVIDER'].includes(c.mode)?c.mode:'OFF';
  return {mode,enabled:mode==='LOCAL_MOCK'||mode==='PROVIDER'&&p.configured,provider:mode==='LOCAL_MOCK'?'LOCAL_MOCK':p.provider,model:mode==='LOCAL_MOCK'?'identity-fixture-v1':p.model,configVersion:String(c.configVersion||'1'),providerVersion:String(p.configVersion||'1'),concurrency:Math.max(1,Math.min(2,p.concurrency||1)),maxRetries:Math.max(0,Math.min(2,p.maxRetries??2)),policy:'automatic-flat-mask-v1'};
 }
 const task=id=>{const r=db.prepare('SELECT * FROM Task WHERE id=?').get(id);if(!r)fail('任务不存在','NOT_FOUND',404);return r;};
 const get=id=>{const j=db.prepare('SELECT * FROM AutomaticAIJob WHERE id=?').get(id);if(!j)fail('增强记录不存在','NOT_FOUND',404);return j;};
 const set=(id,status,code=null,message=null)=>db.prepare('UPDATE AutomaticAIJob SET status=?,errorCode=?,message=?,finishedAt=? WHERE id=?').run(status,code,message,pending.includes(status)?null:now(),id);
 function surface(zoneId){const s=db.prepare('SELECT * FROM AISurfaceConfig WHERE templateAreaId=? ORDER BY version DESC LIMIT 1').get(zoneId);return {zoneId,version:s?.version||0,surfaceType:s?.surfaceType||'FLAT',parameters:s?JSON.parse(s.parameters):{}};}
 function context(taskId,outputId){
  const t=task(taskId),o=db.prepare('SELECT o.*,tp.taskId FROM AutomaticOutput o JOIN TaskProduct tp ON tp.id=o.taskProductId WHERE o.id=?').get(outputId);
  if(!o||o.taskId!==taskId)fail('二维来源不属于当前任务','NOT_FOUND',404);assertActive(db,o.taskProductId);
  const page=automatic.page(taskId),current=page.latestOutputs.find(x=>x.id===o.id);
  if(!current||current.currentStatus==='NEEDS_UPDATE')fail('二维来源已不是有效的当前图片，请先重新生成');
  if(page.draft?.data){const generated=db.prepare('SELECT * FROM RevisionGenerationState WHERE taskId=?').get(taskId),key=digest(generationInput(page.draft.data,page.targetOptions.settings,t.activeProductionLogoId,page.items.map(i=>i.id)));if(!generated||generated.inputKey!==key||generated.requirementVersion!==page.requirements.current?.version)fail('有尚未生成的客户要求或摆放修改，请先生成二维图');}
  const s=JSON.parse(o.snapshotJson),tpl=db.prepare('SELECT t.* FROM TaskProductTemplate b JOIN ProductTemplate t ON t.id=b.templateId WHERE b.taskProductId=?').get(o.taskProductId),logo=db.prepare('SELECT * FROM ProductionLogo WHERE id=?').get(s.logoId);
  if(t.activeProductionLogoId!==s.logoId||tpl?.id!==s.templateId||!logo)fail('Logo 或锁定母版已变化');
  const image=storage.get(tpl.standardImage),logoBytes=storage.get(logo.filePath),source=storage.get(o.imagePath);
  if(sha(image)!==s.imageSha||sha(logoBytes)!==s.logoSha||sha(source)!==s.outputSha)fail('来源图片发生变化或损坏');
  if(db.prepare("SELECT lifecycle FROM TaskManagement WHERE taskId=?").get(taskId)?.lifecycle==='ARCHIVED')fail('任务已归档，请恢复后再生成');
  const zones=db.prepare('SELECT * FROM TemplateZone WHERE templateId=? ORDER BY rowid').all(tpl.id);
  const revision={requirementVersion:page.requirements.current?.version||0,draftRevision:page.draft?.revision||0,targetVersion:page.targetOptions.version};
  return {o,s,tpl,logoBytes,source,zones,revision,surfaces:s.targets.map(t=>surface(t.zoneId)),definition:db.prepare('SELECT definitionJson FROM TemplateAutomation WHERE templateId=?').get(tpl.id)?.definitionJson||null};
 }
 async function checks(ctx){const out=[];for(const t of ctx.s.targets){const r=await rules.calculateCarrier({taskId:ctx.s.taskId,taskProductId:ctx.s.taskProductId,productionLogoId:ctx.s.logoId,processType:t.processType,selectedTemplateAreaId:t.zoneId},t.logoColor);if(r.overallStatus!=='PASS'||r.testOnly)fail('工艺检查未通过，需补齐资料或由设计师处理','RULE_BLOCKED');out.push({areaId:t.areaId,fingerprint:r.fingerprint});}return out;}
 const state=ctx=>({revision:ctx.revision,surfaces:ctx.surfaces,zones:ctx.zones,definition:ctx.definition,sourceSha:ctx.s.outputSha});
 async function valid(j){
  if(!pending.includes(get(j.id).status))fail('作业已取消或结束','CANCELLED');
  const snap=JSON.parse(j.snapshotJson);if(JSON.stringify(config())!==JSON.stringify(snap.config))fail('接口配置已变化，未继续提交','CONFIG_CHANGED');
  const ctx=context(j.taskId,j.sourceOutputId);if(sha(JSON.stringify(state(ctx)))!==snap.stateHash)fail('客户要求、摆放或母版设置已变化');
  if(JSON.stringify(await checks(ctx))!==JSON.stringify(snap.ruleChecks))fail('工艺规则已变化，请重新生成二维预览','RULE_CHANGED');return ctx;
 }
 function view(j){const s=JSON.parse(j.snapshotJson);return {id:j.id,taskId:j.taskId,taskProductId:j.taskProductId,sourceOutputId:j.sourceOutputId,status:j.status,mode:s.config.mode,schemeName:s.source.schemeName,sku:s.source.sku,attemptCount:j.attemptCount,errorCode:j.errorCode,message:j.message,createdAt:j.createdAt,finishedAt:j.finishedAt,resultPath:['PASS','MOCK_PASS'].includes(j.status)?j.resultPath:null,attempts:db.prepare('SELECT number,status,qaJson,metadataJson,durationMs FROM AutomaticAIAttempt WHERE jobId=? ORDER BY number').all(j.id).map(a=>({...a,qa:a.qaJson?JSON.parse(a.qaJson):null,metadata:JSON.parse(a.metadataJson),qaJson:undefined,metadataJson:undefined}))};}
 function page(id){task(id);return {config:config(),busy:isBusy(id),jobs:db.prepare('SELECT * FROM AutomaticAIJob WHERE taskId=? ORDER BY rowid DESC').all(id).map(view)};}
 function file(id,kind,bytes){const key=storage.put(bytes,'png');try{db.prepare('INSERT INTO AutomaticAIFile VALUES (?,?,?,?,?)').run(randomUUID(),id,kind,key,sha(bytes));}catch(e){storage.remove(key);throw e;}return key;}
 async function create(taskId,input){
  const c=config();task(taskId);if(!c.enabled)return {mode:'TWO_D_ONLY',message:'AI 增强尚未启用，已保留二维效果图',...page(taskId)};
  const ids=input?.outputIds;if(!Array.isArray(ids)||!ids.length||ids.length>60||new Set(ids).size!==ids.length)fail('请选择 1–60 张当前二维图片','INPUT_INVALID',400);
  // Validate the entire request before persisting jobs. No partial enqueue on invalid source IDs.
  const plans=[];
  for(const id of ids){const ctx=context(taskId,id),ruleChecks=await checks(ctx),snap={source:ctx.s,sourceOutputId:id,config:c,stateHash:sha(JSON.stringify(state(ctx))),state:state(ctx),ruleChecks};
   const {revision,...imageState}=state(ctx);plans.push({ctx,snap,fingerprint:sha(JSON.stringify({sourceOutputId:id,config:c,state:imageState,ruleChecks}))});}
  // Another request may have changed the task while rules were being evaluated.
  if(new Set(plans.map(p=>p.ctx.o.taskProductId)).size>20)fail('每次最多处理 20 个产品','INPUT_INVALID',400);
  if(JSON.stringify(config())!==JSON.stringify(c))fail('接口配置已变化');
  for(const p of plans)if(sha(JSON.stringify(state(context(taskId,p.ctx.o.id))))!==p.snap.stateHash)fail('任务设置已变化，请重试');
  const idsOut=[];db.exec('BEGIN IMMEDIATE');try{for(const p of plans){const old=db.prepare('SELECT id FROM AutomaticAIJob WHERE fingerprint=?').get(p.fingerprint);if(old){idsOut.push(old.id);continue;}const id=randomUUID();db.prepare('INSERT INTO AutomaticAIJob(id,taskId,taskProductId,sourceOutputId,fingerprint,status,snapshotJson,createdAt) VALUES (?,?,?,?,?,?,?,?)').run(id,taskId,p.ctx.o.taskProductId,p.ctx.o.id,p.fingerprint,'QUEUED',JSON.stringify(p.snap),now());idsOut.push(id);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  for(const id of idsOut)if(get(id).status==='QUEUED'&&!queue.includes(id)&&!running.has(id))queue.push(id);queueMicrotask(pump);
  return {jobIds:idsOut,...page(taskId)};
 }
 async function execute(id){const j=get(id),snap=JSON.parse(j.snapshotJson);let attemptId,started;
  try{set(id,'RENDERING');const ctx=await valid(j);let underlay;
   if(ctx.surfaces.some(s=>s.surfaceType!=='FLAT')){const definition=JSON.parse(ctx.definition||'{}'),surface=await recolorSurfaces(storage.get(ctx.tpl.standardImage),definition.carriers||[],(ctx.s.requirementSnapshot?.carrierOverrides||[]).filter(o=>o.taskProductId===ctx.s.taskProductId&&!o.areaId));if((surface.outputSha||null)!==(ctx.s.surfaceOutputSha||null))fail('产品底色蒙版已变化');underlay=surface.bytes;}
   const basis=await automaticBasis(ctx.source,ctx.logoBytes,ctx.s,ctx.zones,ctx.surfaces,underlay);await valid(j);
   file(id,'BASIS',basis.basisPng);file(id,'EDITABLE_MASK',basis.maskPng);file(id,'PROTECT_MASK',basis.protectPng);let previous=[];
   for(let number=1;number<=snap.config.maxRetries+1;number++){
    await valid(j);set(id,number===1?'RENDERING':'RETRYING');attemptId=randomUUID();started=Date.now();
    db.prepare('INSERT INTO AutomaticAIAttempt VALUES (?,?,?,?,?,?,?,?)').run(attemptId,id,number,'SUBMITTED',null,'{}',0,now());db.prepare('UPDATE AutomaticAIJob SET attemptCount=? WHERE id=?').run(number,id);
    const input={productImage:ctx.source.toString('base64'),productionLogo:ctx.logoBytes.toString('base64'),basisImage:basis.basisPng.toString('base64'),editableMask:basis.maskPng.toString('base64'),protectMask:basis.protectPng.toString('base64'),surfaceType:'FLAT',processVisualType:ctx.s.processType,targets:ctx.s.targets.map(t=>({areaId:t.areaId,processType:t.processType,placement:t.placement})),renderPolicyVersion:snap.config.policy,previousFailures:previous,instructions:'Edit only white pixels of editableMask. Preserve exact logo text, geometry, color, all placements, product, and background. Subtle lighting integration only. Return original dimensions.'};
    // LOCAL_MOCK proves the workflow only; it can never receive PASS / AI_ENHANCED labels.
    const progress=v=>{const old=JSON.parse(db.prepare('SELECT metadataJson FROM AutomaticAIAttempt WHERE id=?').get(attemptId).metadataJson);db.prepare('UPDATE AutomaticAIAttempt SET metadataJson=?,durationMs=? WHERE id=?').run(JSON.stringify({...old,...safeMetadata(v)}),Date.now()-started,attemptId);};
    const result=snap.config.mode==='LOCAL_MOCK'?{bytes:basis.basisPng,metadata:{calls:0}}:await adapter.generate(input,progress);
    progress(result.metadata);
    await valid(j);set(id,'QA');if(Buffer.isBuffer(result.rawBytes))file(id,'RAW_PROVIDER',result.rawBytes);file(id,'CANDIDATE',result.bytes);let qa;
    try{qa=await automaticQuality(result.bytes,basis);}catch{fail('服务返回的图片无法读取，已保留二维图','BAD_IMAGE');}
    if(result.metadata?.rawQualityFailures?.length){qa.result='RETRY';qa.reasons.push('PROVIDER_RAW_QA_FAIL：原始返回图未通过保护区检查');}
    db.prepare('UPDATE AutomaticAIAttempt SET status=?,qaJson=? WHERE id=?').run(qa.result,JSON.stringify(qa),attemptId);
    if(qa.result==='PASS'){
     await valid(j);const final=await protectOutput(result.bytes,basis);await valid(j);
     const key=file(id,'FINAL',final);db.prepare('UPDATE AutomaticAIJob SET resultPath=?,resultSha=? WHERE id=?').run(key,sha(final),id);set(id,snap.config.mode==='LOCAL_MOCK'?'MOCK_PASS':'PASS',null,snap.config.mode==='LOCAL_MOCK'?'本地模拟通过；不是实际 AI 出图':'自动质检通过，待人工复核实际效果');return;
    }
    previous=qa.reasons;if(qa.result==='DESIGNER_REQUIRED'||number>snap.config.maxRetries){set(id,'DESIGNER_REQUIRED','QA_FAILED','质量检查未通过，已保留二维图，请设计师处理');return;}
   }
  }catch(e){
   if(attemptId)db.prepare("UPDATE AutomaticAIAttempt SET status='FAILED',durationMs=? WHERE id=? AND status='SUBMITTED'").run(Date.now()-started,attemptId);
   if(get(id).status==='CANCELLED')return;
   const known={STALE_INPUT:'来源或要求已变化，已丢弃增强结果，请重新生成',RULE_CHANGED:'工艺规则已变化，已保留二维图',RULE_BLOCKED:'工艺未通过，请补齐资料或联系设计师',CONFIG_CHANGED:'接口配置已变化，未继续提交',UNSUPPORTED_SURFACE:'曲面区域尚未接入自动增强，保留二维图并转设计师',BAD_IMAGE:'返回图片无法读取，已保留二维图',PROVIDER_ERROR:'接口调用失败或超时，未自动重复提交；请核对服务商记录',PROVIDER_NOT_CONFIGURED:'接口不可用，已保留二维图'};
   const code=known[e.code]?e.code:'GEOMETRY_OR_LOCAL_ERROR';set(id,e.code==='UNSUPPORTED_SURFACE'||code==='GEOMETRY_OR_LOCAL_ERROR'?'DESIGNER_REQUIRED':e.code==='STALE_INPUT'||e.code==='RULE_CHANGED'?'STALE':'FAILED',code,known[code]||'图像或本地检查未完成，保留二维图，请设计师检查');
  }
 }
 function pump(){while(workers<config().concurrency&&queue.length){const id=queue.shift();if(db.prepare('SELECT status FROM AutomaticAIJob WHERE id=?').get(id)?.status!=='QUEUED')continue;workers++;running.add(id);execute(id).catch(()=>{if(get(id).status!=='CANCELLED')set(id,'FAILED','LOCAL_ERROR','本地处理未完成');}).finally(()=>{running.delete(id);workers--;pump();});}}
 function cancel(taskId,id){const j=get(id);if(j.taskId!==taskId)fail('记录不属于当前任务','NOT_FOUND',404);if(pending.includes(j.status))set(id,'CANCELLED','CANCELLED','已取消本地处理；已提交的外部请求可能仍计费，返回图片不会采用');return page(taskId);}
 function isBusy(id){return [...running].some(j=>get(j).taskId===id)||!!db.prepare("SELECT id FROM AutomaticAIJob WHERE taskId=? AND status IN ('QUEUED','RENDERING','QA','RETRYING')").get(id);}
 return {config,page,create,cancel,isBusy};
}
