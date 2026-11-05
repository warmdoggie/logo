import {foilVersions} from './foil-finishes.mjs';
import {generationVersions,allGenerationVersions,isMixedVersion,mixedVersionFinishes} from './generation-versions.mjs';
import {isCarton,normalizeTargetPrint} from './target-print.mjs';

const geometryKeys=['x','y','widthRatio','rotation','quad','surface','curve'];
const appearanceKeys=['carrierType','printFinish','color','autoContrast','preserveOriginalColor'];
const clone=value=>structuredClone(value);
function geometry(target){return Object.fromEntries(geometryKeys.map(key=>[key,clone(target[key])]));}
function initialTargets(targets,version){return clone(targets).map(target=>{
  if(isMixedVersion(version)){
    const finish=mixedVersionFinishes(version)[isCarton(target)?'carton':'product'];
    return {...target,printFinish:finish==='ORIGINAL'?'INK':finish,preserveOriginalColor:finish==='ORIGINAL',autoContrast:finish==='BLACK'};
  }
  if(version==='CUSTOM')return {...target,printFinish:'INK',color:targets.find(item=>isCarton(item)===isCarton(target))?.color||'#000000',autoContrast:false,preserveOriginalColor:false};
  const carton=isCarton(target),foilVersion=foilVersions.includes(version),defaultFinish=target.printFinish??'VERSION';
  return {...target,...(carton&&version==='BLACK'&&!foilVersions.includes(defaultFinish)?{printFinish:'BLACK',autoContrast:true}:{}),...(carton&&foilVersion&&defaultFinish==='VERSION'?{printFinish:'INK',preserveOriginalColor:true}:{})};
});}

export function createSchemes(targets){
  return {sharedTargets:clone(targets),schemes:generationVersions.map(version=>({version,targets:initialTargets(targets,version),independentGeometry:false}))};
}

export function ensureMixedSchemes(state,versions){
  if(!Array.isArray(versions)||versions.some(version=>!isMixedVersion(version)))throw Error('搭配版本无效');
  const missing=[...new Set(versions)].filter(version=>!state.schemes.some(scheme=>scheme.version===version));
  if(!missing.length)return state;
  const next=clone(state),reference=state.sharedTargets||state.schemes[0]?.targets;
  for(const version of missing)next.schemes.push({version,targets:initialTargets(reference,version),independentGeometry:false});
  return next;
}

export function ensureFoilSchemes(state){
  const missing=foilVersions.filter(version=>!state.schemes.some(scheme=>scheme.version===version));
  if(!missing.length)return state;
  const next=clone(state),reference=state.sharedTargets||state.schemes.find(scheme=>scheme.version==='GOLD FOIL')?.targets||state.schemes[0].targets;
  const targets=reference.map(target=>({...target,printFinish:isCarton(target)?'INK':'VERSION'}));
  for(const version of missing)next.schemes.push({version,targets:initialTargets(targets,version),independentGeometry:false});
  return next;
}

export function ensureCustomScheme(state){
  if(state.schemes.some(scheme=>scheme.version==='CUSTOM'))return state;
  const next=clone(state);
  next.schemes.push({version:'CUSTOM',targets:initialTargets(state.sharedTargets||state.schemes[0].targets,'CUSTOM'),independentGeometry:false});
  return next;
}

export function setCustomColors(state,colors){
  for(const value of Object.values(colors))if(!/^#[0-9a-f]{6}$/i.test(value))throw Error('自定义颜色必须是 6 位十六进制颜色');
  const next=clone(ensureCustomScheme(state)),custom=next.schemes.find(scheme=>scheme.version==='CUSTOM');
  custom.targets=custom.targets.map(target=>({...target,color:colors[isCarton(target)?'carton':'product']||target.color,printFinish:'INK',autoContrast:false,preserveOriginalColor:false}));
  return next;
}

export function copyCustomColors(source,destination){
  const targets=ensureCustomScheme(source).schemes.find(scheme=>scheme.version==='CUSTOM').targets;
  const product=targets.find(target=>!isCarton(target)),carton=targets.find(isCarton);
  return setCustomColors(destination,{...(product?{product:product.color}:{}),...(carton?{carton:carton.color}:{})});
}

export function editSelectedLogos(state,version,selectedIds,group,patch,dimensions){
  if(patch.widthRatio!==undefined&&(!Number.isFinite(patch.widthRatio)||patch.widthRatio<=0||patch.widthRatio>1))throw Error('Logo 大小须在 0 到 100% 之间');
  if(patch.rotation!==undefined&&(!Number.isFinite(patch.rotation)||Math.abs(patch.rotation)>180))throw Error('角度须在 -180° 到 180° 之间');
  if(patch.color!==undefined){
    if(version!=='CUSTOM')throw Error('当前版本颜色固定，请在自定义配色中修改');
    if(!/^#[0-9a-f]{6}$/i.test(patch.color))throw Error('颜色须填写 6 位 HEX');
  }
  const next=clone(state),ids=new Set(selectedIds),geometryChanged=patch.widthRatio!==undefined||patch.rotation!==undefined;
  const matches=target=>ids.has(target.id)&&isCarton(target)===(group==='carton');
  function updateGeometry(target){
    const width=patch.widthRatio??target.widthRatio,rotation=patch.rotation??target.rotation??0;
    if(target.quad){
      const center=target.quad.reduce((sum,p)=>({x:sum.x+p.x/4,y:sum.y+p.y/4}),{x:0,y:0}),scale=width/target.widthRatio,angle=(rotation-(target.rotation||0))*Math.PI/180,aspect=dimensions?dimensions.width/dimensions.height:1;
      target.quad=target.quad.map(point=>{
        const x=(point.x-center.x)*scale,y=(point.y-center.y)*scale;
        return {x:Number((center.x+x*Math.cos(angle)-y/aspect*Math.sin(angle)).toFixed(6)),y:Number((center.y+x*aspect*Math.sin(angle)+y*Math.cos(angle)).toFixed(6))};
      });
      if(target.quad.some(p=>p.x<0||p.x>1||p.y<0||p.y>1))throw Error('所选 Logo 的大小或角度超出原图，请调整后重试');
    }else if(dimensions){
      const {width:imageWidth,height:imageHeight,logoAspect}=dimensions,radians=rotation*Math.PI/180,w=width*imageWidth,h=w*logoAspect;
      const halfWidth=(Math.abs(Math.cos(radians))*w+Math.abs(Math.sin(radians))*h)/2,halfHeight=(Math.abs(Math.sin(radians))*w+Math.abs(Math.cos(radians))*h)/2;
      if(target.x*imageWidth-halfWidth<0||target.x*imageWidth+halfWidth>imageWidth||target.y*imageHeight-halfHeight<0||target.y*imageHeight+halfHeight>imageHeight)throw Error('所选 Logo 的大小或角度超出原图，请调整后重试');
    }
    if(patch.widthRatio!==undefined)target.widthRatio=width;
    if(patch.rotation!==undefined)target.rotation=rotation;
  }
  if(geometryChanged)for(const target of next.sharedTargets)if(matches(target))updateGeometry(target);
  for(const scheme of next.schemes)for(const target of scheme.targets){
    if(!matches(target))continue;
    if(geometryChanged)updateGeometry(target);
    if(scheme.version===version&&patch.color!==undefined)Object.assign(target,{color:patch.color.toUpperCase(),printFinish:'INK',autoContrast:false,preserveOriginalColor:false});
  }
  return next;
}

export function schemeTargets(input,version){
  if(input.schemes===undefined){
    if(isMixedVersion(version))throw Error('搭配版本缺少明确印刷工艺方案');
    return input.targets;
  }
  if(!Array.isArray(input.schemes)||!input.schemes.length)throw Error('效果方案不能为空');
  const versions=new Set(),ids=input.targets?.map(target=>target.id)||input.schemes[0]?.targets?.map(target=>target.id);
  for(const scheme of input.schemes){
    if(!allGenerationVersions.includes(scheme?.version)||versions.has(scheme.version))throw Error('效果方案版本无效或重复');
    versions.add(scheme.version);
    if(!Array.isArray(scheme.targets)||!scheme.targets.length||scheme.targets.length!==ids?.length||new Set(scheme.targets.map(target=>target.id)).size!==ids.length||scheme.targets.some(target=>!ids.includes(target.id)))throw Error('各方案必须包含相同的 Logo 区域');
    scheme.targets.forEach(normalizeTargetPrint);
    if(isMixedVersion(scheme.version))for(const target of scheme.targets){
      const finish=mixedVersionFinishes(scheme.version)[isCarton(target)?'carton':'product'];
      if(target.printFinish!==(finish==='ORIGINAL'?'INK':finish)||finish==='ORIGINAL'&&target.preserveOriginalColor!==true||finish==='BLACK'&&target.autoContrast!==true)throw Error('搭配方案的印刷工艺与版本不一致');
    }
  }
  const scheme=input.schemes.find(scheme=>scheme.version===version);
  if(!scheme)throw Error(`缺少 ${version} 效果方案`);
  return scheme.targets;
}

export function editScheme(state,version,targets,shared=true){
  const next=clone(state),current=next.schemes.find(scheme=>scheme.version===version);
  const customTargets=state.schemes.find(scheme=>scheme.version==='CUSTOM')?.targets||[];
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
    if(isMixedVersion(scheme.version)){
      Object.assign(target,initialTargets([target],scheme.version)[0]);
      continue;
    }
    if(scheme.version==='CUSTOM'){
      const previous=customTargets.find(item=>item.id===target.id);
      if(!previous||isCarton(previous)!==isCarton(target))target.color=customTargets.find(item=>isCarton(item)===isCarton(target))?.color||target.color;
      target.printFinish='INK';target.autoContrast=false;target.preserveOriginalColor=false;
    }
    if(changedToCarton.has(target.id)&&foilVersions.includes(scheme.version)&&!(scheme===current&&foilVersions.includes(target.printFinish))){
      target.printFinish='INK';target.preserveOriginalColor=true;
    }
    if(isCarton(target)&&!['INK','BLACK',...foilVersions].includes(target.printFinish)){
      target.printFinish=scheme.version==='BLACK'?'BLACK':'INK';
      if(foilVersions.includes(scheme.version))target.preserveOriginalColor=true;
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
