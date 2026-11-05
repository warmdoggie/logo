import {foilVersions} from './foil-finishes.mjs';
import {isCarton} from './target-print.mjs';
import {isMixedVersion,mixedVersionFinishes} from './generation-versions.mjs';

export function normalizeFoilRegions(regions=['product']){
 if(!Array.isArray(regions)||regions.some(value=>!['product','carton'].includes(value)))throw Error('烫印区域无效');
 return ['product','carton'].filter(value=>regions.includes(value));
}

export function visibleSchemeVersions(versions,selectedVersions,outputs=[],phases={}){
 const visible=version=>!foilVersions.includes(version)||selectedVersions.includes(version)||outputs.some(output=>output.version===version&&output.dataUrl)||!!phases[version];
 return [...versions.filter(version=>!foilVersions.includes(version)),...versions.filter(version=>foilVersions.includes(version))].filter(visible);
}

export function allowedFoilVersions(templates,regions){
 if(!templates.length||!regions.length||templates.some(template=>!template))return [];
 return foilVersions.filter(version=>templates.every(template=>regions.every(region=>{
  const zones=template.zones||[],areas=template.automation?.areas||[],carriers=template.automation?.carriers||[];
  const selected=zones.filter(zone=>zone.zoneType==='logo').map(zone=>{
   const area=areas.find(area=>area.zoneId!=null?String(area.zoneId)===String(zone.id):area.zoneIndex===zones.indexOf(zone));
   const carton=carriers.find(carrier=>carrier.id===area?.carrierId)?.type==='CARTON';
   return {area,region:carton?'carton':'product'};
  }).filter(area=>area.region===region);
  return selected.length>0&&(region==='carton'||selected.every(({area})=>area?.foilProcesses?.includes(version)));
 })));
}

export function canSelectMixedVersion(templates,version){
 if(!templates.length||templates.some(template=>!template)||!isMixedVersion(version))return false;
 return Object.entries(mixedVersionFinishes(version)).every(([region,finish])=>!foilVersions.includes(finish)||allowedFoilVersions(templates,[region]).includes(finish));
}

export function applyFoilSelection(targets,schemes,regions=['product']){
 regions=normalizeFoilRegions(regions);
 const update=(target,version)=>{
  const selected=regions.includes(isCarton(target)?'carton':'product');
  if(foilVersions.includes(version))return {...target,printFinish:selected?version:'INK',preserveOriginalColor:!selected};
  return !selected&&foilVersions.includes(target.printFinish)?{...target,printFinish:'INK',preserveOriginalColor:true}:{...target};
 };
 return {targets:targets.map(target=>update(target)),schemes:schemes.map(scheme=>({...scheme,targets:scheme.targets.map(target=>isMixedVersion(scheme.version)?{...target}:update(target,scheme.version))}))};
}
