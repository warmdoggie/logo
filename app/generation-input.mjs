// Shared visual input key: notes alone do not cause a new image or paid submission.
export function generationInput(draft,targets,logo,products){
 return {processType:draft.processType,overrides:draft.carrierOverrides.map(o=>({taskProductId:o.taskProductId,carrierId:o.carrierId,areaId:o.areaId||null,schemeId:o.schemeId||null,processType:o.processType,logoColor:o.logoColor||null,colorSpec:o.logoColorSpec||null,original:o.logoColorSpec?.mode==='ORIGINAL',surfaceColor:o.surfaceColor||null})),targets,logo,products};
}
