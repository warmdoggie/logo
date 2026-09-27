import {randomUUID,createHash} from 'node:crypto';
import {sharp} from './logo-pixels.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function additionService(db,storage,rules,batches,management){
 db.exec(`CREATE TABLE IF NOT EXISTS TaskProductAddition (
 taskProductId TEXT PRIMARY KEY REFERENCES TaskProduct(id),
 productImageVersionId TEXT NOT NULL REFERENCES ProductImageVersion(id),
 productionLogoIdAtJoin TEXT REFERENCES ProductionLogo(id),
 ruleEvaluationId TEXT REFERENCES RuleEvaluationRun(id),status TEXT NOT NULL,message TEXT,createdAt TEXT NOT NULL)`);
 const hash=b=>createHash('sha256').update(b).digest('hex');
 async function append(taskId,input){
  if(!input||typeof input!=='object')fail('追加 SKU 请求格式不正确');const task=db.prepare('SELECT * FROM Task WHERE id=?').get(taskId);if(!task)fail('任务不存在',404);
  const lifecycle=management.lifecycle(taskId);if(lifecycle.lifecycle==='ARCHIVED')fail('请先恢复已归档任务',409);const overview=await batches.results(taskId),completed=lifecycle.lifecycle==='DELIVERED'||['已完成','完成','COMPLETED'].includes(task.status)||overview.allComplete;
  if(completed&&input.confirmReopen!==true)fail('当前任务已完成。新增 SKU 会重新打开该任务，但不会改变历史交付结果、审核记录和已生成版本。',409);
  const ids=input.productIds;if(!Array.isArray(ids)||!ids.length||ids.length>200||ids.some(id=>typeof id!=='string'))fail('请选择 1–200 个产品');if(new Set(ids).size!==ids.length)fail('所选 SKU 重复');
  const prepared=[];
  for(const id of ids){const product=db.prepare('SELECT * FROM Product WHERE id=?').get(id);if(!product)fail('产品不存在',404);if(management.info(id).status==='INACTIVE')fail('该产品已停用');if(db.prepare('SELECT id FROM TaskProduct WHERE taskId=? AND productId=?').get(taskId,id))fail('SKU '+product.sku+' 已存在于当前任务',409);const template=db.prepare('SELECT * FROM ProductTemplate WHERE productId=? AND isCurrent=1 AND standardImage=?').get(id,product.standardImage)||null,imagePath=template?.standardImage||product.standardImage,bytes=storage.get(imagePath),{info}=await sharp(bytes).rotate().png().toBuffer({resolveWithObject:true});prepared.push({product,template,imagePath,sha256:hash(bytes),width:info.width,height:info.height});}
  const added=[],stamp=new Date().toISOString();db.exec('BEGIN IMMEDIATE');try{
   if(db.prepare('SELECT activeProductionLogoId FROM Task WHERE id=?').get(taskId).activeProductionLogoId!==task.activeProductionLogoId)fail('生产 Logo 已变化，请刷新后重试',409);
   for(const p of prepared){if(db.prepare('SELECT id FROM TaskProduct WHERE taskId=? AND productId=?').get(taskId,p.product.id))fail('SKU 已被其他页面加入，请刷新',409);const latest=db.prepare('SELECT id FROM ProductTemplate WHERE productId=? AND isCurrent=1 AND standardImage=?').get(p.product.id,p.product.standardImage);if((latest?.id||null)!==(p.template?.id||null)||db.prepare('SELECT standardImage FROM Product WHERE id=?').get(p.product.id).standardImage!==p.product.standardImage||hash(storage.get(p.imagePath))!==p.sha256)fail('产品图或母版已变化，请重新选择',409);
    const id=randomUUID();db.prepare('INSERT INTO TaskProduct VALUES (?,?,?)').run(id,taskId,p.product.id);if(p.template)db.prepare('INSERT INTO TaskProductTemplate VALUES (?,?)').run(id,p.template.id);
    db.prepare('INSERT OR IGNORE INTO ProductImageVersion VALUES (?,?,?,?,?,?,?)').run(randomUUID(),p.product.id,p.imagePath,p.sha256,p.width,p.height,stamp);const imageId=db.prepare('SELECT id FROM ProductImageVersion WHERE productId=? AND imagePath=? AND sha256=?').get(p.product.id,p.imagePath,p.sha256).id;
    db.prepare('INSERT INTO TaskProductAddition VALUES (?,?,?,?,?,?,?)').run(id,imageId,task.activeProductionLogoId,null,'NEED_INFO','已加入，等待规则预检',stamp);const profile=rules.profile(p.product.id);management.bindPrepared(id,{p:p.product,image:{id:imageId},profile});added.push({taskProductId:id,productId:p.product.id,sku:p.product.sku,templateId:p.template?.id||null,productImageVersionId:imageId});
   }
   if(management.lifecycle(taskId).lifecycle==='ARCHIVED')fail('任务已归档，请恢复后追加',409);db.prepare('UPDATE Task SET status=?,updatedAt=? WHERE id=?').run(completed?'待处理':task.status,stamp,taskId);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  // Only newly appended relations are evaluated. Old jobs and evaluations are untouched.
  for(const p of added){try{const zones=p.templateId?db.prepare("SELECT * FROM TemplateZone WHERE templateId=? AND zoneType='logo'").all(p.templateId):[],zone=zones.find(z=>z.isDefault)||(zones.length===1?zones[0]:null);const run=await rules.evaluate({taskId,taskProductId:p.taskProductId,productionLogoId:task.activeProductionLogoId,processType:overview.style?.processType||null,selectedTemplateAreaId:zone?.id||null});const status=!p.templateId?'NO_TEMPLATE':!zone?'NO_AREA':run.overallStatus;db.prepare('UPDATE TaskProductAddition SET ruleEvaluationId=?,status=?,message=? WHERE taskProductId=?').run(run.id,status,(!p.templateId?'缺少加入时绑定母版':!zone?'请在工作台选择区域':run.messages.join('；'))||null,p.taskProductId);p.status=status;}catch(e){db.prepare('UPDATE TaskProductAddition SET status=?,message=? WHERE taskProductId=?').run('NEED_INFO','SKU 已加入，预检未完成：'+e.message,p.taskProductId);p.status='NEED_INFO';}}
  management.restoreForAppend(taskId);let batch=null,notice=null;if(overview.style&&overview.style.productionLogoId===task.activeProductionLogoId){try{batch=await batches.create(taskId,{styleId:overview.style.id,mode:'APPLY',taskProductIds:added.map(p=>p.taskProductId)});}catch(e){notice='产品已加入，请在批量页重新预检：'+e.message;}}
  return {taskId,added,batch,notice,reopened:completed};
 }
 return {append};
}
