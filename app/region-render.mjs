import {logoContent} from './logo-content.mjs';
import {createHash} from 'node:crypto';
import {preflightIssueType} from './public/preflight-issues.js';
import {sharp} from './logo-pixels.mjs';
import {autoPlace} from './public/auto-placement.js';
import {validateManualPlacement} from './public/manual-placement.js';
import {chooseCartonInk} from './carton-ink.mjs';
import {regionChoices,regionChoiceSignature} from './region-sales.mjs';
import {manufacturingAllowed} from './region-printing.mjs';
import {tintCarrierLogo} from './carrier-colors.mjs';
const hash=v=>createHash('sha256').update(Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
const fail=(message,detail)=>{throw Object.assign(Error(message),{status:400,detail});};
export async function prepareRegional({db,storage,rules,task,item,kind,draft,plan}){
 let logo=db.prepare('SELECT * FROM ProductionLogo WHERE id=? AND taskId=?').get(task.activeProductionLogoId,task.id);if(!logo)fail('请先建立生产 Logo');
 const base=storage.get(item.standardImage),logoBytes=storage.get(logo.filePath),meta=await sharp(base).rotate().metadata(),image={width:meta.autoOrient?.width||meta.width,height:meta.autoOrient?.height||meta.height};
 logo=await logoContent(logoBytes,logo);
 const pinned=db.prepare('SELECT i.sha256 FROM TaskProductSnapshot s JOIN ProductImageVersion i ON i.id=s.productImageVersionId WHERE s.taskProductId=?').get(item.id);if(pinned&&pinned.sha256!==createHash('sha256').update(base).digest('hex'))fail('锁定产品图与母版底图不一致');
 const choices=regionChoices(plan,item,kind,draft),targets=[],paints={};
 for(const c of choices){const {target}=c,placement=c.placement||autoPlace({...target.zone,maxLogoWidthRatio:1,maxLogoHeightRatio:1},target.preset,plan.zones,image,logo);
  const errors=validateManualPlacement(placement,plan.zones,image,logo);if(errors.length)fail(errors.join('；'));
  let appearance=c.appearance,color=c.color,colorDecision=null;
  if(appearance.mode==='AUTO_BW'){
   colorDecision=await chooseCartonInk(base,placement,image,logo);
   if(colorDecision.status!=='READY')fail(colorDecision.reason,{type:'COLOR_CHOICE',areaId:target.area.id,areaName:target.area.name,imagePath:item.standardImage,logoPath:logo.filePath,placement,image,logo:{width:logo.width,height:logo.height}});
   color=colorDecision.hex;appearance={mode:'SOLID',hex:color};
  }
  if(c.policy.status==='WARNING'&&!c.cartonFoilConfirmed)fail(c.policy.message,{type:'CARTON_FOIL',areaId:target.area.id,areaName:target.area.name});
  const check=await rules.calculateManufacturing({taskId:task.id,taskProductId:item.id,processType:c.process,selectedTemplateAreaId:target.zone.id},color,appearance.foil);
  if(!manufacturingAllowed(check,c.cartonFoilConfirmed))throw Object.assign(Error(check.messages.join('；')),{status:400,issueType:preflightIssueType(check)});
  paints[target.area.id]=color?(await tintCarrierLogo(logoBytes,color)).png:logoBytes;
  targets.push({areaId:target.area.id,areaName:target.area.name,carrierId:target.area.carrierId,carrierName:target.carrier.name,carrierType:target.carrier.type,zoneId:target.zone.id,processType:c.process,appearance,foilEffect:appearance.foil,logoColor:color,placement,manual:!!c.placement,colorDecision,cartonFoilConfirmed:c.cartonFoilConfirmed,ruleFingerprint:check.fingerprint,ruleChecks:check});
 }
 const appearance=targets.find(t=>t.carrierType!=='CARTON')?.appearance||targets[0].appearance;
 const snapshot={taskId:task.id,taskProductId:item.id,productId:item.productId,customerName:task.customerName,sku:item.sku,productName:item.name,templateId:item.templateId,templateVersion:item.templateVersion,regionVersion:2,layoutSchemeId:plan.scheme.id,logoId:logo.id,logoPath:logo.filePath,imagePath:item.standardImage,imageSha:createHash('sha256').update(base).digest('hex'),logoSha:createHash('sha256').update(logoBytes).digest('hex'),printingVersion:0,kind,appearance,targets,carrierProcesses:targets,choiceSignature:regionChoiceSignature(item,kind,draft),image,logoSize:{width:logo.width,height:logo.height,contentBounds:logo.contentBounds},mode:'2D_LOCAL',createdAt:new Date().toISOString()};
 const fingerprint=hash({...snapshot,createdAt:undefined,targets:targets.map(({ruleChecks,...r})=>r),carrierProcesses:targets.map(({ruleChecks,...r})=>r)});
 return {snapshot,fingerprint,base,logo,usedLogo:logoBytes,paints,image};
}
