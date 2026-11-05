import {normalizeSurfaceMask} from './surface-colors.mjs';
import {randomUUID} from 'node:crypto';
import {zonePoints,containsPolygon,polygonOverlap} from './public/zone-geometry.js';
const foilProcesses=['GOLD FOIL','SILVER FOIL','ROSE GOLD FOIL','LASER FOIL'];
export function automationStore(db){
 db.exec(`CREATE TABLE IF NOT EXISTS TemplateAutomation(templateId TEXT PRIMARY KEY REFERENCES ProductTemplate(id),definitionJson TEXT NOT NULL,createdAt TEXT NOT NULL);`);
 const fail=m=>{throw Object.assign(new Error(m),{status:400});};
 const label=(v,n)=>{if(typeof v!=='string'||!v.trim()||v.length>120)fail(n+'不能为空且最多120字');return v.trim();};
 const id=(v,n)=>{if(typeof v!=='string'||!v||v.length>100||!/^[\w-]+$/.test(v))fail(n+' ID 无效');return v;};
 function normalize(input,zones,image){
  if(input==null)return null;
  if(!Array.isArray(input.carriers)||!Array.isArray(input.areas)||!Array.isArray(input.schemes))fail('载体、区域和方案数据不完整');
  if(input.carriers.length>30||input.areas.length>100||input.schemes.length>3)fail('最多30个载体、100个区域、3个方案');
  const seen=new Set(),unique=(v,n)=>{v=id(v,n);if(seen.has(v))fail('自动化配置 ID 重复');seen.add(v);return v;};
  const carriers=input.carriers.map(c=>{if(!['BODY','CAP','CARTON','OTHER'].includes(c.type))fail('载体类型无效');return {id:unique(c.id,'载体'),type:c.type,name:label(c.name,'载体名称'),...(c.surfaceMask?{surfaceMask:normalizeSurfaceMask(c.surfaceMask)}:{})};});
  const areas=input.areas.map(a=>{
   const zoneIndex=a.zoneIndex,z=zones[zoneIndex];if(!Number.isInteger(zoneIndex)||!z||z.zoneType!=='logo')fail('物理区域必须关联 Logo 允许区域');
   if(!carriers.some(c=>c.id===a.carrierId))fail('区域载体不存在');
   if(typeof a.autoEligible!=='boolean')fail('区域自动参与标记无效');
   if(a.foilProcesses!==undefined&&(!Array.isArray(a.foilProcesses)||a.foilProcesses.some(p=>!foilProcesses.includes(p))))fail('区域烫印工艺无效');
   if(!Array.isArray(a.presets)||a.presets.length>10)fail('每个区域最多10个摆放位置');
   const presets=a.presets.map(p=>{
    if(!['horizontal','vertical','long-axis','follow-body','custom'].includes(p.orientation))fail('摆放方向无效');
    if(p.axisRotation!==undefined&&(!Number.isFinite(p.axisRotation)||Math.abs(p.axisRotation)>180))fail('长轴角度必须在 -180 到 180 度之间');
    const b=p.box;if(!b||!['centerX','centerY','width','height','rotation'].every(k=>typeof b[k]==='number'&&Number.isFinite(b[k])))fail('默认摆放框参数无效');
    if(b.width<.001||b.height<.001||b.width>1||b.height>1||Math.abs(b.rotation)>180)fail('默认摆放框大小或角度无效');
    const poly=zonePoints({shapeType:'ROTATED_RECT',x:b.centerX-b.width/2,y:b.centerY-b.height/2,width:b.width,height:b.height,rotation:b.rotation},image);
    if(!containsPolygon(zonePoints(z,image),poly))fail('默认摆放框必须完全位于允许区域内');
    if(zones.some(n=>n.zoneType==='no-logo'&&polygonOverlap(poly,zonePoints(n,image))))fail('默认摆放框不能与禁止区域重叠');
    return {id:unique(p.id,'预设'),name:label(p.name,'预设名称'),orientation:p.orientation,...(p.axisRotation!==undefined?{axisRotation:p.axisRotation}:{}),box:{...b},isDefault:!!p.isDefault};
   });
   if(presets.length&&presets.filter(p=>p.isDefault).length!==1)fail('每个区域必须有且只有一个默认摆放预设');
   return {id:unique(a.id,'区域'),carrierId:a.carrierId,name:label(a.name,'区域名称'),zoneIndex,autoEligible:a.autoEligible,foilProcesses:[...new Set(a.foilProcesses||[])],presets};
  });
  if(new Set(areas.map(a=>a.zoneIndex)).size!==areas.length)fail('同一个物理框应使用多个摆放预设，不应重复建立物理区域');
  const schemes=input.schemes.map(s=>{
   if(!['DEFAULT','ALTERNATIVE'].includes(s.role)||!Array.isArray(s.targets)||!s.targets.length||s.targets.length>30)fail('方案类型或目标数量无效');
   const targetAreas=new Set();
   const targets=s.targets.map(t=>{const a=areas.find(a=>a.id===t.areaId);if(!a||!a.autoEligible||!a.presets.some(p=>p.id===t.presetId))fail('方案目标必须关联可自动使用的区域及其预设');if(targetAreas.has(a.id))fail('同一方案不能在同一物理区域重复应用 Logo');targetAreas.add(a.id);return {areaId:a.id,presetId:t.presetId};});
   return {id:unique(s.id,'方案'),name:label(s.name,'方案名称'),role:s.role,targets};
  });
  if(schemes.length&&schemes.filter(s=>s.role==='DEFAULT').length!==1)fail('必须有且只有一个默认方案');
  if(schemes.filter(s=>s.role==='ALTERNATIVE').length>2)fail('最多只能设置 2 个备选方案');
  return {version:1,carriers,areas,schemes};
 }
 function get(templateId){const r=db.prepare('SELECT definitionJson FROM TemplateAutomation WHERE templateId=?').get(templateId);return r?JSON.parse(r.definitionJson):null;}
 function save(templateId,definition,zoneIds){if(!definition)return;const d={...definition,areas:definition.areas.map(a=>({...a,zoneId:zoneIds[a.zoneIndex]}))};db.prepare('INSERT INTO TemplateAutomation VALUES (?,?,?)').run(templateId,JSON.stringify(d),new Date().toISOString());}
 return {normalize,get,save};
}
