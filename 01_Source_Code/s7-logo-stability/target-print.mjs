import {foilVersions,foilFinishes} from './foil-finishes.mjs';
import {allGenerationVersions,isMixedVersion} from './generation-versions.mjs';
export const isCarton=target=>['CARTON_FRONT','CARTON_BACK'].includes(target.carrierType);

export function normalizeTargetPrint(target){
  const carrierType=target.carrierType??'BODY';
  const printFinish=target.printFinish??'VERSION';
  if(!['BODY','CARTON_FRONT','CARTON_BACK'].includes(carrierType))throw Error('Logo 载体类型无效');
  if(!['VERSION','INK','BLACK',...foilVersions].includes(printFinish))throw Error('Logo 印刷工艺无效');
  return {carrierType,printFinish:isCarton({carrierType})&&printFinish==='VERSION'?'INK':printFinish};
}

export function resolveTargetPrint(target,version,originalColor=null,contrastColor=null){
  if(!allGenerationVersions.includes(version))throw Error('印刷版本无效');
  if(isMixedVersion(version)&&(target.printFinish===undefined||target.printFinish==='VERSION'))throw Error('搭配版本必须使用明确的印刷工艺');
  const rules=normalizeTargetPrint(target);
  const effective=rules.printFinish==='VERSION'?(version==='CUSTOM'?'ORIGINAL':version):rules.printFinish==='INK'?'ORIGINAL':rules.printFinish;
  const foil=foilFinishes[effective];
  const color=effective==='ORIGINAL'?(target.preserveOriginalColor?null:target.color||originalColor):effective==='BLACK'?(target.autoContrast?contrastColor:null)||'#000000':foil?.color;
  return {...rules,version:effective,color,finish:foil?.finish||'flat'};
}
