import {foilVersions} from './foil-finishes.mjs';
export const defaultGenerationVersions=['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL'];
export const generationVersions=[...defaultGenerationVersions,'CUSTOM',...foilVersions.slice(2)];
const mixedTokens=['ORIGINAL','BLACK','GOLD','SILVER','ROSE','LASER'];
const mixedFinishes=['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL','ROSE GOLD FOIL','LASER FOIL'];
const mixedNames=['原色','黑白','烫金','烫银','烫玫瑰金','烫镭射'];
export const mixedGenerationVersions=mixedTokens.flatMap(product=>mixedTokens.map(carton=>`MIX_${product}_${carton}`));
export const allGenerationVersions=[...generationVersions,...mixedGenerationVersions];
export const isMixedVersion=version=>mixedGenerationVersions.includes(version);

export function mixedVersion(product,carton){
 if(!mixedFinishes.includes(product)||!mixedFinishes.includes(carton))throw Error('搭配印刷工艺无效');
 return `MIX_${mixedTokens[mixedFinishes.indexOf(product)]}_${mixedTokens[mixedFinishes.indexOf(carton)]}`;
}

export function mixedVersionFinishes(version){
 if(!isMixedVersion(version))throw Error('搭配版本无效');
 const [,product,carton]=version.split('_');
 return {product:mixedFinishes[mixedTokens.indexOf(product)],carton:mixedFinishes[mixedTokens.indexOf(carton)]};
}

export function mixedVersionName(version){
 const finishes=mixedVersionFinishes(version);
 return `产品${mixedNames[mixedFinishes.indexOf(finishes.product)]} · 彩盒${mixedNames[mixedFinishes.indexOf(finishes.carton)]}`;
}

export function selectGenerationVersions({selectedVersions=defaultGenerationVersions,onlyVersion}={}){
 const selected=onlyVersion===undefined?selectedVersions:[onlyVersion];
 if(!Array.isArray(selected)||!selected.length||selected.some(version=>!allGenerationVersions.includes(version)))throw Object.assign(Error('请至少选择一个有效的生成版本'),{status:400});
 return allGenerationVersions.filter(version=>selected.includes(version));
}

export function productGenerationVersions(input,productId){
 const fail=message=>{throw Object.assign(Error(message),{status:400});};
 const ids=input.productIds,layouts=input.productLayouts??[],top=selectGenerationVersions(input);
 if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length||!ids.includes(productId)||input.onlyProductId!==undefined&&!ids.includes(input.onlyProductId))fail('产品选择或重做对象无效');
 if(input.selectedVersions!==undefined&&(!Array.isArray(input.selectedVersions)||input.selectedVersions.some(version=>!allGenerationVersions.includes(version))||new Set(input.selectedVersions).size!==input.selectedVersions.length))fail('生成版本无效或重复');
 if(!Array.isArray(layouts)||layouts.some(layout=>!layout||!ids.includes(layout.productId))||new Set(layouts.map(layout=>layout.productId)).size!==layouts.length)fail('产品方案与所选包材不匹配');
 const selections=new Map(ids.map(id=>[id,top]));
 for(const layout of layouts){
  const selected=layout.selectedVersions;
  if(selected===undefined)continue;
  if(!Array.isArray(selected)||new Set(selected).size!==selected.length||selected.some(version=>!allGenerationVersions.includes(version)||!top.includes(version)))fail('产品生成版本必须是本次所选版本的有效且不重复的子集');
  selections.set(layout.productId,allGenerationVersions.filter(version=>selected.includes(version)));
 }
 if(top.some(version=>![...selections.values()].some(selected=>selected.includes(version))))fail('生成版本与产品方案不匹配');
 if(!ids.some(id=>(!input.onlyProductId||id===input.onlyProductId)&&selections.get(id).length))fail('请至少为一个产品选择生成版本');
 return input.onlyProductId&&productId!==input.onlyProductId?[]:selections.get(productId);
}
