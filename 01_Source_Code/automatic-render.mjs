import {labelDelivery} from './delivery-labels.mjs';
import {targetOverrideService} from './target-overrides.mjs';
import {recolorSurfaces} from './surface-colors.mjs';
import {tintCarrierLogo} from './carrier-colors.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {sharp} from './logo-pixels.mjs';
import {autoPlace} from './public/auto-placement.js';
import {assertActive,activeSql} from './task-products.mjs';
import {PROCESSES} from './rule-engine.mjs';
import {customerRevisionService,processCandidates,chooseProcess} from './customer-revisions.mjs';
import {zipStore} from './zip.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex'),now=()=>new Date().toISOString(),fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function automaticService(db,storage,rules){
 db.exec(`CREATE TABLE IF NOT EXISTS AutomaticRun(id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES Task(id),status TEXT NOT NULL,reportJson TEXT NOT NULL,createdAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS AutomaticOutput(id TEXT PRIMARY KEY,runId TEXT NOT NULL REFERENCES AutomaticRun(id),taskProductId TEXT NOT NULL REFERENCES TaskProduct(id),schemeId TEXT NOT NULL,version INTEGER NOT NULL,imagePath TEXT NOT NULL,snapshotJson TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(taskProductId,schemeId,version));
 CREATE TABLE IF NOT EXISTS AutomaticSelection(taskProductId TEXT PRIMARY KEY REFERENCES TaskProduct(id),schemeId TEXT NOT NULL,outputId TEXT NOT NULL REFERENCES AutomaticOutput(id),revision INTEGER NOT NULL,updatedAt TEXT NOT NULL);`);
 // A interrupted run is visible; never silently retry rendering on process start.
 db.prepare("UPDATE AutomaticRun SET status='INTERRUPTED' WHERE status='RUNNING'").run();
 const busy=new Set(),task=id=>{const t=db.prepare('SELECT * FROM Task WHERE id=?').get(id);if(!t)fail('任务不存在',404);return t;};
 const requirements=customerRevisionService(db,id=>busy.has(id));
 const targetOptions=targetOverrideService(db,id=>busy.has(id));
 db.exec('CREATE TABLE IF NOT EXISTS AutomaticRunRevision (id TEXT PRIMARY KEY REFERENCES AutomaticRun(id),taskId TEXT NOT NULL REFERENCES Task(id),requirementVersion INTEGER NOT NULL,requirementJson TEXT NOT NULL)');
 const outputIntact=o=>{try{return hash(storage.get(o.imagePath))===JSON.parse(o.snapshotJson).outputSha;}catch{return false;}};
 const rows=id=>db.prepare(`SELECT tp.id, tp.productId, p.sku, p.name FROM TaskProduct tp JOIN Product p ON p.id=tp.productId WHERE tp.taskId=? AND ${activeSql('tp')} ORDER BY tp.rowid`).all(id);
 function page(id){task(id);return {items:rows(id).map(r=>({...r,selection:db.prepare('SELECT * FROM AutomaticSelection WHERE taskProductId=?').get(r.id)||null})),busy:busy.has(id),runs:db.prepare('SELECT * FROM AutomaticRun WHERE taskId=? ORDER BY rowid DESC').all(id).map(r=>({...r,report:JSON.parse(r.reportJson)})),outputs:db.prepare(`SELECT o.* FROM AutomaticOutput o JOIN TaskProduct tp ON tp.id=o.taskProductId WHERE tp.taskId=? AND ${activeSql('tp')} ORDER BY o.rowid DESC`).all(id).map(o=>({...o,snapshot:JSON.parse(o.snapshotJson)})),processes:PROCESSES};}
 function selection(taskId,input,actor){if(busy.has(taskId))fail('正在生成，请完成后再确认方案',409);const o=db.prepare('SELECT o.*,tp.taskId FROM AutomaticOutput o JOIN TaskProduct tp ON tp.id=o.taskProductId WHERE o.id=?').get(input.outputId);if(!o||o.taskId!==taskId)fail('方案不属于当前任务',404);assertActive(db,o.taskProductId);const snap=JSON.parse(o.snapshotJson);if(task(taskId).activeProductionLogoId!==snap.logoId)fail('Logo 已变化，请重新生成后确认',409);const current=db.prepare('SELECT * FROM AutomaticSelection WHERE taskProductId=?').get(o.taskProductId);if(input.baseRevision!==(current?.revision||0))fail('确认方案已变化，请刷新',409);db.prepare('INSERT INTO AutomaticSelection VALUES (?,?,?,?,?) ON CONFLICT(taskProductId) DO UPDATE SET schemeId=excluded.schemeId,outputId=excluded.outputId,revision=excluded.revision,updatedAt=excluded.updatedAt').run(o.taskProductId,o.schemeId,o.id,(current?.revision||0)+1,now());db.prepare('INSERT INTO ManagementAudit VALUES (?,?,?,?,?,?)').run(randomUUID(),'AUTOMATIC_SCHEME_CONFIRM',o.taskProductId,JSON.stringify({outputId:o.id,schemeId:o.schemeId}),actor.username,now());return page(taskId);}
 async function plan(taskId,item,processType){
  assertActive(db,item.id);const t=task(taskId),logo=db.prepare('SELECT * FROM ProductionLogo WHERE id=? AND taskId=?').get(t.activeProductionLogoId||'',taskId);if(!logo)fail('Designer Required：尚未建立生产 Logo，请先完成 Logo 预处理');
  const tpl=db.prepare('SELECT t.* FROM TaskProductTemplate b JOIN ProductTemplate t ON t.id=b.templateId WHERE b.taskProductId=?').get(item.id);if(!tpl)fail('Designer Required：缺少任务锁定母版');
  const row=db.prepare('SELECT definitionJson FROM TemplateAutomation WHERE templateId=?').get(tpl.id),definition=row?JSON.parse(row.definitionJson):null;if(!definition?.schemes.length)fail('Designer Required：锁定母版尚未确认语义区域、默认摆放框和方案');
  const zones=db.prepare('SELECT * FROM TemplateZone WHERE templateId=? ORDER BY rowid').all(tpl.id),baseBytes=storage.get(tpl.standardImage),image=await sharp(baseBytes).rotate().metadata(),imageSha=hash(baseBytes),logoBytes=storage.get(logo.filePath),logoSha=hash(logoBytes);
  const pinned=db.prepare('SELECT i.sha256 FROM TaskProductAddition a JOIN ProductImageVersion i ON i.id=a.productImageVersionId WHERE a.taskProductId=?').get(item.id);if(pinned&&pinned.sha256!==imageSha)fail('锁定产品图片发生变化，禁止生成');

  const confirmed=db.prepare('SELECT schemeId FROM AutomaticSelection WHERE taskProductId=?').get(item.id);let schemes=definition.schemes;
  if(confirmed){schemes=schemes.filter(s=>s.id===confirmed.schemeId);if(!schemes.length)fail('已确认方案在锁定母版中不存在，需要设计师检查');}
  return {t,logo,tpl,definition,zones,image:{width:image.autoOrient?.width||image.width,height:image.autoOrient?.height||image.height},imageSha,logoSha,baseBytes,logoBytes,schemes};
 }
 async function generate(taskId,input,actor){
  if(busy.has(taskId))fail('此任务正在生成，请等待完成',409);task(taskId);
  if(!input||typeof input!=='object')fail('生成参数不正确');
  const requirement= requirements.current(taskId),requested=input.processType||'AUTO';
  const targetSettings=targetOptions.current(taskId);
  if(input.targetVersion!==undefined&&input.targetVersion!==targetSettings.version)fail('本次摆放已修改，请刷新后生成',409);
  if(requested!=='AUTO'&&!Object.hasOwn(PROCESSES,requested))fail('请选择有效工艺');
  if(requirement&&input.requirementVersion!==requirement.version)fail('客户要求轮次已变化，请刷新后生成',409);
  if(!requirement&&requested==='AUTO'&&task(taskId).rawRequirement?.trim())fail('请先将原客户要求保存为结构化首稿，确认工艺要求');
  if(requirement&&requirement.processType!=='AUTO'&&requested!=='AUTO'&&requested!==requirement.processType)fail('本次工艺与客户指定工艺冲突；需先创建新修稿轮次',409);
  const requestedProcess=requirement&&requirement.processType!=='AUTO'?requirement.processType:requested;
  const lifecycle=db.prepare('SELECT lifecycle FROM TaskManagement WHERE taskId=?').get(taskId);if(lifecycle?.lifecycle==='ARCHIVED')fail('请先恢复已归档任务');
  const all=rows(taskId);if(!Array.isArray(input.taskProductIds)||!input.taskProductIds.length||input.taskProductIds.length>20)fail('请选择1–20个任务SKU');const ids=[...new Set(input.taskProductIds)];if(ids.some(id=>!all.some(r=>r.id===id)))fail('选择中包含不属于任务或已移除的 SKU');
  const runId=randomUUID(),report=[];busy.add(taskId);
  try{db.prepare('INSERT INTO AutomaticRun VALUES (?,?,?,?,?)').run(runId,taskId,'RUNNING','[]',now());
   db.prepare('INSERT INTO AutomaticRunRevision VALUES (?,?,?,?)').run(runId,taskId,requirement?.version||0,JSON.stringify(requirement));
   for(const id of ids){const item=all.find(r=>r.id===id);let ctx;try{ctx=await plan(taskId,item,requestedProcess);ctx.surface=await recolorSurfaces(ctx.baseBytes,ctx.definition.carriers,(requirement?.carrierOverrides||[]).filter(o=>o.taskProductId===id));}catch(e){report.push({taskProductId:id,sku:item.sku,status:'DESIGNER_REQUIRED',reason:e.message});db.prepare('UPDATE AutomaticRun SET reportJson=? WHERE id=?').run(JSON.stringify(report),runId);continue;}
   for(const scheme of ctx.schemes){let key;try{
    const resolved=targetOptions.resolve(ctx.definition,scheme,targetSettings.settings,id).map(target=>{const area=ctx.definition.areas.find(a=>a.id===target.areaId),preset=area?.presets.find(p=>p.id===target.presetId),zone=ctx.zones.find(z=>z.id===area?.zoneId);if(!area?.autoEligible||!preset||!zone)fail('Designer Required：方案目标已失效');return {area,preset,zone};});
    const decisions=[],carrierBytes=new Map();
    for(const carrierId of [...new Set(resolved.map(t=>t.area.carrierId))]){
     const group=resolved.filter(t=>t.area.carrierId===carrierId),override=requirement?.carrierOverrides?.find(o=>o.taskProductId===id&&o.carrierId===carrierId),carrierRequested=override?.processType&&override.processType!=='INHERIT'?override.processType:requestedProcess;
     const logoColor=override?.logoColor||null,variant=logoColor?await tintCarrierLogo(ctx.logoBytes,logoColor):null,effectiveLogo=logoColor?{...ctx.logo,colorMode:'SINGLE',primaryColor:logoColor}:ctx.logo;
     carrierBytes.set(carrierId,variant?.png||ctx.logoBytes);
     const expected={BLACK_PRINT:'#000000',WHITE_PRINT:'#ffffff',GOLD_PRINT:'#c4a052',SILVER_PRINT:'#bfc3c9',HOT_STAMP_GOLD:'#c4a052',HOT_STAMP_SILVER:'#bfc3c9'}[carrierRequested];
     if(expected&&(effectiveLogo.colorMode!=='SINGLE'||effectiveLogo.primaryColor?.toLowerCase()!==expected))fail(`${ctx.definition.carriers.find(c=>c.id===carrierId)?.name||carrierId}：Logo 颜色与工艺不匹配，请先确认颜色`);
     let choice;try{choice=await chooseProcess(processCandidates(carrierRequested,effectiveLogo),group.map(t=>t.zone.id),(processType,zoneId)=>rules.calculateCarrier({taskId,taskProductId:id,productionLogoId:ctx.logo.id,processType,selectedTemplateAreaId:zoneId},logoColor));}catch(e){fail(`${ctx.definition.carriers.find(c=>c.id===carrierId)?.name||carrierId}：${e.message}`);}
     decisions.push({carrierId,carrierName:ctx.definition.carriers.find(c=>c.id===carrierId)?.name||carrierId,logoColor,logoVariant:variant?.provenance||null,requestedProcess:carrierRequested,processType:choice.processType,rejected:choice.rejected,results:choice.results,zoneIds:group.map(t=>t.zone.id)});
    }
    const targets=resolved.map(({area,preset,zone})=>{const choice=decisions.find(c=>c.carrierId===area.carrierId);return {areaId:area.id,carrierId:area.carrierId,areaName:area.name,zoneId:zone.id,presetId:preset.id,logoColor:choice.logoColor,logoVariant:choice.logoVariant,processType:choice.processType,placement:autoPlace(zone,preset,ctx.zones,ctx.image,ctx.logo),ruleFingerprint:choice.results[choice.zoneIds.indexOf(zone.id)].fingerprint};});
    const chosen=[...new Set(decisions.map(c=>c.processType))];
    const snapshot={taskId,taskProductId:id,sku:item.sku,schemeId:scheme.id,schemeName:scheme.name,templateId:ctx.tpl.id,logoId:ctx.logo.id,processType:chosen.length===1?chosen[0]:'MIXED',carrierProcesses:decisions.map(({results,zoneIds,...c})=>c),requestedProcess,requirementRevisionId:requirement?.id||null,requirementVersion:requirement?.version||0,requirementSnapshot:requirement,processDecision:decisions.flatMap(c=>c.rejected),imageSha:ctx.imageSha,logoSha:ctx.logoSha,targets,surfaceChanges:ctx.surface.changes,surfaceOutputSha:ctx.surface.outputSha||null,mode:'MULTI_TARGET_2D_BASELINE'};
    const fingerprint=hash(JSON.stringify(snapshot)),prior=db.prepare('SELECT id,imagePath,snapshotJson FROM AutomaticOutput WHERE taskProductId=? AND schemeId=? ORDER BY version DESC LIMIT 1').get(id,scheme.id);
    if(prior&&JSON.parse(prior.snapshotJson).fingerprint===fingerprint&&outputIntact(prior)){report.push({taskProductId:id,sku:item.sku,schemeId:scheme.id,status:'UNCHANGED',outputId:prior.id});continue;}
    const groups=targets.map(({placement:p,carrierId})=>{const w=p.widthRatio*ctx.image.width,h=w*ctx.logo.height/ctx.logo.width;return `<g transform="translate(${p.x*ctx.image.width},${p.y*ctx.image.height}) rotate(${p.rotation})"><image x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" href="data:image/png;base64,${carrierBytes.get(carrierId).toString('base64')}"/></g>`;});
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${ctx.image.width}" height="${ctx.image.height}">${groups.join('')}</svg>`;
    const bytes=await sharp(ctx.surface.bytes).rotate().composite([{input:Buffer.from(svg),top:0,left:0}]).png().toBuffer();
    assertActive(db,id);if(task(taskId).activeProductionLogoId!==ctx.logo.id||hash(storage.get(ctx.tpl.standardImage))!==ctx.imageSha||hash(storage.get(ctx.logo.filePath))!==ctx.logoSha)fail('生成期间 Logo 或底图变化，请重新生成');
    for(const target of targets){const r=await rules.calculateCarrier({taskId,taskProductId:id,productionLogoId:ctx.logo.id,processType:target.processType,selectedTemplateAreaId:target.zoneId},target.logoColor);if(r.fingerprint!==target.ruleFingerprint||r.overallStatus!=='PASS'||r.testOnly)fail('生成期间工艺规则变化，请重新预检');}
    key=storage.put(bytes,'png');const outputId=randomUUID(),version=(db.prepare('SELECT max(version) v FROM AutomaticOutput WHERE taskProductId=? AND schemeId=?').get(id,scheme.id).v||0)+1;
    db.prepare('INSERT INTO AutomaticOutput VALUES (?,?,?,?,?,?,?,?)').run(outputId,runId,id,scheme.id,version,key,JSON.stringify({...snapshot,fingerprint,outputSha:hash(bytes)}),now());key=null;report.push({taskProductId:id,sku:item.sku,schemeId:scheme.id,status:'GENERATED',outputId});
   }catch(e){if(key)storage.remove(key);report.push({taskProductId:id,sku:item.sku,schemeId:scheme.id,status:'DESIGNER_REQUIRED',reason:e.message});}finally{db.prepare('UPDATE AutomaticRun SET reportJson=? WHERE id=?').run(JSON.stringify(report),runId);}}
   db.prepare('UPDATE AutomaticRun SET reportJson=? WHERE id=?').run(JSON.stringify(report),runId);
  }const success=report.some(r=>['GENERATED','UNCHANGED'].includes(r.status)),failed=report.some(r=>r.status==='DESIGNER_REQUIRED');db.prepare('UPDATE AutomaticRun SET status=?,reportJson=? WHERE id=?').run(failed?(success?'PARTIAL':'FAILED'):'COMPLETED',JSON.stringify(report),runId);return page(taskId);
  }catch(e){db.prepare('UPDATE AutomaticRun SET status=?,reportJson=? WHERE id=?').run('FAILED',JSON.stringify([...report,{status:'FAILED',reason:e.message}]),runId);throw e;}finally{busy.delete(taskId);}
 }
 function checkedSelection(taskId,input,actor){const o=db.prepare('SELECT * FROM AutomaticOutput WHERE id=?').get(input?.outputId);if(o){const s=JSON.parse(o.snapshotJson);if(s.taskId!==taskId)fail('方案不属于当前任务',404);if((s.requirementRevisionId||null)!==(requirements.current(taskId)?.id||null))fail('该图属于旧修稿轮次，请生成当前轮次后确认',409);if(!outputIntact(o))fail('输出文件缺失或损坏，请重新生成',409);}return selection(taskId,input,actor);}
 async function exportRound(id,version){task(id);if(!Number.isInteger(version)||version<0)fail('轮次无效');const latest=new Map();for(const o of page(id).outputs){if((o.snapshot.requirementVersion||0)!==version)continue;const key=o.taskProductId+':'+o.schemeId;if(!latest.has(key))latest.set(key,o);}
  if(!latest.size)fail('此轮次没有可导出的效果图',404);
  const files=await Promise.all([...latest.values()].map(async o=>{if(!outputIntact(o))fail('此轮次存在缺失或损坏的输出，请重新生成',409);const safe=s=>String(s).replace(/[^\p{L}\p{N}._-]/gu,'_').slice(0,60);return {name:`${safe(o.snapshot.sku)}_${safe(o.snapshot.schemeName)}_${o.id.slice(0,8)}_R${version?version-1:'legacy'}_V${o.version}_预览.png`,bytes:await labelDelivery(storage.get(o.imagePath),o)};}));return {bytes:zipStore(files),fileName:`二维预览_轮次${version?version-1:'历史'}_${id.slice(0,8)}.zip`};
 }
 async function delivery(taskId,outputId){task(taskId);const o=page(taskId).outputs.find(o=>o.id===outputId);if(!o)fail('输出不属于当前有效任务产品',404);if(!outputIntact(o))fail('输出缺失或损坏，请重新生成',409);return {bytes:await labelDelivery(storage.get(o.imagePath),o),fileName:`${o.id}_R${o.snapshot.requirementVersion?o.snapshot.requirementVersion-1:'legacy'}_V${o.version}_预览.png`};}
 return {delivery,page:id=>{const p=page(id);return {...p,targetOptions:targetOptions.page(id),runs:p.runs.map(r=>({...r,requirementVersion:db.prepare('SELECT requirementVersion FROM AutomaticRunRevision WHERE id=?').get(r.id)?.requirementVersion||0})),requirements:requirements.page(id)};},generate,selection:checkedSelection,saveRequirements:requirements.save,saveTargetOptions:targetOptions.save,exportRound,isBusy:id=>busy.has(id)};
}
