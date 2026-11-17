import {randomUUID,createHash} from 'node:crypto';
import {transparentMaster} from './smart-background.mjs';
import {makeProduction,sharp} from './logo-pixels.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const algorithm='flat-color-matte-v3';

export function transparentMasterService(db,storage,library=null){
 db.exec(`CREATE TABLE IF NOT EXISTS TransparentMaster (
 id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES Task(id),sourceId TEXT NOT NULL REFERENCES OriginalLogoVersion(id),
 version INTEGER NOT NULL,inputSha TEXT NOT NULL,algorithm TEXT NOT NULL,status TEXT NOT NULL,
 filePath TEXT,outputSha TEXT,detailsJson TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,
 reviewedBy TEXT,reviewNote TEXT,createdAt TEXT NOT NULL,UNIQUE(sourceId,version));
 CREATE TABLE IF NOT EXISTS TransparentMasterProduction (
 id TEXT PRIMARY KEY,masterId TEXT NOT NULL REFERENCES TransparentMaster(id),productionLogoId TEXT NOT NULL UNIQUE REFERENCES ProductionLogo(id));`);
 const busy=new Set();
 const task=id=>{const t=db.prepare('SELECT * FROM Task WHERE id=?').get(id);if(!t)fail('任务不存在',404);return t;};
 const writable=id=>{task(id);if(db.prepare('SELECT lifecycle FROM TaskManagement WHERE taskId=?').get(id)?.lifecycle==='ARCHIVED')fail('请先恢复已归档任务',409);};
 const source=(id,sourceId)=>{const s=db.prepare('SELECT * FROM OriginalLogoVersion WHERE taskId=? AND id=?').get(id,sourceId);if(!s)fail('原始 Logo 不属于当前任务',404);return s;};
 const get=(id,masterId)=>{const m=db.prepare('SELECT * FROM TransparentMaster WHERE id=? AND taskId=?').get(masterId,id);if(!m)fail('透明母版不属于当前任务',404);return m;};
 const intact=m=>{try{return !!m.filePath&&hash(storage.get(m.filePath))===m.outputSha;}catch{return false;}};
 const row=m=>({...m,details:JSON.parse(m.detailsJson),fileAvailable:intact(m),canReprocess:m.algorithm!==algorithm&&!m.reviewedBy});
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
 function page(id){const t=task(id);return {activeProductionLogoId:t.activeProductionLogoId,busy:busy.has(id),sources:db.prepare('SELECT id,version,fileName,previewPath FROM OriginalLogoVersion WHERE taskId=? ORDER BY version DESC').all(id),masters:db.prepare('SELECT * FROM TransparentMaster WHERE taskId=? ORDER BY rowid DESC').all(id).map(row)};}
 function unchanged(id,m){const s=source(id,m.sourceId);if(hash(storage.get(s.previewPath))!==m.inputSha)fail('原图内容已变化，请重新处理',409);if(!intact(m))fail('透明母版文件缺失或变化，请重新处理',409);}
 async function prepare(id,input){
  writable(id);if(busy.has(id))fail('Logo 正在处理，请稍后重试',409);
  const s=source(id,input.sourceId),bytes=storage.get(s.previewPath),inputSha=hash(bytes);
  const prior=db.prepare('SELECT * FROM TransparentMaster WHERE sourceId=? AND inputSha=? ORDER BY version DESC LIMIT 1').get(s.id,inputSha);
  // Re-evaluate old automatic holds using the new algorithm. A professional's
  // explicit approval/rejection remains authoritative across algorithm upgrades.
  if(prior?.reviewedBy)return page(id);
  if(prior&&prior.algorithm===algorithm&&((!prior.filePath&&prior.status==='DESIGNER_REQUIRED')||intact(prior)))return page(id);
  busy.add(id);let key;
  try{
   const result=await transparentMaster(bytes,{sourceFormat:s.filePath.split('.').pop().toLowerCase()}),{buffer,...details}=result;
   writable(id);if(hash(storage.get(source(id,s.id).previewPath))!==inputSha)fail('原图已变化，请重新处理',409);
   const status=result.status!=='READY'?'DESIGNER_REQUIRED':result.needsReview?'REVIEW_REQUIRED':'READY';
   if(buffer)key=storage.put(buffer,'png');
   const version=(db.prepare('SELECT max(version) n FROM TransparentMaster WHERE sourceId=?').get(s.id).n||0)+1;
   db.prepare('INSERT INTO TransparentMaster (id,taskId,sourceId,version,inputSha,algorithm,status,filePath,outputSha,detailsJson,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,s.id,version,inputSha,algorithm,status,key||null,buffer?hash(buffer):null,JSON.stringify(details),new Date().toISOString());
   key=null;return page(id);
  }finally{if(key)storage.remove(key);busy.delete(id);}
 }
 function review(id,input,actor){
  if(!['ADMIN','DESIGNER'].includes(actor.role))fail('背景复核需要设计师或管理员登录',403);
  writable(id);const m=get(id,input.masterId);unchanged(id,m);
  if(m.revision!==input.baseRevision)fail('复核记录已变化，请刷新',409);
  if(m.status!=='REVIEW_REQUIRED')fail('当前母版不需要复核',409);
  if(typeof input.approved!=='boolean'||typeof input.note!=='string'||!input.note.trim()||input.note.length>1000)fail('请填写复核结论及依据');
  tx(()=>{db.prepare('UPDATE TransparentMaster SET status=?,revision=revision+1,reviewedBy=?,reviewNote=? WHERE id=?').run(input.approved?'READY':'DESIGNER_REQUIRED',actor.username,input.note.trim(),m.id);
   db.prepare('INSERT INTO ManagementAudit VALUES (?,?,?,?,?,?)').run(randomUUID(),'TRANSPARENT_MASTER_REVIEW',m.id,JSON.stringify({approved:input.approved,note:input.note.trim()}),actor.username,new Date().toISOString());});
  return page(id);
 }
 async function activate(id,input,actor){
  writable(id);if(busy.has(id))fail('Logo 正在处理，请稍后重试',409);
  const m=get(id,input.masterId);if(m.status!=='READY')fail('请先完成背景复核，复杂背景需要设计师处理',409);unchanged(id,m);
  if(input.expectedActiveProductionLogoId!==task(id).activeProductionLogoId)fail('当前生产 Logo 已变化，请刷新后确认',409);
  const existing=db.prepare('SELECT productionLogoId FROM TransparentMasterProduction WHERE masterId=? ORDER BY rowid DESC LIMIT 1').get(m.id);
  // Repeated requests while this exact derivative is active are idempotent.
  if(existing?.productionLogoId===task(id).activeProductionLogoId)return page(id);
  const e=db.prepare('SELECT * FROM LogoElement WHERE logoAssetId=? AND isFull=1 AND isArchived=0').get(m.sourceId);if(!e)fail('完整 Logo 元素缺失，请设计师检查',409);
  busy.add(id);let key;
  try{
   const result=await makeProduction(storage.get(m.filePath),[e],{backgroundRemovalMode:'NONE',colorMode:'ORIGINAL'});
   const pixels=await sharp(result.png).ensureAlpha().raw().toBuffer();let rgb=null,solid=true,visible=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]===0)continue;visible++;const c=pixels.subarray(i,i+3).toString('hex');if(pixels[i+3]!==255||(rgb!==null&&rgb!==c)){solid=false;break;}rgb=c;}
   if(solid&&visible>0){result.colorCount=1;Object.assign(result.analysis,{estimatedColorCount:1,hasGradient:false,analysisConfidence:'HIGH',exactFillEvidence:{method:'ALL_VISIBLE_PIXELS_OPAQUE_SINGLE_RGB_V1',color:'#'+rgb,visiblePixels:visible}});}
   key=storage.put(result.png,'png');
   tx(()=>{
    writable(id);unchanged(id,m);if(input.expectedActiveProductionLogoId!==task(id).activeProductionLogoId)fail('当前生产 Logo 已变化，请刷新后确认',409);
    const version=(db.prepare('SELECT max(version) n FROM ProductionLogo WHERE taskId=?').get(id).n||0)+1,a=result.analysis,pid=randomUUID();
    db.prepare('INSERT INTO ProductionLogo VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(pid,id,version,m.sourceId,'ORIGINAL',a.estimatedColorCount,result.colorCount,'#000000','#c4a052','',a.hasGradient===null?null:Number(a.hasGradient),Number(a.hasTransparency),a.hasShadow===null?null:Number(a.hasShadow),a.analysisConfidence,Number(a.needsManualReview),JSON.stringify({...a,transparentMasterId:m.id}),'NONE',0,key,result.width,result.height,JSON.stringify([e]),actor.username,new Date().toISOString());
    db.prepare('INSERT INTO ProductionLogoElement VALUES (?,?,?)').run(randomUUID(),pid,e.id);
    db.prepare('INSERT INTO TransparentMasterProduction VALUES (?,?,?)').run(randomUUID(),m.id,pid);
    db.prepare('UPDATE Task SET activeProductionLogoId=? WHERE id=?').run(pid,id);library?.saveTask(id,actor,{automatic:true});
   });key=null;return page(id);
  }finally{if(key)storage.remove(key);busy.delete(id);}
 }
 return {page,prepare,review,activate,isBusy:id=>busy.has(id)};
}
