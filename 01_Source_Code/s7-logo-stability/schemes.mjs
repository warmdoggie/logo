import {generationVersions} from './generation-versions.mjs';
import {isCarton,normalizeTargetPrint} from './target-print.mjs';

const geometryKeys=['x','y','widthRatio','rotation','quad','surface','curve'];
const appearanceKeys=['carrierType','printFinish','color','autoContrast','preserveOriginalColor'];
const clone=value=>structuredClone(value);
function geometry(target){return Object.fromEntries(geometryKeys.map(key=>[key,clone(target[key])]));}
function initialTargets(targets,version){return clone(targets).map(target=>{
  const carton=isCarton(target),foilVersion=['GOLD FOIL','SILVER FOIL'].includes(version),defaultFinish=target.printFinish??'VERSION';
  return {...target,...(carton&&version==='BLACK'?{printFinish:'BLACK',autoContrast:true}:{}),...(carton&&foilVersion&&defaultFinish==='VERSION'?{printFinish:'INK',preserveOriginalColor:true}:{})};
});}

export function createSchemes(targets){
  return {sharedTargets:clone(targets),schemes:generationVersions.map(version=>({version,targets:initialTargets(targets,version),independentGeometry:false}))};
}

export function schemeTargets(input,version){
  if(input.schemes===undefined)return input.targets;
  if(!Array.isArray(input.schemes)||!input.schemes.length)throw Error('效果方案不能为空');
  const versions=new Set(),ids=input.targets?.map(target=>target.id)||input.schemes[0]?.targets?.map(target=>target.id);
  for(const scheme of input.schemes){
    if(!generationVersions.includes(scheme?.version)||versions.has(scheme.version))throw Error('效果方案版本无效或重复');
    versions.add(scheme.version);
    if(!Array.isArray(scheme.targets)||!scheme.targets.length||scheme.targets.length!==ids?.length||new Set(scheme.targets.map(target=>target.id)).size!==ids.length||scheme.targets.some(target=>!ids.includes(target.id)))throw Error('各方案必须包含相同的 Logo 区域');
    scheme.targets.forEach(normalizeTargetPrint);
  }
  const scheme=input.schemes.find(scheme=>scheme.version===version);
  if(!scheme)throw Error(`缺少 ${version} 效果方案`);
  return scheme.targets;
}

export function editScheme(state,version,targets,shared=true){
  const next=clone(state),current=next.schemes.find(scheme=>scheme.version===version);
  if(!current)throw Error('效果方案不存在');
  const changedToCarton=new Set(targets.filter(target=>isCarton(target)&&!isCarton(current.targets.find(item=>item.id===target.id)||{})).map(target=>target.id));
  if(shared)next.sharedTargets=clone(targets);
  const geometryChanged=JSON.stringify(current.targets.map(geometry))!==JSON.stringify(targets.map(geometry));
  current.targets=clone(targets);
  if(!shared&&geometryChanged)current.independentGeometry=true;
  for(const scheme of next.schemes){
    if(scheme===current)continue;
    scheme.targets=targets.map(target=>{
      const previous=scheme.targets.find(item=>item.id===target.id);
      if(!previous)return initialTargets([target],scheme.version)[0];
      return shared&&!scheme.independentGeometry?{...previous,...geometry(target)}:previous;
    });
  }
  next.sharedTargets=next.sharedTargets.map(target=>({...target,carrierType:targets.find(item=>item.id===target.id)?.carrierType||target.carrierType}));
  for(const scheme of next.schemes)for(const target of scheme.targets){
    target.carrierType=targets.find(item=>item.id===target.id)?.carrierType||target.carrierType;
    if(changedToCarton.has(target.id)&&['GOLD FOIL','SILVER FOIL'].includes(scheme.version)){
      target.printFinish='INK';target.preserveOriginalColor=true;
    }
    if(isCarton(target)&&!['INK','BLACK'].includes(target.printFinish)){
      target.printFinish=scheme.version==='BLACK'?'BLACK':'INK';
      if(['GOLD FOIL','SILVER FOIL'].includes(scheme.version))target.preserveOriginalColor=true;
    }
  }
  return next;
}

export function restoreSharedGeometry(state,version){
  const next=clone(state),scheme=next.schemes.find(scheme=>scheme.version===version);
  scheme.targets=scheme.targets.map(target=>({...target,...geometry(next.sharedTargets.find(item=>item.id===target.id)||target)}));
  scheme.independentGeometry=false;return next;
}

export function schemeSignature(scheme,assetKey=''){
  const text=JSON.stringify([assetKey,scheme.version,scheme.targets.map(target=>[target.id,...geometryKeys.map(key=>target[key]??null),...appearanceKeys.map(key=>target[key]??null)])]);
  let hash=2166136261;for(let index=0;index<text.length;index++)hash=Math.imul(hash^text.charCodeAt(index),16777619);
  return (hash>>>0).toString(16);
}
