export const isCarton=target=>['CARTON_FRONT','CARTON_BACK'].includes(target.carrierType);

export function normalizeTargetPrint(target){
  const carrierType=target.carrierType??'BODY';
  const printFinish=target.printFinish??'VERSION';
  if(!['BODY','CARTON_FRONT','CARTON_BACK'].includes(carrierType))throw Error('Logo 载体类型无效');
  if(!['VERSION','INK','BLACK','GOLD FOIL','SILVER FOIL'].includes(printFinish))throw Error('Logo 印刷工艺无效');
  if(isCarton({carrierType})&&!['VERSION','INK','BLACK'].includes(printFinish))throw Error('彩盒只能使用普通颜色油墨印刷');
  return {carrierType,printFinish:isCarton({carrierType})&&printFinish==='VERSION'?'INK':printFinish};
}

export function resolveTargetPrint(target,version,originalColor=null,contrastColor=null){
  const rules=normalizeTargetPrint(target);
  const effective=rules.printFinish==='VERSION'?version:rules.printFinish==='INK'?'ORIGINAL':rules.printFinish;
  const color=effective==='ORIGINAL'?(target.preserveOriginalColor?null:target.color||originalColor):effective==='BLACK'?(target.autoContrast?contrastColor:null)||'#000000':effective==='GOLD FOIL'?'#C4A052':'#BFC3C9';
  return {...rules,version:effective,color,finish:effective==='GOLD FOIL'?'gold':effective==='SILVER FOIL'?'silver':'flat'};
}
