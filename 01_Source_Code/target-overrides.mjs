import {randomUUID} from 'node:crypto';
import {activeSql} from './task-products.mjs';
const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status});};
export function targetOverrideService(db,isBusy){
 db.exec('CREATE TABLE IF NOT EXISTS TaskTargetOverrides(id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES Task(id) ON DELETE CASCADE,version INTEGER NOT NULL,settingsJson TEXT NOT NULL,createdBy TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(taskId,version))');
 const current=id=>{const r=db.prepare('SELECT * FROM TaskTargetOverrides WHERE taskId=? ORDER BY version DESC LIMIT 1').get(id);return r?{...r,settings:JSON.parse(r.settingsJson)}:{version:0,settings:[]};};
 function definitions(id){return db.prepare(`SELECT tp.id AS taskProductId,p.sku,a.definitionJson FROM TaskProduct tp JOIN Product p ON p.id=tp.productId JOIN TaskProductTemplate b ON b.taskProductId=tp.id JOIN TemplateAutomation a ON a.templateId=b.templateId WHERE tp.taskId=? AND ${activeSql('tp')}`).all(id).map(r=>({...r,definition:JSON.parse(r.definitionJson)}));}
 function resolve(def,scheme,settings,taskProductId){
  const targets=scheme.targets.map(t=>{const o=settings.find(o=>o.taskProductId===taskProductId&&o.schemeId===scheme.id&&o.sourceAreaId===t.areaId);return o?.disabled?null:{...t,areaId:o?.areaId||t.areaId,presetId:o?.presetId||t.presetId};}).filter(Boolean);
  if(!targets.length)fail('不能关闭一个方案的全部目标，请至少保留一个产品或彩盒');
  if(new Set(targets.map(t=>t.areaId)).size!==targets.length)fail('同一方案不能将多个目标放入同一个区域');
  return targets;
 }
 function save(id,input,actor){
  if(isBusy(id))fail('正在生成，请结束后再调整',409);
  if(!db.prepare('SELECT id FROM Task WHERE id=?').get(id))fail('任务不存在',404);
  if(db.prepare('SELECT lifecycle FROM TaskManagement WHERE taskId=?').get(id)?.lifecycle==='ARCHIVED')fail('请先恢复归档任务',409);
  if(!input||!Number.isInteger(input.baseVersion)||!Array.isArray(input.settings)||input.settings.length>600)fail('摆放选择格式不正确');
  const defs=definitions(id),seen=new Set();
  const settings=input.settings.map(o=>{
   if(!o||Object.keys(o).some(k=>!['taskProductId','schemeId','sourceAreaId','areaId','presetId','disabled'].includes(k))||typeof o.disabled!=='boolean')fail('摆放选择字段不正确');
   const d=defs.find(d=>d.taskProductId===o.taskProductId)?.definition,s=d?.schemes.find(s=>s.id===o.schemeId),target=s?.targets.find(t=>t.areaId===o.sourceAreaId);
   if(!target)fail('该目标不属于当前任务锁定方案');
   const origin=d.areas.find(a=>a.id===target.areaId),area=d.areas.find(a=>a.id===o.areaId);
   if(!area?.autoEligible||area.carrierId!==origin.carrierId||!area.presets.some(p=>p.id===o.presetId))fail('只能选择同一载体中设计师已允许的区域和摆放方式');
   const key=[o.taskProductId,o.schemeId,o.sourceAreaId].join(':');if(seen.has(key))fail('目标重复');seen.add(key);
   return {...o};
  });
  for(const d of defs)for(const s of d.definition.schemes)resolve(d.definition,s,settings,d.taskProductId);
  db.exec('BEGIN IMMEDIATE');try{
   const old=current(id);if(old.version!==input.baseVersion)fail('摆放设置已变化，请刷新后再保存',409);
   db.prepare('INSERT INTO TaskTargetOverrides VALUES (?,?,?,?,?,?)').run(randomUUID(),id,old.version+1,JSON.stringify(settings),actor.username,new Date().toISOString());db.exec('COMMIT');return page(id);
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function page(id){return {...current(id),definitions:definitions(id).map(({taskProductId,sku,definition})=>({taskProductId,sku,...definition}))};}
 return {current,page,save,resolve};
}
