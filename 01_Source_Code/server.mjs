import {automaticService} from './automatic-render.mjs';
import {transparentMasterService} from './transparent-masters.mjs';
import {aiService} from './ai-renderer.mjs';
import {taskProductService,activeSql} from './task-products.mjs';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { LocalStorage } from './storage.mjs';
import { templateService } from './templates.mjs';
import { logoService } from './logos.mjs';
import {ruleService,PROCESSES,FIELDS,OPERATORS} from './rule-engine.mjs';
import {ruleAuth} from './rule-auth.mjs';
import {mockupService} from './mockups.mjs';
import {managementService} from './management.mjs';
import {storageManagement} from './storage-management.mjs';
import {additionService} from './additions.mjs';
import {batchService} from './batches.mjs';
import {acceptanceService} from './acceptance.mjs';
import {readSeedLogo} from './seed-logo.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const data = process.env.APP_DATA_DIR || join(root, 'data');
mkdirSync(data, {recursive:true});
const db = new DatabaseSync(join(data, 'assistant.sqlite'));
db.exec(readFileSync(join(root, 'schema.sql'), 'utf8'));
db.exec('PRAGMA busy_timeout=5000');
db.exec(readFileSync(join(root,'logo-schema.sql'),'utf8'));
if(!db.prepare('PRAGMA table_info(Task)').all().some(c=>c.name==='activeProductionLogoId')) db.exec('ALTER TABLE Task ADD COLUMN activeProductionLogoId TEXT REFERENCES ProductionLogo(id)');

db.exec(readFileSync(join(root,'ai-schema.sql'),'utf8'));
const storage = new LocalStorage(join(data, 'uploads'));
for(const [name,type] of [['shapeType',"TEXT DEFAULT 'RECT'"],['rotation','REAL DEFAULT 0'],['pointsJson','TEXT']])if(!db.prepare('PRAGMA table_info(TemplateZone)').all().some(c=>c.name===name))db.exec('ALTER TABLE TemplateZone ADD COLUMN '+name+' '+type);
const templates = templateService(db,storage);
const logos=logoService(db,storage);
db.exec(readFileSync(join(root,'rule-schema.sql'),'utf8'));
const rules=ruleService(db,storage),auth=ruleAuth(db,data);
rules.seed();
db.exec(readFileSync(join(root,'mockup-schema.sql'),'utf8'));
db.exec(readFileSync(join(root,'management-schema.sql'),'utf8'));
const management=managementService(db,storage,data,rules);
const automatic=automaticService(db,storage,rules);
const transparent=transparentMasterService(db,storage);
let activeWrites=0;
const disk=storageManagement(db,data,management,id=>activeWrites>1||transparent.isBusy(id)||automatic.isBusy(id)||ai.isBusy(id)||mockups.isBusy(id)||!!db.prepare("SELECT id FROM BatchJob WHERE taskId=? AND status='RUNNING'").get(id));
const ai=aiService(db,storage,rules,data);
const mockups=mockupService(db,storage,rules);
db.exec(readFileSync(join(root,'batch-schema.sql'),'utf8'));
const batches=batchService(db,storage,mockups,rules,data,ai);
const acceptance=acceptanceService(root,db);
const taskProducts=taskProductService(db,management,id=>activeWrites>1||automatic.isBusy(id)||ai.isBusy(id)||mockups.isBusy(id)||!!db.prepare("SELECT id FROM BatchJob WHERE taskId=? AND status='RUNNING'").get(id));
const additions=additionService(db,storage,rules,batches,management);
const uid = () => randomUUID();
const now = () => new Date().toISOString();
function bad(message, status=400) { throw Object.assign(new Error(message), {status}); }
function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const value=fn(); db.exec('COMMIT'); return value; } catch(e) { db.exec('ROLLBACK'); throw e; } }
function field(value, label, max, required=true) { if (typeof value !== 'string') bad(`${label}格式不正确`); const s=value.trim(); if ((required&&!s) || s.length>max) bad(`${label}${!s?'不能为空':`不能超过 ${max} 字`}`); return s; }
function sku(value) { const s=field(value,'SKU',64).toUpperCase(); if(!/^[A-Z0-9][A-Z0-9._-]*$/.test(s)) bad('SKU 仅支持英文字母、数字、点、横线和下划线'); return s; }
function imageType(b) { if(b.length>8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png'; if(b.length>3&&b[0]===255&&b[1]===216&&b[2]===255)return 'jpg'; if(b.length>12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return 'webp'; bad('请上传 PNG、JPG 或 WebP 图片'); }
async function upload(file) { if(!file || typeof file.arrayBuffer!=='function'||!file.size)bad('请选择需要上传的图片'); if(file.size>12*1024*1024)bad('单张图片不能超过 12 MB'); const bytes=Buffer.from(await file.arrayBuffer()); const ext=imageType(bytes); return {key:storage.put(bytes,ext),name:String(file.name).slice(0,240)}; }
async function addTask(customerName, requirement, ids, logo,prepared) {
 const bindings=await management.prepareBindings(ids);
 const id=uid(), stamp=now();
 const taskCode=`T${stamp.slice(0,10).replaceAll('-','')}-${uid().slice(0,8).toUpperCase()}`;
 transaction(()=>{
  for(const p of ids) if(!db.prepare('SELECT id FROM Product WHERE id=?').get(p))bad('所选产品不存在，请重新选择');
  db.prepare('INSERT INTO Task (id,taskCode,customerName,rawRequirement,status,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)').run(id,taskCode,customerName,requirement,'待处理',stamp,stamp);
  const assetId=uid();db.prepare('INSERT INTO LogoAsset VALUES (?,?,?,?,?)').run(assetId,id,logo.name,logo.key,stamp);
  logos.registerLegacy({id:assetId,taskId:id,fileName:logo.name,filePath:logo.key,createdAt:stamp},prepared);
  for(const p of ids){
   const relationId=uid();db.prepare('INSERT INTO TaskProduct VALUES (?,?,?)').run(relationId,id,p);
   const binding=bindings.find(b=>b.p.id===p),template=binding.template;management.bindPrepared(relationId,binding);
   if(template)db.prepare('INSERT INTO TaskProductTemplate VALUES (?,?)').run(relationId,template.id);
  }
 });
 return {id,taskCode};
}
if(process.env.APP_NO_SEED!=='1'&&!db.prepare("SELECT value FROM AppMeta WHERE key='seed-v1'").get()) {
 const catalog=[['L0048','持光固体唇蜜','唇部','png'],['F0021','双头带刷修容棒（亮面）','脸部','jpg'],['L0039','白管锌合金头唇釉','唇部','jpg'],['L0033','葫芦头液体唇线笔','唇部','jpg'],['E0001','绿色圆管眉胶','眼部','png']];
 const created=[];
 try { transaction(()=>{
  const ids=[];
  for(const [sku,name,category,ext] of catalog) {
   const existing=db.prepare('SELECT id FROM Product WHERE sku=?').get(sku); if(existing){ids.push(existing.id);continue;}
   const key=storage.put(readFileSync(join(root,'seed',`${sku}.${ext}`)),ext); created.push(key);
   const id=uid(), stamp=now(); db.prepare('INSERT INTO Product VALUES (?,?,?,?,?,?,?)').run(id,sku,name,category,key,stamp,stamp); ids.push(id);
  }
  const key=storage.put(readSeedLogo(),'png'); created.push(key);
  const id=uid(), stamp=now(); db.prepare('INSERT INTO Task (id,taskCode,customerName,rawRequirement,status,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)').run(id,'DEMO-RAE-001','Rae.（测试）','单色 Logo', '待处理',stamp,stamp);
  db.prepare('INSERT INTO LogoAsset VALUES (?,?,?,?,?)').run(uid(),id,'rae-logo.png',key,stamp);
  for(const p of ids)db.prepare('INSERT INTO TaskProduct VALUES (?,?,?)').run(uid(),id,p);
  db.prepare('INSERT INTO AppMeta VALUES (?,?)').run('seed-v1','1');
 }); } catch(e) { created.forEach(k=>storage.remove(k)); throw e; }
}
await logos.initializeLegacy();
function products(query='',includeInactive=false) {
 const q=query.trim().toUpperCase();
 const rows=db.prepare('SELECT p.*, (SELECT version FROM ProductTemplate WHERE productId=p.id AND isCurrent=1) AS currentVersion FROM Product p ORDER BY createdAt DESC, sku ASC').all();
 return rows.map(p=>({...p,...management.info(p.id)})).filter(p=>(includeInactive||p.status==='ACTIVE')).filter(p=>!q||p.sku.toUpperCase().startsWith(q)||p.name.toUpperCase().includes(q)).sort((a,b)=>Number(b.sku.toUpperCase()===q)-Number(a.sku.toUpperCase()===q));
}
function detail(id) {
 const task=db.prepare('SELECT * FROM Task WHERE id=?').get(id); if(!task)bad('任务不存在',404);
 return {...task,management:management.lifecycle(id),logo:db.prepare('SELECT * FROM LogoAsset WHERE taskId=?').get(id),logoWorkflow:logos.get(id),products:db.prepare('SELECT tp.id AS taskProductId,COALESCE(lifecycle.lifecycle,\'ACTIVE\') AS taskProductLifecycle,p.*,COALESCE(im.imagePath,pt.standardImage,p.standardImage) AS standardImage,snap.sku AS createdSku,pt.version AS boundVersion FROM Product p JOIN TaskProduct tp ON p.id=tp.productId LEFT JOIN TaskProductLifecycle lifecycle ON lifecycle.taskProductId=tp.id LEFT JOIN TaskProductSnapshot snap ON snap.taskProductId=tp.id LEFT JOIN ProductImageVersion im ON im.id=snap.productImageVersionId LEFT JOIN TaskProductTemplate ref ON ref.taskProductId=tp.id LEFT JOIN ProductTemplate pt ON pt.id=ref.templateId WHERE tp.taskId=? ORDER BY p.sku').all(id)};
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
async function body(req) {
 const chunks=[]; let size=0;
 for await(const c of req) {size+=c.length;if(size>14*1024*1024)bad('上传内容太大，请使用 12 MB 以内图片',413);chunks.push(c);}
 return new Request('http://localhost',{method:'POST',headers:{'content-type':req.headers['content-type']||''},body:Buffer.concat(chunks)});
}
export const server=http.createServer(async(req,res)=>{
 const writing=!['GET','HEAD'].includes(req.method);if(writing)activeWrites++;
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
 const json=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(v));};
 try {
  const requestHost=(req.headers.host||'').split(':')[0];
  const allowedHosts=(process.env.APP_ALLOWED_HOSTS||'127.0.0.1,localhost').split(',').map(v=>v.trim()).filter(Boolean);
  if(!allowedHosts.includes(requestHost)&&!allowedHosts.includes('*'))bad('当前服务未开放此访问地址',403);
  const forwardedProto=String(req.headers['x-forwarded-proto']||'http').split(',')[0].trim().toLowerCase();
  const requestOrigin=`${forwardedProto==='https'?'https':'http'}://${req.headers.host}`;
  if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==requestOrigin)bad('不允许跨站提交',403);
  const url=new URL(req.url,`http://${req.headers.host}`), path=url.pathname;
  if(req.method==='POST'&&/^\/api\/tasks\/[^/]+\/products$/.test(path)){let data;try{data=await(await body(req)).json();}catch{bad('请求格式不正确');}return json(await additions.append(decodeURIComponent(path.split('/')[3]),data),201);}
  if(req.method==='GET'&&path==='/api/health')return json({ok:true,app:'render-assistant-local',...(process.env.APP_ACCEPTANCE_INSTANCE?{acceptanceInstance:process.env.APP_ACCEPTANCE_INSTANCE}:{})});
  if(path==='/api/acceptance'&&req.method==='GET')return json(acceptance.snapshot());
  if(path==='/api/acceptance/run'&&req.method==='POST')return json(acceptance.start());
  const actor=auth.actor(req),input=async()=>{try{return await(await body(req)).json();}catch{bad('请求格式不正确');}};
  if(path.startsWith('/api/transparent/')){
   const [,,,id,action]=path.split('/');
   if(req.method==='GET'&&!action)return json({...transparent.page(id),actor});
   if(req.method==='POST'){
    const value=await input();if(!value||typeof value!=='object')bad('请求格式不正确');
    if(action==='prepare')return json(await transparent.prepare(id,value),201);
    if(action==='review')return json(transparent.review(id,value,actor));
    if(action==='activate')return json(await transparent.activate(id,value,actor));
   }bad('透明母版接口不存在',404);
  }
  if(path==='/transparent-ui.js'&&req.method==='GET'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(readFileSync(join(root,'public/transparent-ui.js')));}
  if(path==='/automatic-ui.js'&&req.method==='GET'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(readFileSync(join(root,'public/automatic-rounds-ui.js')));}
  if(path==='/target-options.js'&&req.method==='GET'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(readFileSync(join(root,'public/target-options.js')));}
  if(path==='/placement-transform.js'&&req.method==='GET'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(readFileSync(join(root,'public/placement-transform.js')));}
  if(path==='/transparent.css'&&req.method==='GET'){res.setHeader('Content-Type','text/css; charset=utf-8');return res.end(readFileSync(join(root,'public/transparent.css')));}
  if(path.startsWith('/api/automatic/')){const id=path.split('/')[3];
   if(req.method==='POST'&&path.endsWith('/target-options'))return json(automatic.saveTargetOptions(id,await input(),actor),201);
   if(req.method==='GET'&&path.endsWith('/delivery')){const out=await automatic.delivery(id,path.split('/')[4]);res.setHeader('Content-Type','image/png');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(out.fileName)}`);return res.end(out.bytes);}
   if(req.method==='GET'&&path.endsWith('/round-export')){const raw=url.searchParams.get('version');if(raw===null)bad('请选择导出轮次');const out=await automatic.exportRound(id,Number(raw));res.setHeader('Content-Type','application/zip');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(out.fileName)}`);return res.end(out.bytes);}
   if(req.method==='POST'&&path.endsWith('/requirements'))return json(automatic.saveRequirements(id,await input(),actor),201);
   if(req.method==='GET')return json(automatic.page(id));if(req.method==='POST'&&path.endsWith('/generate'))return json(await automatic.generate(id,await input(),actor),201);if(req.method==='POST'&&path.endsWith('/selection'))return json(automatic.selection(id,await input(),actor));}
  if(path==='/api/ai/status')return json(ai.status());
  if(path.startsWith('/api/ai/surface/')){const id=path.split('/')[4];if(req.method==='GET')return json(ai.surface(id));if(req.method==='POST')return json(ai.saveSurface(id,await input(),actor));}
  if(path.startsWith('/api/ai/tasks/')){const id=path.split('/')[4];if(req.method==='POST'&&path.endsWith('/preview'))return json(await ai.preview(id,await input()));if(req.method==='GET')return json(ai.page(id));if(req.method==='POST')return json(await ai.create(id,await input()),201);}
  if(path.startsWith('/api/task-products/')){const [,,,taskId,id]=path.split('/');if(req.method==='GET')return json(taskProducts.preview(taskId,id));if(req.method==='POST')return json(taskProducts.change(taskId,id,await input(),actor));}
  if(path.startsWith('/api/manage/products/')){const [,,,,id,action]=path.split('/');if(req.method==='GET')return json(await management.getProduct(id));if(req.method==='POST'&&action==='image'){const form=await(await body(req)).formData();return json(await management.updateImage(id,form.get('image'),{baseRevision:Number(form.get('baseRevision')),confirmTemplateRisk:form.get('confirmTemplateRisk')==='true'},actor),201);}if(req.method==='POST')return json(await management.editProduct(id,await input(),actor));}
  if(path.startsWith('/api/manage/tasks/')){const [,,,,id,action]=path.split('/');if(req.method==='GET'&&action==='delete-preview')return json(disk.preview(id));if(req.method==='POST'){const v=await input();if(action==='lifecycle')return json(management.changeLifecycle(id,v,actor));if(action==='environment')return json(management.markTest(id,v,actor));if(action==='delete')return json(disk.deleteTask(id,v,actor));}}
  if(path==='/api/manage/storage'&&req.method==='GET')return json(disk.storagePage());
  if(path==='/api/manage/storage/zip'&&req.method==='POST')return json(disk.cleanZip(await input(),actor));
  if(path==='/api/rule-auth'){
   if(req.method==='GET')return json(actor);
   if(req.method==='POST')return json(auth.login(await input(),res));
   if(req.method==='DELETE')return json(auth.logout(req,res));
  }
  if(path==='/api/render'&&req.method==='POST')return json(await mockups.render(await input()),201);
  if(path==='/api/batch-summary'&&req.method==='GET'){const all=[];for(const t of db.prepare('SELECT id FROM Task').all()){const r=await batches.results(t.id);all.push({taskId:t.id,counts:r.counts,total:r.results.length,allComplete:r.allComplete});}return json(all);}
  if(path.startsWith('/api/batch/')){const [, , ,taskId,action,id]=path.split('/');
   if(req.method==='GET'&&!action)return json(await batches.page(taskId));
   if(req.method==='GET'&&action==='results')return json(await batches.results(taskId));
   if(req.method==='GET'&&action==='image'){const out=batches.downloadImage(taskId,id);res.setHeader('Content-Type','image/png');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(out.fileName)}`);return res.end(out.bytes);}
   if(req.method==='GET'&&action==='exports'){const out=batches.download(taskId,id);res.setHeader('Content-Type','application/zip');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(out.fileName)}`);return res.end(out.bytes);}
   if(req.method==='POST'){const v=await input();
    if(action==='preflight')return json(await batches.create(taskId,v),201);
    if(action==='start')return json(batches.start(taskId,id));
    if(action==='confirm')return json(await batches.confirm(taskId,id,v,actor));
    if(action==='retry')return json(await batches.retry(taskId,id));
    if(action==='skip')return json(batches.skip(taskId,id));
    if(action==='style')return json(batches.updateLogo(taskId,v,actor),201);
    if(action==='approve')return json(await batches.approve(taskId,v,actor));
    if(action==='export')return json(await batches.exportZip(taskId,v),201);
   }bad('批量接口不存在',404);
  }
  if(path.startsWith('/api/workspace/')){const [, , ,taskId,action]=path.split('/');
   if(req.method==='GET'&&!action)return json(await mockups.page(taskId));
   if(req.method==='POST'){const v=await input();
    if(action==='draft')return json(await mockups.save(taskId,v));
    if(action==='first')return json(mockups.selectFirst(taskId,v));
    if(action==='preflight')return json(await mockups.preflight(taskId,v),201);
    if(action==='review')return json(await mockups.review(taskId,v,actor));
   }bad('工作台接口不存在',404);
  }
  if(path==='/api/rules/meta')return json({processes:PROCESSES,fields:FIELDS,operators:OPERATORS,policies:rules.policies(),actor});
  if(path==='/api/rules'){
   if(req.method==='GET')return json(rules.list());
   if(req.method==='POST'){auth.requireRole(actor,['ADMIN']);return json(rules.publish(await input(),actor),201);}
  }
  if(path.startsWith('/api/rules/')){const id=path.split('/')[3];
   if(req.method==='GET')return json(rules.getRule(id));
   if(req.method==='DELETE'){auth.requireRole(actor,['ADMIN']);return json(rules.remove(id,actor));}
   if(req.method==='POST'&&path.endsWith('/toggle')){auth.requireRole(actor,['ADMIN']);return json(rules.toggle(id,await input(),actor));}
  }
  if(path==='/api/rule-policies'&&req.method==='POST'){auth.requireRole(actor,['ADMIN']);return json(rules.updatePolicy(await input(),actor));}
  if(path.startsWith('/api/product-rule-profile/')&&req.method==='POST'){auth.requireRole(actor,['ADMIN','DESIGNER']);return json(rules.saveProfile(path.split('/')[3],await input(),actor));}
  if(path.startsWith('/api/logo-rule-facts/')&&req.method==='POST'){auth.requireRole(actor,['ADMIN','DESIGNER']);return json(rules.saveFacts(path.split('/')[3],await input(),actor));}
  if(path.startsWith('/api/rule-review/')){const [, , ,taskId,action,id]=path.split('/');
   if(req.method==='GET'&&!action)return json(await rules.taskPage(taskId));
   if(req.method==='GET'&&action==='history'){const r=rules.run(id);if(r.taskId!==taskId)bad('评估不属于当前任务',404);return json(r);}
   if(req.method==='POST'){const v=await input();
    if(action==='evaluate')return json(await rules.evaluate({...v,taskId}),201);
    if(action==='confirm')return json(await rules.confirm(taskId,v,actor));
    if(action==='gate')return json(await rules.gate(taskId,v.taskProductId,v.evaluationId));
   }
   bad('预审接口不存在',404);
  }
  if(path.startsWith('/api/logo/')){
   const [, , ,taskId,action,itemId]=path.split('/');
   if(req.method==='GET'&&!action)return json(logos.get(taskId));
   if(req.method==='POST'&&action==='sources'){const form=await(await body(req)).formData();return json(await logos.uploadSource(taskId,form.get('file'),form.get('baseVersion')),201);}
   if(req.method==='DELETE'&&action==='elements')return json(logos.archive(taskId,itemId));
   if(req.method==='POST'){let input;try{input=await(await body(req)).json();}catch{bad('请求格式不正确');}
    if(action==='elements')return json(logos.element(taskId,input),201);
    if(action==='preview')return json(await logos.preview(taskId,input));
    if(action==='productions')return json(await logos.save(taskId,input),201);
    if(action==='activate')return json(logos.activate(taskId,input.id));
   }
   bad('Logo 接口不存在',404);
  }
  if(path.startsWith('/api/templates/')) {
   const productId=path.slice('/api/templates/'.length);
   if(req.method==='GET')return json(templates.get(productId,url.searchParams.get('version')));
   if(req.method==='POST') {
    let input;try{input=await(await body(req)).json();}catch(e){if(e.status)throw e;bad('母版数据格式不正确');}
    return json(await templates.publish(productId,input),201);
   }
  }
  if(req.method==='GET'&&path==='/api/products')return json(products(url.searchParams.get('q')||'',url.searchParams.get('includeInactive')==='1'));
  if(req.method==='POST'&&path==='/api/products') {
   const form=await(await body(req)).formData(); const code=sku(form.get('sku')), name=field(form.get('name'),'产品名称',120), category=field(form.get('category'),'产品类别',60);
   if(db.prepare('SELECT id FROM Product WHERE sku=?').get(code))bad('该 SKU 已存在，请使用不同的 SKU',409);
   const f=await upload(form.get('image')), id=uid(), stamp=now();
   try { db.prepare('INSERT INTO Product VALUES (?,?,?,?,?,?,?)').run(id,code,name,category,f.key,stamp,stamp); }catch(e){storage.remove(f.key);if(String(e).includes('UNIQUE'))bad('该 SKU 已存在',409);throw e;}
   return json({id,sku:code},201);
  }
  if(req.method==='POST'&&path==='/api/products/batch') {
   const input=await(await body(req)).json(); const raw=field(input.skus,'SKU 列表',10000);
   const codes=[...new Set(raw.split(/[\s,，;；]+/).filter(Boolean).map(x=>x.toUpperCase()))]; if(codes.length>200)bad('每次最多查询 200 个 SKU');
   const found=[],missing=[]; for(const c of codes) {const p=db.prepare('SELECT * FROM Product WHERE sku=?').get(c);p&&management.info(p.id).status==='ACTIVE'?found.push(p):missing.push(c);} return json({found,missing});
  }
  if(req.method==='GET'&&path==='/api/tasks'){const rows=db.prepare('SELECT t.*, (SELECT COUNT(*) FROM TaskProduct tp WHERE tp.taskId=t.id AND NOT EXISTS (SELECT 1 FROM TaskProductLifecycle l WHERE l.taskProductId=tp.id AND l.lifecycle=\'REMOVED\')) AS productCount FROM Task t ORDER BY t.createdAt DESC').all().map(t=>({...t,management:management.lifecycle(t.id)})),filter=url.searchParams.get('lifecycle');return json(rows.filter(t=>filter==='ALL'||(filter?t.management.lifecycle===filter:t.management.lifecycle!=='ARCHIVED')));}
  if(req.method==='GET'&&path.startsWith('/api/tasks/'))return json(detail(path.slice(11)));
  if(req.method==='POST'&&path==='/api/tasks') {
   const form=await(await body(req)).formData(); const customer=field(form.get('customerName'),'客户名称',120), requirement=field(form.get('rawRequirement')||'','客户要求',5000,false);
   let values; try{values=JSON.parse(form.get('productIds'));}catch{bad('请选择产品');}
   if(!Array.isArray(values)||!values.length||values.length>200||values.some(x=>typeof x!=='string'))bad('请选择 1–200 个产品');
   const ids=[...new Set(values)];for(const id of ids)if(!db.prepare('SELECT id FROM Product WHERE id=?').get(id))bad('所选产品不存在，请重新选择');
   const logo=await upload(form.get('logo'));let prepared;try{prepared=await logos.prepareSource(logo.key,logo.name);return json(await addTask(customer,requirement,ids,logo,prepared),201);}catch(e){storage.remove(logo.key);if(prepared)storage.remove(prepared.previewPath);throw e;}
  }
  if(req.method==='GET'&&path.startsWith('/files/')) {
   const key=path.slice(7);let bytes;try{bytes=storage.get(key);}catch{bad('文件不存在',404);}
   const ext=key.split('.').pop();res.setHeader('Content-Type',ext==='jpg'?'image/jpeg':`image/${ext}`);
   if(ext==='svg'){res.setHeader('Content-Type','image/svg+xml');res.setHeader('Content-Disposition','attachment');res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");}
   if(url.searchParams.has('download')) {const logo=db.prepare('SELECT fileName FROM OriginalLogoVersion WHERE filePath=?').get(key)||db.prepare('SELECT fileName FROM LogoAsset WHERE filePath=?').get(key);res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(logo?.fileName||key)}`);}
   return res.end(bytes);
  }
  if(req.method==='GET'&&['/acceptance.html','/acceptance-bootstrap.js','/acceptance-ui.js','/acceptance.css'].includes(path)) {
   const file=path.slice(1);res.setHeader('Content-Type',mime[file.slice(file.lastIndexOf('.'))]);return res.end(readFileSync(join(root,'public',file)));
  }
  if(path==='/pantone-ui.js'&&req.method==='GET'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(readFileSync(join(root,'public/pantone-ui.js')));}
  if(path==='/pantone-colors.json'&&req.method==='GET'){res.setHeader('Content-Type','application/json; charset=utf-8');return res.end(readFileSync(join(root,'public/data/pantone-colors.json')));}
  if(req.method==='GET') {
    const assets={'/acceptance.html':'acceptance.html','/acceptance-ui.js':'acceptance-ui.js','/acceptance.css':'acceptance.css','/automatic-ui.js':'automatic-ui.js','/auto-placement.js':'auto-placement.js','/template-automation-ui.js':'template-automation-ui.js','/':'index.html','/app.js':'app.js','/style.css':'style.css','/favicon.svg':'favicon.svg','/template-editor.js':'template-editor.js','/template.css':'template.css','/logo-editor.js':'logo-editor.js','/logo.css':'logo.css','/rule-ui.js':'rule-ui.js','/rule.css':'rule.css','/workspace.js':'workspace.js','/workspace.css':'workspace.css','/batch-ui.js':'batch-ui.js','/batch.css':'batch.css','/mockup-geometry.js':'mockup-geometry.js','/zone-geometry.js':'zone-geometry.js','/task-additions.js':'task-additions.js','/additions.css':'additions.css','/ai-ui.js':'ai-ui.js','/sku-management.js':'sku-management.js','/management-ui.js':'management-ui.js','/management.css':'management.css'};
   const file=assets[path];if(!file)bad('页面不存在',404);
   res.setHeader('Content-Type',mime[file.slice(file.lastIndexOf('.'))]);return res.end(readFileSync(join(root,'public',file)));
  }
  bad('接口不存在',404);
 }catch(e){ if(!e.status)console.error(e);json({error:e.status?e.message:'保存或读取失败，请重试；若持续失败请检查运行日志'},e.status||500); }finally{if(writing)activeWrites--;}
});
const bindHost=process.env.HOST||'127.0.0.1';
server.listen(Number(process.env.PORT||3210),bindHost,()=>console.log(`AI效果图智能助理 http://${bindHost==='0.0.0.0'?'127.0.0.1':bindHost}:${server.address().port}`));
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'端口已占用：请使用已启动的页面，或设置 PORT 后重试。':e);process.exit(1);});
function stop(){server.close(()=>{db.close();process.exit(0);});}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
