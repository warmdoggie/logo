import {automationStore} from './template-automation.mjs';
import {zonePoints,pointInside,polygonError,bounds} from './public/zone-geometry.js';
import {sharp} from './logo-pixels.mjs';
import {randomUUID} from 'node:crypto';

export function templateService(db,storage) {
 const automation=automationStore(db);
 const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status});};
 const text=(v,label,max=120)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)fail(`${label}不能为空且不能超过 ${max} 字`);return v.trim();};
 const number=(v,label,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail(`${label}必须在 ${min}–${max} 之间`);return v;};
 const bool=(v,label)=>{if(typeof v!=='boolean')fail(`${label}必须为是或否`);return v?1:0;};
 function zones(input,image) {
  if(!Array.isArray(input)||!input.length||input.length>100)fail('请建立 1–100 个区域');
  let defaults=0,logos=0;
  const result=input.map((z,i)=>{
   if(!z||!['logo','no-logo'].includes(z.zoneType))fail('区域类型不正确');
   const shapeType=z.shapeType||'RECT';if(!['RECT','ROTATED_RECT','POLYGON'].includes(shapeType))fail('区域形状不正确');let points=null;if(shapeType==='POLYGON'){try{points=z.points||JSON.parse(z.pointsJson||'[]');}catch{fail('多边形节点格式不正确');}const error=polygonError(points);if(error)fail(error);z={...z,...bounds(points)};}const name=text(z.name,`区域 ${i+1} 名称`), x=number(z.x,'x',0,1), y=number(z.y,'y',0,1), width=number(z.width,'区域宽度',0.001,1),height=number(z.height,'区域高度',0.001,1);
   if(x+width>1.000001||y+height>1.000001)fail('区域不能超出产品图边界');
   if(typeof z.note!=='string'||z.note.length>2000)fail('备注不能超过 2000 字');
   const row={shapeType,rotation:shapeType==='ROTATED_RECT'?number(z.rotation,'区域角度',-180,180):0,pointsJson:points?JSON.stringify(points):null,zoneType:z.zoneType,name,x,y,width,height,defaultAnchorX:null,defaultAnchorY:null,maxLogoWidthRatio:null,maxLogoHeightRatio:null,defaultRotation:null,allowRotation:null,orientation:null,isDefault:null,note:z.note};
   const polygon=zonePoints(row,image);if(polygon.some(p=>p.x< -1e-7||p.y< -1e-7||p.x>1.0000001||p.y>1.0000001))fail('旋转区域不能超出产品图边界');
   if(z.zoneType==='logo'){
    logos++;
    row.defaultAnchorX=number(z.defaultAnchorX,'默认中心 x',0,1);row.defaultAnchorY=number(z.defaultAnchorY,'默认中心 y',0,1);
    if(!pointInside({x:row.defaultAnchorX,y:row.defaultAnchorY},polygon))fail('默认 Logo 中心必须在区域内');
    row.maxLogoWidthRatio=number(z.maxLogoWidthRatio,'最大 Logo 宽度比例',0.01,1);row.maxLogoHeightRatio=number(z.maxLogoHeightRatio,'最大 Logo 高度比例',0.01,1);
    row.defaultRotation=number(z.defaultRotation,'默认角度',-180,180);row.allowRotation=bool(z.allowRotation,'是否允许旋转');row.isDefault=bool(z.isDefault,'是否默认区域');defaults+=row.isDefault;
    if(!['horizontal','vertical','free'].includes(z.orientation))fail('默认方向不正确');row.orientation=z.orientation;
   }
   return row;
  });
  if(!logos)fail('至少需要一个 Logo 区域');if(defaults>1)fail('每个母版最多设置一个默认 Logo 区域');
  return result;
 }
 function get(productId,version) {
  const product=db.prepare('SELECT * FROM Product WHERE id=?').get(productId);if(!product)fail('产品不存在',404);
  const history=db.prepare('SELECT id, version, isCurrent, changeNote, createdAt FROM ProductTemplate WHERE productId=? ORDER BY version DESC').all(productId);
  let template;
  if(version!==null&&version!==undefined){if(!/^\d+$/.test(String(version)))fail('版本号不正确');template=db.prepare('SELECT * FROM ProductTemplate WHERE productId=? AND version=?').get(productId,Number(version));if(!template)fail('母版版本不存在',404);}
  else template=db.prepare('SELECT * FROM ProductTemplate WHERE productId=? AND isCurrent=1').get(productId);
  if(template)template={...template,zones:db.prepare('SELECT * FROM TemplateZone WHERE templateId=? ORDER BY rowid').all(template.id).map(z=>({...z,allowRotation:z.allowRotation===null?null:!!z.allowRotation,isDefault:z.isDefault===null?null:!!z.isDefault}))};
  const needsTemplateReview=!!template&&template.standardImage!==product.standardImage;if((version===null||version===undefined)&&needsTemplateReview)template=null;if(template)template.automation=automation.get(template.id);return {product,needsTemplateReview,template:template||null,history,currentVersion:history.find(h=>h.isCurrent)?.version||0};
 }
 async function publish(productId,input) {
  if(!input||typeof input!=='object')fail('母版数据不正确');
  const existing=db.prepare('SELECT * FROM Product WHERE id=?').get(productId);if(!existing)fail('产品不存在',404);const {info}=await sharp(storage.get(existing.standardImage)).rotate().png().toBuffer({resolveWithObject:true});const normalized=zones(input.zones,info);
  const definition=automation.normalize(input.automation,normalized,info);
  const base=number(input.baseVersion,'基准版本',0,Number.MAX_SAFE_INTEGER);if(!Number.isInteger(base))fail('基准版本不正确');
  const note=base?text(input.changeNote,'修改说明',1000):(typeof input.changeNote==='string'&&input.changeNote.trim()?text(input.changeNote,'修改说明',1000):'首次发布');
  db.exec('BEGIN IMMEDIATE');
  try{
   const product=db.prepare('SELECT * FROM Product WHERE id=?').get(productId);if(!product)fail('产品不存在',404);
   const current=db.prepare('SELECT version FROM ProductTemplate WHERE productId=? AND isCurrent=1').get(productId);
   if((current?.version||0)!==base)fail('母版已被其他页面更新，请重新进入编辑页后再发布',409);
   const id=randomUUID(),version=base+1;
   db.prepare('UPDATE ProductTemplate SET isCurrent=0 WHERE productId=? AND isCurrent=1').run(productId);
   db.prepare('INSERT INTO ProductTemplate VALUES (?,?,?,?,?,?,?)').run(id,productId,version,1,note,product.standardImage,new Date().toISOString());
   const insert=db.prepare('INSERT INTO TemplateZone (id,templateId,zoneType,name,x,y,width,height,defaultAnchorX,defaultAnchorY,maxLogoWidthRatio,maxLogoHeightRatio,defaultRotation,allowRotation,orientation,isDefault,note,shapeType,rotation,pointsJson) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
   const zoneIds=normalized.map(()=>randomUUID());
   for(const [index,z] of normalized.entries())insert.run(zoneIds[index],id,z.zoneType,z.name,z.x,z.y,z.width,z.height,z.defaultAnchorX,z.defaultAnchorY,z.maxLogoWidthRatio,z.maxLogoHeightRatio,z.defaultRotation,z.allowRotation,z.orientation,z.isDefault,z.note,z.shapeType,z.rotation,z.pointsJson);
   automation.save(id,definition,zoneIds);
   db.exec('COMMIT');return get(productId);
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 return {get,publish};
}
