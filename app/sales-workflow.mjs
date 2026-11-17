import {logoContent} from './logo-content.mjs';
import {validateManualPlacement} from './public/manual-placement.js';
import {normalizeAreaOverrides,regionChoices,regionChoiceSignature} from './region-sales.mjs';
import {prepareRegional} from './region-render.mjs';
import {manufacturingAllowed} from './region-printing.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {sharp} from './logo-pixels.mjs';
import {tintCarrierLogo} from './carrier-colors.mjs';
import {autoPlace} from './public/auto-placement.js';
import {visibilityCheck} from './visibility-check.mjs';
import {activeSql,assertActive} from './task-products.mjs';
import {PRINT_METHODS,FOIL_EFFECTS} from './printing-settings.mjs';
import {appearanceName,outputFileNames,safeFilePart} from './output-names.mjs';
import {renderCustomerImage} from './customer-delivery.mjs';
import {zipStore} from './zip.mjs';
const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
const now=()=>new Date().toISOString(),fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const kinds=['ORIGINAL','INK','FOIL'],key=(id,kind)=>id+':'+kind;
export function normalizeSalesDraft(v,items){
 if(!v||!Array.isArray(v.schemes)||v.schemes.length>3||v.schemes.some(s=>!kinds.includes(s)))fail('出图方案无效');
 if(v.foilTargets!==undefined&&(!Array.isArray(v.foilTargets)||!v.foilTargets.length||v.foilTargets.length>2||v.foilTargets.some(t=>!['PRODUCT','CARTON'].includes(t))))fail('请至少选择产品或彩盒作为烫印区域');
 if(v.foil!==null&&v.foil!==undefined&&!Object.hasOwn(FOIL_EFFECTS,v.foil))fail('请选择有效烫印颜色');
 if(!Array.isArray(v.productIds)||v.productIds.length>200||v.productIds.some(id=>!items.some(i=>i.id===id)))fail('包含已移除或不属于任务的产品');
 const overrides={};if(v.overrides!==undefined&&(typeof v.overrides!=='object'||v.overrides===null||Array.isArray(v.overrides)))fail('图片调整格式无效');
 for(const [k,o] of Object.entries(v.overrides||{})){
  if(!items.some(i=>kinds.some(s=>key(i.id,s)===k))||!o||typeof o!=='object')fail('图片调整不属于本任务');
  const item=items.find(i=>kinds.some(kind=>key(i.id,kind)===k));
  if(item.regionVersion===2){if(o.process||o.appearance)fail('请分别调整产品或彩盒区域');overrides[k]={areas:normalizeAreaOverrides(o.areas,item.targets.map(t=>t.area.id))};continue;}
  if(o.process&&!Object.hasOwn(PRINT_METHODS,o.process))fail('实际工艺无效');
  if(o.appearance){const a=o.appearance;if(!['ORIGINAL','SOLID','FOIL'].includes(a.mode))fail('颜色方案无效');if(a.mode==='SOLID'&&!/^#[0-9a-f]{6}$/i.test(a.hex||''))fail('请填写有效的六位颜色值');if(a.mode==='FOIL'&&!FOIL_EFFECTS[a.foil])fail('烫印颜色无效');}
  overrides[k]={...(o.process?{process:o.process}:{}),...(o.appearance?{appearance:o.appearance.mode==='ORIGINAL'?{mode:'ORIGINAL'}:o.appearance.mode==='SOLID'?{mode:'SOLID',hex:o.appearance.hex.toLowerCase()}:{mode:'FOIL',foil:o.appearance.foil}}:{})};
 }
 return {schemes:kinds.filter(k=>v.schemes.includes(k)),foil:v.foil||null,...(v.foilTargets?{foilTargets:['PRODUCT','CARTON'].filter(t=>v.foilTargets.includes(t))}:{}),productIds:[...new Set(v.productIds)],overrides};
}

export function salesOutputLabels(snapshot){
 if(snapshot.regionVersion!==2)return {appearanceName:appearanceName(snapshot.appearance)};
 const sections=[],short=[];
 for(const carton of [false,true]){
  const targets=snapshot.targets.filter(t=>(t.carrierType==='CARTON')===carton);if(!targets.length)continue;
  const group=carton?'彩盒':'产品',names=[...new Set(targets.map(t=>appearanceName(t.appearance)))],facts=targets.map(t=>(PRINT_METHODS[t.processType]||t.processType)+' · '+appearanceName(t.appearance)),same=facts.every(f=>f===facts[0]);
  short.push(group+'：'+(names.length===1?names[0]:'混合效果'));
  sections.push(group+'：'+(same?facts[0]:targets.map((t,i)=>(t.areaName||'区域 '+(i+1))+' '+facts[i]).join('；')));
 }
 return {appearanceName:short.join(' / '),actualDescription:sections.join('　/　')};
}

export function salesWorkflow(db,storage,rules,printing,transparent,isOtherBusy=()=>false,delivery=null){
 db.exec(`CREATE TABLE IF NOT EXISTS SalesWorkspace(id TEXT PRIMARY KEY,taskId TEXT NOT NULL UNIQUE REFERENCES Task(id) ON DELETE CASCADE,revision INTEGER NOT NULL,draftJson TEXT NOT NULL,currentJson TEXT NOT NULL,updatedAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS SalesRun(id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES Task(id) ON DELETE CASCADE,round INTEGER NOT NULL,status TEXT NOT NULL,inputJson TEXT NOT NULL,reportJson TEXT NOT NULL,createdAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS SalesOutput(id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES Task(id) ON DELETE CASCADE,taskProductId TEXT NOT NULL REFERENCES TaskProduct(id) ON DELETE CASCADE,runId TEXT NOT NULL REFERENCES SalesRun(id) ON DELETE CASCADE,kind TEXT NOT NULL,version INTEGER NOT NULL,imagePath TEXT NOT NULL,snapshotJson TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(taskProductId,kind,version));
 CREATE TABLE IF NOT EXISTS SalesExport(id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES Task(id) ON DELETE CASCADE,manifestJson TEXT NOT NULL,filePath TEXT NOT NULL,fileName TEXT NOT NULL,sha256 TEXT NOT NULL,createdAt TEXT NOT NULL);`);
 db.prepare("UPDATE SalesRun SET status='INTERRUPTED' WHERE status='RUNNING'").run();
 const busy=new Set();
 const task=id=>{const t=db.prepare('SELECT * FROM Task WHERE id=?').get(id);if(!t)fail('任务不存在',404);return t;};
 function availableTemplate(item){return db.prepare('SELECT t.id,t.version FROM ProductTemplate t JOIN TaskProductSnapshot s ON s.taskProductId=? JOIN ProductImageVersion im ON im.id=s.productImageVersionId WHERE t.productId=? AND t.isCurrent=1 AND t.standardImage=im.imagePath').get(item.id,item.productId)||null;}
 const items=id=>db.prepare(`SELECT tp.id,tp.productId,COALESCE(s.sku,p.sku) sku,COALESCE(s.name,p.name) name,COALESCE(t.standardImage,p.standardImage) standardImage,t.id templateId,t.version templateVersion FROM TaskProduct tp JOIN Product p ON p.id=tp.productId LEFT JOIN TaskProductSnapshot s ON s.taskProductId=tp.id LEFT JOIN TaskProductTemplate b ON b.taskProductId=tp.id LEFT JOIN ProductTemplate t ON t.id=b.templateId WHERE tp.taskId=? AND ${activeSql('tp')} ORDER BY tp.rowid`).all(id).map(i=>{let plan;try{plan=basePlan(i);}catch{}return {...i,availableTemplate:availableTemplate(i),printing:printing.get(i.productId),regionVersion:plan?.definition.version||1,targets:plan?.targets||[],zones:plan?.zones||[]};});
 const state=id=>{
  const r=db.prepare('SELECT * FROM SalesWorkspace WHERE taskId=?').get(id);
  if(r){const draft=JSON.parse(r.draftJson),active=items(id).map(i=>i.id);draft.productIds=draft.productIds.filter(i=>active.includes(i));draft.overrides=Object.fromEntries(Object.entries(draft.overrides||{}).filter(([k])=>active.some(i=>k.startsWith(i+':'))));return {revision:r.revision,draft,current:JSON.parse(r.currentJson)};}
  return {revision:0,draft:{schemes:['ORIGINAL'],foil:null,productIds:items(id).map(i=>i.id),overrides:{}},current:[]};
 };
 const outputs=id=>db.prepare('SELECT * FROM SalesOutput WHERE taskId=? ORDER BY rowid DESC').all(id).map(o=>({...o,snapshot:JSON.parse(o.snapshotJson)}));
 function assertEditable(id){task(id);if(db.prepare('SELECT lifecycle FROM TaskManagement WHERE taskId=?').get(id)?.lifecycle==='ARCHIVED')fail('请先恢复已归档任务');if(busy.has(id)||isOtherBusy(id))fail('任务正在处理，请等待完成',409);}
 async function save(id,v){assertEditable(id);const old=state(id);if(v.baseRevision!==old.revision)fail('任务选择已变化，请刷新后再保存',409);const list=items(id),draft=normalizeSalesDraft(v,list);for(const item of list.filter(i=>i.regionVersion===2)){const overrides=Object.entries(draft.overrides).filter(([k])=>k.startsWith(item.id+':'));if(!overrides.some(([,o])=>Object.values(o.areas).some(a=>a.placement)))continue;let logo=db.prepare('SELECT width,height,filePath FROM ProductionLogo WHERE id=?').get(task(id).activeProductionLogoId);if(!logo)fail('请先完成 Logo 处理再调整摆放');logo=await logoContent(storage.get(logo.filePath),logo);const m=await sharp(storage.get(item.standardImage)).rotate().metadata(),image={width:m.autoOrient?.width||m.width,height:m.autoOrient?.height||m.height};for(const [,o] of overrides)for(const [areaId,a] of Object.entries(o.areas)){if(!a.placement)continue;const errors=validateManualPlacement(a.placement,item.zones,image,logo);if(errors.length)fail((item.targets.find(t=>t.area.id===areaId)?.area.name||'区域')+'：'+errors.join('；'));}}
 assertEditable(id);if(state(id).revision!==old.revision)fail('任务选择已变化，请刷新后再保存',409);db.prepare('INSERT INTO SalesWorkspace VALUES (?,?,?,?,?,?) ON CONFLICT(taskId) DO UPDATE SET revision=excluded.revision,draftJson=excluded.draftJson,updatedAt=excluded.updatedAt').run(id,id,old.revision+1,JSON.stringify(draft),JSON.stringify(old.current),now());return state(id);}
 function outputStatus(o,id){try{const t=task(id);assertActive(db,o.taskProductId);if(t.activeProductionLogoId!==o.snapshot.logoId)return 'Logo 已变化';if(hash(storage.get(o.imagePath))!==o.snapshot.outputSha)return '图片文件缺失或损坏';if(o.snapshot.regionVersion===2){const item=items(id).find(i=>i.id===o.taskProductId);if(!item||item.templateId!==o.snapshot.templateId)return '母版已变化，请重新生成';for(const t of o.snapshot.targets){const errors=validateManualPlacement(t.placement,item.zones,o.snapshot.image,o.snapshot.logoSize);if(errors.length)return errors.join('；');}return regionChoiceSignature(item,o.kind,state(id).draft)===o.snapshot.choiceSignature?null:'设置已更改，待重新生成';}const p=printing.get(o.snapshot.productId);if(p.version!==o.snapshot.printingVersion||o.snapshot.targets.some(z=>!p.allowed.includes(z.processType)))return '产品工艺已调整，请重新确认';const draft=state(id).draft,item=items(id).find(i=>i.id===o.taskProductId),choice=resolve(item,o.kind,draft);if(JSON.stringify(choice.appearance)!==JSON.stringify(o.snapshot.appearance)||o.snapshot.targets.some(z=>z.processType!==choice.process))return '设置已更改，待重新生成';return null;}catch(e){return e.message;}}
 async function page(id){const t=task(id),st=state(id),list=items(id),out=outputs(id),current=st.current.map(k=>out.find(o=>o.id===k)).filter(o=>o&&list.some(i=>i.id===o.taskProductId)&&st.draft.productIds.includes(o.taskProductId)&&st.draft.schemes.includes(o.kind)).map(o=>({...o,unavailableReason:outputStatus(o,id)}));const names=outputFileNames(current);
  const logoPage=t.activeProductionLogoId?null:transparent.page(id),master=logoPage?.masters.find(m=>m.sourceId===logoPage.sources[0]?.id),logoIssue=master&&master.status!=='READY'?{code:'LOGO_REVIEW',reason:master.details.reason||master.reviewNote||'上次 Logo 背景处理尚未完成',canReprocess:master.canReprocess}:null;
  const logoRow=t.activeProductionLogoId?db.prepare('SELECT id,filePath,width,height FROM ProductionLogo WHERE id=?').get(t.activeProductionLogoId):null;
  return {logoIssue,logo:logoRow?await logoContent(storage.get(logoRow.filePath),logoRow):null,task:{id,customerName:t.customerName,taskCode:t.taskCode,activeProductionLogoId:t.activeProductionLogoId},items:list,state:st,busy:busy.has(id)||isOtherBusy(id),current:current.map(o=>({...o,fileName:names.get(o.id),...salesOutputLabels(o.snapshot)})),history:out,methods:PRINT_METHODS,foils:FOIL_EFFECTS,runs:db.prepare('SELECT * FROM SalesRun WHERE taskId=? ORDER BY rowid DESC').all(id).map(r=>({...r,report:JSON.parse(r.reportJson)}))};
 }
 function resolve(item,kind,draft){if(kind==='FOIL'&&draft.foilTargets?.includes('CARTON'))fail('请设计师先在母版中区分产品与彩盒区域，再选择彩盒烫印');const p=item.printing,o=draft.overrides[key(item.id,kind)]||{};if(!p.version)fail('请设计师先设置该产品的适用工艺、默认工艺与黑白油墨色');const process=o.process||(kind==='FOIL'?'HOT_STAMP':p.defaultProcess);if(!p.allowed.includes(process))fail('不支持'+(PRINT_METHODS[process]||process)+'，请与设计师或印刷车间确认工艺可行性');
  const appearance=o.appearance||(kind==='ORIGINAL'?{mode:'ORIGINAL'}:kind==='INK'?{mode:'SOLID',hex:p.ink==='WHITE'?'#ffffff':'#000000'}:{mode:'FOIL',foil:draft.foil});
  if(kind!=='FOIL'&&process==='HOT_STAMP'&&!o.process)fail('该产品默认工艺为烫印，请明确选择烫印方案及颜色');
  if(process==='HOT_STAMP'&&appearance.mode!=='FOIL'||appearance.mode==='FOIL'&&process!=='HOT_STAMP')fail('烫印颜色与实际工艺不一致，请选择烫印工艺或调整颜色方案');
  if(appearance.mode==='FOIL'&&!FOIL_EFFECTS[appearance.foil])fail('请选择烫印颜色');
  return {process,appearance,color:appearance.mode==='ORIGINAL'?null:appearance.mode==='SOLID'?appearance.hex:FOIL_EFFECTS[appearance.foil].hex};
 }
 function basePlan(item){if(!item.templateId)fail(item.availableTemplate?'加入任务时尚未发布母版，现有 V'+item.availableTemplate.version+'。请点击产品标题下的「关联已发布母版」后重试。':'此任务尚未关联已发布母版，请设计师先在原产品图上保存并发布母版。');const row=db.prepare('SELECT definitionJson FROM TemplateAutomation WHERE templateId=?').get(item.templateId),definition=row?JSON.parse(row.definitionJson):null;const scheme=definition?.schemes.find(s=>s.role==='DEFAULT');if(!scheme)fail('锁定母版缺少默认摆放方案，请联系设计师');const zones=db.prepare('SELECT * FROM TemplateZone WHERE templateId=? ORDER BY rowid').all(item.templateId);const targets=scheme.targets.map(t=>{const area=definition.areas.find(a=>a.id===t.areaId),preset=area?.presets.find(p=>p.id===t.presetId),zone=zones.find(z=>z.id===area?.zoneId);if(!area?.autoEligible||!preset||!zone)fail('母版默认区域或摆放预设失效');return {area,preset,zone,carrier:definition.carriers.find(c=>c.id===area.carrierId)};});return {definition,scheme,zones,targets};}
 function requestedRows(id,draft,onlyKeys){const list=items(id);if(!draft.productIds.length||!draft.schemes.length)fail('请至少选择一个产品和一种出图方案');const all=list.filter(i=>draft.productIds.includes(i.id)).flatMap(item=>draft.schemes.map(kind=>({item,kind,key:key(item.id,kind)})));if(onlyKeys!==undefined&&(!Array.isArray(onlyKeys)||!onlyKeys.length||onlyKeys.some(k=>!all.some(r=>r.key===k))))fail('调整范围包含未选择的产品或方案');return onlyKeys?all.filter(r=>onlyKeys.includes(r.key)):all;}
 async function preflight(id,v){task(id);const st=state(id);if(v.baseRevision!==st.revision)fail('选择已变化，请刷新',409);const good=[],issues=[];
  for(const row of requestedRows(id,st.draft,v.onlyKeys)){try{const plan=basePlan(row.item);
   if(plan.definition.version===2){regionChoices(plan,row.item,row.kind,st.draft);if(task(id).activeProductionLogoId)await prepareRegional({db,storage,rules,task:task(id),item:row.item,kind:row.kind,draft:st.draft,plan});}
   else{const choice=resolve(row.item,row.kind,st.draft);if(task(id).activeProductionLogoId)for(const target of plan.targets){const r=await rules.calculateManufacturing({taskId:id,taskProductId:row.item.id,processType:choice.process,selectedTemplateAreaId:target.zone.id},choice.color,choice.appearance.foil);if(r.overallStatus!=='PASS'||r.testOnly)fail(r.messages.join('；'));}}
   good.push({key:row.key,taskProductId:row.item.id,sku:row.item.sku,kind:row.kind});
  }catch(e){issues.push({key:row.key,taskProductId:row.item.id,sku:row.item.sku,kind:row.kind,reason:e.message,issueType:e.issueType||null,...(e.detail?{detail:e.detail}:{})});}}
  return {revision:st.revision,good,issues,needsLogo:!task(id).activeProductionLogoId};
 }
 async function ensureLogo(id,actor){let p=transparent.page(id);if(p.activeProductionLogoId)return;const source=p.sources[0];if(!source)fail('请先上传客户 Logo');p=await transparent.prepare(id,{sourceId:source.id});const master=p.masters.find(m=>m.sourceId===source.id);if(master?.status!=='READY')fail('Logo 背景需要确认：'+(master?.details.reason||master?.reviewNote||'无法可靠区分背景与图形')+'。请打开 Logo 处理，确认后再开始做图。');await transparent.activate(id,{masterId:master.id,expectedActiveProductionLogoId:null},actor);}
 async function prepareImage(id,row,draft){if(row.item.regionVersion===2)return prepareRegional({db,storage,rules,task:task(id),item:row.item,kind:row.kind,draft,plan:basePlan(row.item)});const t=task(id),item=row.item,choice=resolve(item,row.kind,draft),plan=basePlan(item),logo=db.prepare('SELECT * FROM ProductionLogo WHERE id=? AND taskId=?').get(t.activeProductionLogoId,id);if(!logo)fail('缺少生产 Logo');
  const base=storage.get(item.standardImage),logoBytes=storage.get(logo.filePath),meta=await sharp(base).rotate().metadata(),image={width:meta.autoOrient?.width||meta.width,height:meta.autoOrient?.height||meta.height},variant=choice.color?await tintCarrierLogo(logoBytes,choice.color):null,usedLogo=variant?.png||logoBytes,targets=[];
  const pinned=db.prepare('SELECT i.sha256 FROM TaskProductSnapshot s JOIN ProductImageVersion i ON i.id=s.productImageVersionId WHERE s.taskProductId=?').get(item.id);if(pinned&&pinned.sha256!==hash(base))fail('锁定产品图与母版底图不一致，请设计师确认');
  for(const target of plan.targets){const check=await rules.calculateManufacturing({taskId:id,taskProductId:item.id,processType:choice.process,selectedTemplateAreaId:target.zone.id},choice.color,choice.appearance.foil);if(!manufacturingAllowed(check,target.cartonFoilConfirmed))fail(check.messages.join('；'));targets.push({areaId:target.area.id,areaName:target.area.name,carrierId:target.area.carrierId,carrierName:target.carrier?.name,carrierType:target.carrier?.type,zoneId:target.zone.id,processType:choice.process,logoColor:choice.color,placement:autoPlace(target.zone,target.preset,plan.zones,image,logo),ruleFingerprint:check.fingerprint,ruleChecks:check});}
  const snapshot={taskId:id,taskProductId:item.id,productId:item.productId,customerName:t.customerName,sku:item.sku,productName:item.name,templateId:item.templateId,templateVersion:item.templateVersion,layoutSchemeId:plan.scheme.id,logoId:logo.id,logoPath:logo.filePath,imagePath:item.standardImage,imageSha:hash(base),logoSha:hash(logoBytes),printingVersion:item.printing.version,kind:row.kind,appearance:choice.appearance,targets,carrierProcesses:targets.map(z=>({...z,foilEffect:choice.appearance.foil})),mode:'2D_LOCAL',createdAt:now()};
  const fingerprint=hash({...snapshot,createdAt:undefined,targets:targets.map(({ruleChecks,...r})=>r)});return {snapshot,fingerprint,base,logo,usedLogo,image};
 }
 async function validatePrepared(id,p){assertActive(db,p.snapshot.taskProductId);if(task(id).activeProductionLogoId!==p.snapshot.logoId||hash(storage.get(p.snapshot.imagePath))!==p.snapshot.imageSha||hash(storage.get(p.snapshot.logoPath))!==p.snapshot.logoSha||(p.snapshot.regionVersion!==2&&printing.get(p.snapshot.productId).version!==p.snapshot.printingVersion))fail('生成期间产品或 Logo 资料发生变化，请重新生成',409);for(const target of p.snapshot.targets){const r=await rules.calculateManufacturing({taskId:id,taskProductId:p.snapshot.taskProductId,processType:target.processType,selectedTemplateAreaId:target.zoneId},target.logoColor,p.snapshot.regionVersion===2?target.foilEffect:p.snapshot.appearance.foil);if(r.fingerprint!==target.ruleFingerprint||!manufacturingAllowed(r,target.cartonFoilConfirmed))fail('生成期间规则已变化，请重新确认',409);}}
 async function generate(id,v,actor){assertEditable(id);let st=state(id);if(v.baseRevision!==st.revision)fail('选择已变化，请刷新',409);if(!st.revision){st=await save(id,{...st.draft,baseRevision:0});v={...v,baseRevision:st.revision};}const requested=requestedRows(id,st.draft,v.onlyKeys);busy.add(id);let runId;try{
  const initial=await preflight(id,v);if(initial.issues.length&&!v.allowPartial)return {preflight:initial,needsConfirmation:true};if(!initial.good.length)return {preflight:initial,needsConfirmation:true};
  await ensureLogo(id,actor);
  const ready=await preflight(id,v);if(ready.issues.some(i=>i.detail)||ready.issues.length&&!v.allowPartial||!ready.good.length)return {preflight:ready,needsConfirmation:true};
  if(state(id).revision!==st.revision)fail('任务选择已变化，请刷新',409);
  const round=(db.prepare('SELECT MAX(round) n FROM SalesRun WHERE taskId=?').get(id).n||0)+1;runId=randomUUID();db.prepare('INSERT INTO SalesRun VALUES (?,?,?,?,?,?,?)').run(runId,id,round,'RUNNING',JSON.stringify(st.draft),'[]',now());
  const report=[],resultIds=v.onlyKeys?st.current.filter(outputId=>{const o=outputs(id).find(o=>o.id===outputId);return o&&!v.onlyKeys.includes(key(o.taskProductId,o.kind));}):[];
  for(const row of requested){let path;try{const p=await prepareImage(id,row,st.draft);const prior=outputs(id).find(o=>o.taskProductId===row.item.id&&o.kind===row.kind&&o.snapshot.fingerprint===p.fingerprint);if(prior&&!outputStatus(prior,id)){await validatePrepared(id,p);resultIds.push(prior.id);report.push({key:row.key,sku:row.item.sku,kind:row.kind,status:'REUSED',outputId:prior.id});continue;}
   const groups=p.snapshot.targets.map(({placement:z,areaId})=>{const width=z.widthRatio*p.image.width,height=width*p.logo.height/p.logo.width;return `<g transform="translate(${z.x*p.image.width},${z.y*p.image.height}) rotate(${z.rotation})"><image x="${-width/2}" y="${-height/2}" width="${width}" height="${height}" href="data:image/png;base64,${(p.paints?.[areaId]||p.usedLogo).toString('base64')}"/></g>`;});
   const overlay=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${p.image.width}" height="${p.image.height}">${groups.join('')}</svg>`),bytes=await sharp(p.base).rotate().composite([{input:overlay,left:0,top:0}]).png().toBuffer();
   const raw=await sharp(p.base).rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true});p.snapshot.visibility=[];for(const target of p.snapshot.targets)p.snapshot.visibility.push({areaId:target.areaId,...await visibilityCheck(raw,p.paints?.[target.areaId]||p.usedLogo,target.placement,p.image,p.logo)});
   await validatePrepared(id,p);path=storage.put(bytes,'png');const outputId=randomUUID(),version=(db.prepare('SELECT MAX(version) n FROM SalesOutput WHERE taskProductId=? AND kind=?').get(row.item.id,row.kind).n||0)+1;
   db.prepare('INSERT INTO SalesOutput VALUES (?,?,?,?,?,?,?,?,?)').run(outputId,id,row.item.id,runId,row.kind,version,path,JSON.stringify({...p.snapshot,fingerprint:p.fingerprint,outputSha:hash(bytes)}),now());path=null;resultIds.push(outputId);report.push({key:row.key,sku:row.item.sku,kind:row.kind,status:'GENERATED',outputId});
  }catch(e){if(path)storage.remove(path);report.push({key:row.key,sku:row.item.sku,kind:row.kind,status:'BLOCKED',reason:e.message});}finally{db.prepare('UPDATE SalesRun SET reportJson=? WHERE id=?').run(JSON.stringify(report),runId);}}
  const good=report.some(r=>r.outputId),bad=report.some(r=>!r.outputId);db.prepare('UPDATE SalesRun SET status=? WHERE id=?').run(bad?(good?'PARTIAL':'FAILED'):'COMPLETED',runId);
  db.prepare('UPDATE SalesWorkspace SET currentJson=?,updatedAt=? WHERE taskId=?').run(JSON.stringify([...new Set(resultIds)]),now(),id);return {page:{...await page(id),busy:false},report};
 }catch(e){if(runId)db.prepare("UPDATE SalesRun SET status='FAILED' WHERE id=?").run(runId);throw e;}finally{busy.delete(id);}}
 async function download(id,v){if(busy.has(id)||isOtherBusy(id))fail('正在生成，请等待完成后下载',409);const t=task(id),p=await page(id);if(!Array.isArray(v.outputIds)||!v.outputIds.length||v.outputIds.length>200||new Set(v.outputIds).size!==v.outputIds.length)fail('请选择要下载的图片');const chosen=v.outputIds.map(k=>{const o=p.current.find(o=>o.id===k);if(!o||o.unavailableReason)fail('勾选图片已失效或不在当前结果，请刷新',409);return o;});if(v.single&&chosen.length!==1)fail('单张下载只能选择一张图片');
  // Re-check rules against each immutable output before creating a customer archive.
  for(const o of chosen)for(const target of o.snapshot.targets){const check=await rules.calculateManufacturing({taskId:id,taskProductId:o.taskProductId,processType:target.processType,selectedTemplateAreaId:target.zoneId},target.logoColor,o.snapshot.regionVersion===2?target.foilEffect:o.snapshot.appearance.foil);if(!manufacturingAllowed(check,target.cartonFoilConfirmed))fail(o.snapshot.sku+'：工艺规则已变化，请重新生成',409);}
  const names=outputFileNames(p.current,{single:!!v.single}),folder=safeFilePart(chosen[0].snapshot.customerName),files=[],layouts=[];
  for(const o of chosen){const profile=delivery?.profile(o.snapshot.templateId);if(!profile||profile.imageSha!==o.snapshot.imageSha)fail(o.snapshot.sku+'：请设计师在锁定母版中确认颜色工艺信息区后下载',409);const bytes=await renderCustomerImage(storage.get(o.imagePath),o,profile.layout);files.push({name:v.single?names.get(o.id):folder+'/'+names.get(o.id),bytes});layouts.push({outputId:o.id,layoutId:profile.id,sha:hash(bytes)});}
  for(const o of chosen){if(outputStatus(o,id))fail('下载期间图片或资料已变化，请刷新',409);for(const target of o.snapshot.targets){const check=await rules.calculateManufacturing({taskId:id,taskProductId:o.taskProductId,processType:target.processType,selectedTemplateAreaId:target.zoneId},target.logoColor,o.snapshot.regionVersion===2?target.foilEffect:o.snapshot.appearance.foil);if(!manufacturingAllowed(check,target.cartonFoilConfirmed))fail('下载期间规则已变化，请重新确认',409);}}

  // No current UI choice is consulted when naming already generated files.
  const manifest={kind:v.single?'PNG':'ZIP',layouts,outputs:chosen.map(o=>({id:o.id,sha:o.snapshot.outputSha,name:names.get(o.id)})),folder},bytes=v.single?files[0].bytes:zipStore(files),fileName=v.single?files[0].name:folder+'.zip';
  if(state(id).current.join('|')!==p.state.current.join('|'))fail('下载期间结果已变化，请重新选择',409);
  const path=storage.put(bytes,v.single?'png':'zip');try{db.prepare('INSERT INTO SalesExport VALUES (?,?,?,?,?,?,?)').run(randomUUID(),id,JSON.stringify(manifest),path,fileName,hash(bytes),now());}catch(e){storage.remove(path);throw e;}
  return {bytes,fileName,mime:v.single?'image/png':'application/zip'};
 }
 async function bindTemplate(id,v,actor){
  assertEditable(id);const old=state(id);if(v.baseRevision!==old.revision)fail('任务设置已变化，请刷新',409);
  const item=items(id).find(i=>i.id===v.taskProductId);if(!item)fail('任务产品不存在',404);
  if((item.templateId||null)!==(v.expectedTemplateId||null))fail('任务母版已变化，请刷新',409);
  const next=availableTemplate(item);if(!next||next.id!==v.templateId)fail('已发布母版或产品图已变化，请刷新',409);
  if(item.templateId===next.id)return page(id);
  if(item.templateId&&v.confirmUpdate!==true)fail('请确认使用新版母版；历史图片仍保留',409);
  // Reuse a designer-published version of the exact frozen product image. Never edit a template here.
  basePlan({...item,templateId:next.id});
  const draft=structuredClone(old.draft);for(const k of Object.keys(draft.overrides))if(k.startsWith(item.id+':'))delete draft.overrides[k];
  db.exec('BEGIN IMMEDIATE');try{
   assertEditable(id);if(state(id).revision!==old.revision)fail('任务设置已变化，请刷新',409);
   db.prepare('INSERT INTO TaskProductTemplate VALUES (?,?) ON CONFLICT(taskProductId) DO UPDATE SET templateId=excluded.templateId').run(item.id,next.id);
   db.prepare('INSERT INTO SalesWorkspace VALUES (?,?,?,?,?,?) ON CONFLICT(taskId) DO UPDATE SET revision=excluded.revision,draftJson=excluded.draftJson,updatedAt=excluded.updatedAt').run(id,id,old.revision+1,JSON.stringify(draft),JSON.stringify(old.current),now());
   db.prepare('INSERT INTO ManagementAudit VALUES (?,?,?,?,?,?)').run(randomUUID(),'TASK_TEMPLATE_BIND',item.id,JSON.stringify({taskId:id,from:item.templateId||null,to:next.id,version:next.version}),actor?.username||'本机业务用户',now());
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return page(id);
 }
 return {page,save,preflight,generate,download,bindTemplate,isBusy:id=>busy.has(id)};
}
