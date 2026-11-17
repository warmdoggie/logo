import {PRINT_METHODS} from './printing-settings.mjs';

export const CARTON_FOIL_WARNING='通用彩盒默认采用油墨印刷，通常不建议使用烫印。如需烫印，请向设计师咨询具体可行性。';
const fail=message=>{throw Object.assign(Error(message),{status:400});};
export const isCarton=carrier=>carrier?.type==='CARTON';

export function normalizeRegionPrinting(value,carrier){
 if(!value||!Array.isArray(value.allowed)||!value.allowed.length||value.allowed.length>4||value.allowed.some(p=>!Object.hasOwn(PRINT_METHODS,p)))fail('请为每个 Logo 区域勾选适用的印刷工艺');
 const allowed=[...new Set(value.allowed)];
 if(!allowed.includes(value.defaultProcess))fail('区域默认工艺必须属于该区域适用工艺');
 const ink=isCarton(carrier)?'AUTO':value.ink;
 if(!isCarton(carrier)&&!['BLACK','WHITE'].includes(ink))fail('请设置产品区域的黑／白油墨默认色');
 const facts={};for(const key of ['material','surfaceFinish']){if(value[key]!==undefined&&value[key]!==null&&(typeof value[key]!=='string'||value[key].length>100))fail('区域材质或表面资料最多 100 字');facts[key]=value[key]?.trim()||null;}
 return {allowed,defaultProcess:value.defaultProcess,ink,...facts};
}

export function regionPolicy(settings,carrier,process){
 if(!settings)return {status:'NEED_INFO',message:'请设计师在母版中补齐该 Logo 区域的工艺设置'};
 if(!Object.hasOwn(PRINT_METHODS,process))return {status:'BLOCK',message:'请选择有效的实际印刷工艺'};
 if(isCarton(carrier)&&process==='HOT_STAMP')return {status:'WARNING',code:'CARTON_FOIL',message:CARTON_FOIL_WARNING};
 if(!settings.allowed.includes(process))return {status:'BLOCK',message:`该${isCarton(carrier)?'彩盒':'产品'}区域不支持${PRINT_METHODS[process]}，请更换工艺，或联系设计师／印刷车间确认可行性。`};
 return {status:'PASS',message:''};
}

// A published v2 template is authoritative. Missing area settings must never fall back
// to whole-product allowances, which could silently broaden a physical area's rules.
export function regionPrintingContext(db,templateId,zoneId){
 const row=db.prepare('SELECT definitionJson FROM TemplateAutomation WHERE templateId=?').get(templateId);
 const definition=row?JSON.parse(row.definitionJson):null;
 if(definition?.version!==2)return null;
 const area=definition.areas.find(a=>a.zoneId===zoneId),carrier=definition.carriers.find(c=>c.id===area?.carrierId);
 return {definition,area,carrier,settings:area?.printing||null};
}

export function manufacturingAllowed(check,cartonFoilConfirmed=false){
 if(check.testOnly)return false;
 if(check.overallStatus==='PASS')return true;
 return cartonFoilConfirmed&&check.overallStatus==='WARNING'&&check.matchedRules.filter(r=>r.result!=='PASS').every(r=>r.ruleCode==='CARTON_FOIL');
}
