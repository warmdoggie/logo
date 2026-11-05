import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {foilVersions,foilNames} from './foil-finishes.mjs';
import {applyFoilSelection,normalizeFoilRegions} from './foil-selection.mjs';
import {createSchemes,ensureMixedSchemes,schemeTargets} from './schemes.mjs';
import {selectGenerationVersions,productGenerationVersions,isMixedVersion,mixedVersionFinishes} from './generation-versions.mjs';
import {masterTargetsFromTemplate} from './product-master.mjs';
import {resolveTargetPrint} from './target-print.mjs';

const fail=(message,status=400,code,preflight)=>{throw Object.assign(Error(message),{status,code,preflight});};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function createFoilPolicy({productCatalog,productTemplate}){
 const secret=randomBytes(32),sign=value=>createHmac('sha256',secret).update(value).digest('hex');
 async function prepare(input,req,{userId='local',requireConfirmation=false,mode='single'}={}){
  const versions=selectGenerationVersions(input),regions=normalizeFoilRegions(input.foilRegions);
  if(!['single','multi-product','multi-logo'].includes(mode))fail('生成模式无效');
  if(mode==='single'&&(input.productIds||input.productLayouts||input.logoLayouts))fail('单产品生成模式不能使用其他布局');
  if(mode==='single'&&(input.onlyProductId||input.onlyLogoId)||mode==='multi-product'&&input.onlyLogoId||mode==='multi-logo'&&input.onlyProductId)fail('生成模式与重做对象不匹配');
  const rawLayouts=mode==='multi-product'?input.productLayouts:mode==='multi-logo'?input.logoLayouts:undefined;
  const idKey=mode==='multi-product'?'productId':'logoId',ids=mode==='multi-product'?input.productIds:input.logos?.map(logo=>logo.id);
  if(mode==='multi-product')productGenerationVersions(input,ids?.[0]);
  const layoutVersions=layout=>mode==='multi-product'?productGenerationVersions(input,layout.productId):versions;
  if(rawLayouts!==undefined&&(!Array.isArray(rawLayouts)||new Set(rawLayouts.map(layout=>layout?.[idKey])).size!==rawLayouts.length||rawLayouts.some(layout=>!layout||!ids?.includes(layout[idKey])||layoutVersions(layout).length&&(!Array.isArray(layout.targets)||!layout.targets.length||!Array.isArray(layout.schemes)||!layout.schemes.length))))fail('布局与所选产品或 Logo 不匹配');
  if(input.onlyProductId&&!input.productIds?.includes(input.onlyProductId)||input.onlyLogoId&&!input.logos?.some(logo=>logo.id===input.onlyLogoId))fail('指定的重做对象不在本次选择中');
  const layouts=mode==='multi-product'?(input.productIds||[]).map(productId=>({...input.productLayouts?.find(layout=>layout.productId===productId),productId})):mode==='multi-logo'?(input.logos||[]).map(logo=>({...input.logoLayouts?.find(layout=>layout.logoId===logo.id),logoId:logo.id,productId:input.productId,targets:input.logoLayouts?.find(layout=>layout.logoId===logo.id)?.targets||input.targets,schemes:input.logoLayouts?.find(layout=>layout.logoId===logo.id)?.schemes||input.schemes})):[{productId:input.productId,targets:input.targets,schemes:input.schemes}];
  const activeLayouts=layouts.filter(layout=>layoutVersions(layout).length&&(!input.onlyProductId||layout.productId===input.onlyProductId)&&(!input.onlyLogoId||layout.logoId===input.onlyLogoId));
  const foilRegionsFor=selected=>selected.filter(isMixedVersion).flatMap(version=>Object.entries(mixedVersionFinishes(version)).filter(([,finish])=>foilVersions.includes(finish)).map(([region])=>region));
  const mixedFoilRegions=activeLayouts.flatMap(layout=>foilRegionsFor(layoutVersions(layout)));
  const wantsFoil=mixedFoilRegions.length>0||activeLayouts.some(layout=>layoutVersions(layout).some(version=>foilVersions.includes(version)||(layout.schemes?.find(s=>s.version===version)?.targets||layout.targets||[]).some(target=>foilVersions.includes(target.printFinish))));
  const empty={blocked:[],warnings:[]};
  if(!wantsFoil){
   const mixedVersions=versions.filter(isMixedVersion);
   if(!mixedVersions.length)return {input,report:empty};
   const complete=layout=>!layout.targets?.length?layout:{...layout,schemes:ensureMixedSchemes({sharedTargets:layout.targets,schemes:layout.schemes||createSchemes(layout.targets).schemes},layoutVersions(layout).filter(isMixedVersion)).schemes};
   const output=mode==='single'?complete(input):mode==='multi-product'?{...input,productLayouts:(input.productLayouts||[]).map(complete)}:{...input,logoLayouts:layouts.filter(layout=>layout.targets?.length).map(complete)};
   return {input:output,report:empty};
  }
  if(!activeLayouts.length)fail('没有可校验的生成对象，请检查选择与重做设置');
  if(!regions.length&&!mixedFoilRegions.length)fail('请至少选择一个烫印区域');
  const catalog=await productCatalog(req),masters=new Map(),prepared=[],blocked=[],warnings=[];
  for(const layout of activeLayouts){
   const selectedVersions=layoutVersions(layout),selectedMixedFoilRegions=foilRegionsFor(selectedVersions);
   const product=catalog.find(product=>String(product.id)===layout.productId&&product.status!=='INACTIVE');
   if(!product)fail('烫印需要选择产品库中有效且已发布母版的产品');
   let payload=masters.get(layout.productId);
   if(!payload){payload=await productTemplate(product,req);masters.set(layout.productId,payload);}
   const template=payload?.template;
   if(!template||payload.needsTemplateReview)fail(`${product.sku} 的母版缺失或需要复核，请先发布产品母版`);
   const zones=template.zones||[],areas=template.automation?.areas||[],carriers=template.automation?.carriers||[];
   const zoneFor=target=>{
    const zone=zones.find(zone=>String(zone.id)===target.masterZoneId&&zone.zoneType==='logo');
    if(!zone)fail(`${product.sku} 的区域与当前母版不一致，母版可能已更新，请重新选择产品`);
    const area=areas.find(area=>area.zoneId?String(area.zoneId)===String(zone.id):area.zoneIndex===zones.indexOf(zone));
    const carrier=carriers.find(carrier=>carrier.id===area?.carrierId);
    return {zone,area,carton:carrier?.type==='CARTON'};
   };
   const canonical=target=>{const {carton}=zoneFor(target);return {...target,carrierType:carton?'CARTON_FRONT':'BODY'};};
   const legacyLogoDefault=mode==='multi-logo'&&!input.logoLayouts?.some(value=>value.logoId===layout.logoId);
   const targets=(layout.targets||masterTargetsFromTemplate(template)).map(target=>canonical(legacyLogoDefault?{...target,preserveOriginalColor:target.preserveOriginalColor??!target.color,autoContrast:target.autoContrast!==false}:target));
   const sourceSchemes=ensureMixedSchemes({sharedTargets:targets,schemes:(layout.schemes||createSchemes(targets).schemes).map(s=>selectedVersions.includes(s.version)?{...s,targets:s.targets.map(canonical)}:s)},selectedVersions.filter(isMixedVersion)).schemes;
   const selected=applyFoilSelection(targets,sourceSchemes,regions);
   const present=new Set(targets.map(target=>zoneFor(target).carton?'carton':'product'));
   if(selectedVersions.some(version=>foilVersions.includes(version)))for(const region of regions)if(!present.has(region))blocked.push({productId:layout.productId,sku:product.sku,message:`${product.sku} 母版中没有已确认归属的${region==='carton'?'彩盒':'产品'}区域，请在母版的区域工艺中设置后保存`});
   for(const region of new Set(selectedMixedFoilRegions))if(!present.has(region))blocked.push({productId:layout.productId,sku:product.sku,message:`${product.sku} 母版中没有已确认归属的${region==='carton'?'彩盒':'产品'}区域，请在母版的区域工艺中设置后保存`});
   for(const version of selectedVersions){
    const scheme=selected.schemes.find(scheme=>scheme.version===version);
    if(!scheme)fail(`缺少 ${version} 效果方案，请刷新后重新选择产品`);
    if(isMixedVersion(version))schemeTargets({targets,schemes:selected.schemes},version);
    for(const target of scheme.targets){
     const finish=resolveTargetPrint(target,version).version;if(!foilVersions.includes(finish))continue;
     const {zone,area,carton}=zoneFor(target),entry={productId:layout.productId,sku:product.sku,zoneId:String(zone.id),zoneName:zone.name,finish};
     if(carton)warnings.push({...entry,message:`${product.sku} · ${zone.name} 不建议${foilNames[finish]}，知晓后可继续烫印`});
     else if(!area?.foilProcesses?.includes(finish))blocked.push({...entry,message:`${product.sku} · ${zone.name} 不支持${foilNames[finish]}，请更换工艺或取消产品烫印`});
    }
   }
   prepared.push({...layout,...selected,...(mode==='multi-product'?{selectedVersions}: {})});
  }
  const unique=values=>[...new Map(values.map(value=>[JSON.stringify(value),value])).values()];
  const report={blocked:unique(blocked),warnings:unique(warnings)};
  const selection=digest({mode,onlyProductId:input.onlyProductId,onlyLogoId:input.onlyLogoId,userId,taskId:input.taskId,versions,regions,masters:[...masters].map(([productId,payload])=>[productId,payload.template.id,payload.template.version]),layouts:prepared,logos:input.logos?.map(logo=>logo.id)});
  const validToken=token=>{
   if(typeof token!=='string')return false;
   const [expires,signature]=token.split('.');if(!/^\d+$/.test(expires)||!/^[a-f0-9]{64}$/.test(signature||'')||Number(expires)<Date.now())return false;
   return timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(sign(expires+':'+selection),'hex'));
  };
  const acknowledged=report.warnings.length>0&&validToken(input.foilAcknowledgement);
  if(!report.blocked.length&&report.warnings.length){const expires=String(Date.now()+15*60*1000);report.confirmationToken=expires+'.'+sign(expires+':'+selection);}
  if(requireConfirmation&&report.blocked.length)fail(report.blocked.map(entry=>entry.message).join('；'),422,'FOIL_BLOCKED',report);
  if(requireConfirmation&&report.warnings.length&&!acknowledged)fail('彩盒不建议烫印，请知晓提示后继续',409,'CARTON_FOIL_CONFIRMATION_REQUIRED',report);
  const foilAudit={selectedVersions:versions,regions,selection,cartonAcknowledged:acknowledged,masterVersions:[...masters].map(([productId,payload])=>({productId,templateId:payload.template.id,version:payload.template.version}))};
  const output={...input,foilAudit};
  if(mode==='multi-product')output.productLayouts=layouts.map(layout=>prepared.find(value=>value.productId===layout.productId)||layout);
  else if(mode==='multi-logo'){output.logoLayouts=layouts.map(layout=>prepared.find(value=>value.logoId===layout.logoId)||layout);output.targets=prepared[0]?.targets;}
  else Object.assign(output,prepared[0]);
  return {input:output,report};
 }
 return {prepare};
}
