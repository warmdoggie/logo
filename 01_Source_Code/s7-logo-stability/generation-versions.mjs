export const generationVersions=['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL'];

export function selectGenerationVersions({selectedVersions=generationVersions,onlyVersion}={}){
 const selected=onlyVersion===undefined?selectedVersions:[onlyVersion];
 if(!Array.isArray(selected)||!selected.length||selected.some(version=>!generationVersions.includes(version)))throw Object.assign(Error('请至少选择一个有效的生成版本'),{status:400});
 return generationVersions.filter(version=>selected.includes(version));
}
