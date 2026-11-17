import {normalizeColorSpec} from './color-reference.mjs';
import {randomUUID} from 'node:crypto';
import {normalizeLogoColor} from './carrier-colors.mjs';
import {PROCESSES} from './rule-engine.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function customerRevisionService(db,isBusy,colors){
 db.exec(`CREATE TABLE IF NOT EXISTS CustomerRequirementRevision (
 id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES Task(id),version INTEGER NOT NULL,
 requirementText TEXT NOT NULL,processType TEXT NOT NULL,changeNote TEXT NOT NULL,
 createdBy TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(taskId,version));`);
 const task=id=>{const t=db.prepare('SELECT * FROM Task WHERE id=?').get(id);if(!t)fail('任务不存在',404);return t;};
 if(!db.prepare('PRAGMA table_info(CustomerRequirementRevision)').all().some(c=>c.name==='carrierOverridesJson'))db.exec("ALTER TABLE CustomerRequirementRevision ADD COLUMN carrierOverridesJson TEXT NOT NULL DEFAULT '[]'");
 const decode=r=>r?{...r,carrierOverrides:JSON.parse(r.carrierOverridesJson)}:null;
 function carriers(id){return db.prepare(`SELECT tp.id AS taskProductId,p.sku,a.definitionJson FROM TaskProduct tp JOIN Product p ON p.id=tp.productId JOIN TaskProductTemplate b ON b.taskProductId=tp.id JOIN TemplateAutomation a ON a.templateId=b.templateId WHERE tp.taskId=? AND NOT EXISTS (SELECT 1 FROM TaskProductLifecycle l WHERE l.taskProductId=tp.id AND l.lifecycle='REMOVED')`).all(id).flatMap(r=>JSON.parse(r.definitionJson).carriers.map(c=>({taskProductId:r.taskProductId,sku:r.sku,carrierId:c.id,name:c.name,surfaceReady:!!c.surfaceMask?.reviewed,schemes:JSON.parse(r.definitionJson).schemes.map(s=>({id:s.id,name:s.name,areaIds:s.targets.map(t=>t.areaId)})),areas:JSON.parse(r.definitionJson).areas.filter(a=>a.carrierId===c.id&&a.autoEligible).map(a=>({id:a.id,name:a.name}))})));}
 function validateOverrides(id,value){
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>200)fail('载体工艺设置最多200项');
  const available=carriers(id),seen=new Set();
  return value.map(o=>{
   if(!o||typeof o!=='object'||Object.keys(o).some(k=>!['taskProductId','carrierId','processType','logoColor','surfaceColor','logoColorSpec','areaId','schemeId'].includes(k)))fail('载体设置字段无效');
   if(!available.some(c=>c.taskProductId===o.taskProductId&&c.carrierId===o.carrierId))fail('载体不属于当前任务的有效锁定母版');
   if(!['AUTO','INHERIT'].includes(o.processType)&&!Object.hasOwn(PROCESSES,o.processType))fail('载体工艺无效');
   if(o.areaId!==undefined){const carrier=available.find(c=>c.taskProductId===o.taskProductId&&c.carrierId===o.carrierId);if(typeof o.areaId!=='string'||!carrier.areas.some(a=>a.id===o.areaId))fail('区域不属于当前有效母版');if(o.surfaceColor)fail('区域设置不支持独立底色蒙版');}
   if(o.schemeId!==undefined){const c=available.find(c=>c.taskProductId===o.taskProductId&&c.carrierId===o.carrierId),scheme=c.schemes.find(s=>s.id===o.schemeId);if(!scheme||!o.areaId||!scheme.areaIds.includes(o.areaId))fail('方案设置必须选择该方案参与的区域');if(o.logoColor||o.logoColorSpec||o.surfaceColor)fail('方案级设置仅用于工艺，颜色在区域统一设置');}
   const surfaceColor=normalizeLogoColor(o.surfaceColor);if(surfaceColor&&!available.find(c=>c.taskProductId===o.taskProductId&&c.carrierId===o.carrierId)?.surfaceReady)fail('该载体没有已复核的底色蒙版，请先发布母版并用于新任务');
   const spec=o.logoColorSpec===undefined?null:(colors?colors.normalize(id,o.logoColorSpec):normalizeColorSpec(o.logoColorSpec));
   if(spec&&o.logoColor&&normalizeLogoColor(o.logoColor)!==(spec.hex||null))fail('颜色值与颜色来源不一致');
   const logoColor=spec?(spec.hex||null):normalizeLogoColor(o.logoColor);
   const expected={BLACK_PRINT:'#000000',WHITE_PRINT:'#ffffff',GOLD_PRINT:'#c4a052',SILVER_PRINT:'#bfc3c9',HOT_STAMP_GOLD:'#c4a052',HOT_STAMP_SILVER:'#bfc3c9'}[o.processType];if(logoColor&&expected&&logoColor!==expected)fail('指定 Logo 颜色与所选工艺不匹配');
   const key=JSON.stringify([o.taskProductId,o.carrierId,o.areaId||null,o.schemeId||null]);if(seen.has(key))fail('载体工艺设置重复');seen.add(key);
   return {taskProductId:o.taskProductId,carrierId:o.carrierId,...(o.areaId?{areaId:o.areaId}:{}),...(o.schemeId?{schemeId:o.schemeId}:{}),processType:o.processType,...(surfaceColor?{surfaceColor}:{}),...(logoColor?{logoColor}:{}),...(spec?{logoColorSpec:spec}:{})};
  }).sort((a,b)=>a.taskProductId.localeCompare(b.taskProductId)||a.carrierId.localeCompare(b.carrierId)||(a.areaId||'').localeCompare(b.areaId||'')||(a.schemeId||'').localeCompare(b.schemeId||''));
 }
 const current=id=>decode(db.prepare('SELECT * FROM CustomerRequirementRevision WHERE taskId=? ORDER BY version DESC LIMIT 1').get(id));
 function page(id){const t=task(id);return {current:current(id),legacyText:t.rawRequirement,history:db.prepare('SELECT * FROM CustomerRequirementRevision WHERE taskId=? ORDER BY version DESC').all(id).map(decode),carriers:carriers(id)};}
 function save(id,input,actor,onSaved){
  task(id);if(isBusy(id))fail('任务正在生成，请结束后再创建修稿轮次',409);
  if(db.prepare('SELECT lifecycle FROM TaskManagement WHERE taskId=?').get(id)?.lifecycle==='ARCHIVED')fail('请先恢复已归档任务',409);
  if(!input||!Number.isInteger(input.baseVersion)||input.baseVersion<0)fail('基准版本不正确');
  if(typeof input.requirementText!=='string'||input.requirementText.length>5000)fail('客户要求最多5000字');
  if(input.processType!=='AUTO'&&!Object.hasOwn(PROCESSES,input.processType))fail('请选择客户指定工艺或未指定');
  if(input.structuredConfirmed!==true)fail('请确认已将客户工艺要求填写到工艺选项；文字备注不自动执行');
  if(typeof input.changeNote!=='string'||!input.changeNote.trim()||input.changeNote.length>1000)fail('请填写本轮修改说明，最多1000字');
  db.exec('BEGIN IMMEDIATE');try{
   const previous=current(id);if((previous?.version||0)!==input.baseVersion)fail('客户要求已更新，请刷新后再保存',409);
   const carrierOverrides=validateOverrides(id,input.carrierOverrides===undefined?(previous?.carrierOverrides||[]):input.carrierOverrides),version=input.baseVersion+1,revisionId=randomUUID();
   db.prepare('INSERT INTO CustomerRequirementRevision (id,taskId,version,requirementText,processType,changeNote,createdBy,createdAt,carrierOverridesJson) VALUES (?,?,?,?,?,?,?,?,?)').run(revisionId,id,version,input.requirementText.trim(),input.processType,input.changeNote.trim(),actor.username,new Date().toISOString(),JSON.stringify(carrierOverrides));
   db.prepare('INSERT INTO ManagementAudit VALUES (?,?,?,?,?,?)').run(randomUUID(),'CUSTOMER_REQUIREMENT_REVISION',id,JSON.stringify({revisionId,version,processType:input.processType,carrierOverrides}),actor.username,new Date().toISOString());
   if(onSaved)onSaved({id:revisionId,version});db.exec('COMMIT');return page(id);
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function ensure(id,input,actor){if(!input||input.structuredConfirmed!==true)fail('请核对客户要求与工艺设置');const previous=current(id);if((previous?.version||0)!==input.baseVersion)fail('客户要求已更新，请刷新',409);const normalized=validateOverrides(id,input.carrierOverrides||[]),stable=v=>JSON.stringify(v,(k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);if(previous&&previous.requirementText===input.requirementText?.trim()&&previous.processType===input.processType&&stable(previous.carrierOverrides)===stable(normalized))return page(id);return save(id,input,actor);}
 function validateDraft(id,input){task(id);if(isBusy(id))fail('任务正在生成，请稍后保存',409);if(db.prepare('SELECT lifecycle FROM TaskManagement WHERE taskId=?').get(id)?.lifecycle==='ARCHIVED')fail('请先恢复已归档任务',409);if(!input||input.structuredConfirmed!==true)fail('请确认结构化要求');if(typeof input.requirementText!=='string'||input.requirementText.length>5000)fail('客户要求最多5000字');if(input.processType!=='AUTO'&&!Object.hasOwn(PROCESSES,input.processType))fail('请选择有效工艺');if(input.changeNote!==undefined&&(typeof input.changeNote!=='string'||input.changeNote.length>1000))fail('修改说明最多1000字');return {requirementText:input.requirementText.trim(),processType:input.processType,carrierOverrides:validateOverrides(id,input.carrierOverrides||[]),changeNote:input.changeNote?.trim()||'生成时冻结本次修改',structuredConfirmed:true};}
 return {page,current,save,ensure,validateDraft};
}

// Automatic choice is limited to ordinary printing. Metallic colours never imply foil.
export function processCandidates(requested,logo){
 const colorProcess={'#000000':'BLACK_PRINT','#ffffff':'WHITE_PRINT','#c4a052':'GOLD_PRINT','#bfc3c9':'SILVER_PRINT'}[logo.primaryColor?.toLowerCase()];
 if(requested!=='AUTO')return [requested];
 return ['NORMAL_PRINT',...(logo.colorMode==='SINGLE'&&colorProcess?[colorProcess]:[])];
}
export async function chooseProcess(candidates,zoneIds,evaluate){
 const rejected=[];
 for(const processType of candidates){
  const results=[];for(const zoneId of zoneIds)results.push(await evaluate(processType,zoneId));
  if(results.every(r=>r.overallStatus==='PASS'&&!r.testOnly))return {processType,results,rejected};
  rejected.push({processType,reasons:results.filter(r=>r.overallStatus!=='PASS'||r.testOnly).flatMap(r=>r.messages)});
 }
 fail('没有可自动执行的工艺：'+rejected.map(r=>`${PROCESSES[r.processType]}：${r.reasons.join('；')}`).join(' / '));
}
