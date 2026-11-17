import {randomUUID,createHash} from 'node:crypto';
import {sharp} from './logo-pixels.mjs';
import {referenceColor} from './smart-background.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=(m,s=400)=>{throw Object.assign(Error(m),{status:s});};
export const QUICK_COLORS={BLACK:'#000000',WHITE:'#ffffff',GOLD:'#c4a052',SILVER:'#bfc3c9'};
export function normalizeColorSpec(spec,resolveSample){
 if(!spec||typeof spec!=='object'||Array.isArray(spec))fail('颜色来源格式不正确');
 const mode=spec.mode;
 if(mode==='PANTONE'){if(typeof spec.pantone!=='string'||!spec.pantone.trim()||spec.pantone.length>60||/[\r\n<>]/.test(spec.pantone)||typeof spec.hex!=='string'||!/^#[\da-f]{6}$/i.test(spec.hex))fail('请填写客户明确的 Pantone 色号和用于屏幕预览的 HEX；系统不会自动推断色号');return {mode,pantone:spec.pantone.trim(),hex:spec.hex.toLowerCase()};}
 if(mode==='ORIGINAL')return {mode};
 if(mode==='REFERENCE'){if(typeof spec.sampleId!=='string'||!resolveSample)fail('请选择当前任务的参考色');const sample=resolveSample(spec.sampleId);return {mode,sampleId:sample.id,referenceId:sample.referenceId,hex:sample.hex.toLowerCase(),rgb:sample.rgb,point:sample.point,radius:sample.radius,algorithm:sample.algorithm,sourceSha:sample.sourceSha,previewSha:sample.previewSha};}
 if(mode==='QUICK'){const hex=QUICK_COLORS[spec.name];if(!hex)fail('常用颜色无效');return {mode,name:spec.name,hex,rgb:[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16))};}
 if(!['EXPLICIT_HEX','EXPLICIT_RGB','MANUAL'].includes(mode))fail('颜色来源无效');
 let hex;if(mode==='EXPLICIT_RGB'){if(!Array.isArray(spec.rgb)||spec.rgb.length!==3||spec.rgb.some(v=>!Number.isInteger(v)||v<0||v>255))fail('RGB 必须是三个 0–255 整数');hex='#'+spec.rgb.map(v=>v.toString(16).padStart(2,'0')).join('');}else{if(typeof spec.hex!=='string'||!/^#[\da-f]{6}$/i.test(spec.hex))fail('HEX 颜色格式不正确');hex=spec.hex.toLowerCase();}
 const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));if(spec.hex!==undefined&&String(spec.hex).toLowerCase()!==hex)fail('HEX 与 RGB 不一致');if(spec.rgb!==undefined&&JSON.stringify(spec.rgb)!==JSON.stringify(rgb))fail('HEX 与 RGB 不一致');return {mode,hex,rgb};
}
export function colorReferenceService(db,storage){
 db.exec(`CREATE TABLE IF NOT EXISTS ColorReference(id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES Task(id),fileName TEXT NOT NULL,filePath TEXT NOT NULL,previewPath TEXT NOT NULL,sourceSha TEXT NOT NULL,previewSha TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,createdAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS ColorSample(id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES Task(id),referenceId TEXT NOT NULL REFERENCES ColorReference(id),sampleJson TEXT NOT NULL,createdAt TEXT NOT NULL);`);
 const task=id=>{if(!db.prepare('SELECT id FROM Task WHERE id=?').get(id))fail('任务不存在',404);};
 const writable=id=>{task(id);if(db.prepare('SELECT lifecycle FROM TaskManagement WHERE taskId=?').get(id)?.lifecycle==='ARCHIVED')fail('请先恢复已归档任务',409);};
 const intact=r=>{try{if(sha(storage.get(r.filePath))!==r.sourceSha||sha(storage.get(r.previewPath))!==r.previewSha)throw Error();}catch{fail('参考图缺失或已变化，请重新上传取色',409);}};
 const decode=r=>({...JSON.parse(r.sampleJson),id:r.id,referenceId:r.referenceId,createdAt:r.createdAt});
 function resolve(taskId,id){const r=db.prepare('SELECT * FROM ColorSample WHERE id=? AND taskId=?').get(id,taskId);if(!r)fail('参考色不属于当前任务');const ref=db.prepare('SELECT * FROM ColorReference WHERE id=? AND taskId=?').get(r.referenceId,taskId);if(!ref)fail('参考图不存在',404);intact(ref);return decode(r);}
 async function upload(id,file){writable(id);if(!file||typeof file.arrayBuffer!=='function'||!file.size||file.size>12*1024*1024)fail('请选择 12 MB 以内的 PNG、JPG 或 WebP 参考图');const bytes=Buffer.from(await file.arrayBuffer());let m,preview;try{m=await sharp(bytes,{limitInputPixels:16000000}).metadata();if(!['png','jpeg','webp'].includes(m.format)||m.pages>1)fail('仅支持单帧 PNG、JPG 或 WebP');preview=await sharp(bytes,{limitInputPixels:16000000}).rotate().png().toBuffer();}catch(e){fail('参考图无法读取：'+e.message);}const p=await sharp(preview).metadata();const keys=[];try{writable(id);const filePath=storage.put(bytes,m.format==='jpeg'?'jpg':m.format);keys.push(filePath);const previewPath=storage.put(preview,'png');keys.push(previewPath);const row={id:randomUUID(),taskId:id,fileName:String(file.name||'参考图').slice(0,240),filePath,previewPath,sourceSha:sha(bytes),previewSha:sha(preview),width:p.width,height:p.height,createdAt:new Date().toISOString()};db.prepare('INSERT INTO ColorReference VALUES (?,?,?,?,?,?,?,?,?,?)').run(...Object.values(row));return row;}catch(e){keys.forEach(k=>storage.remove(k));throw e;}}
 async function sample(id,value){writable(id);const r=db.prepare('SELECT * FROM ColorReference WHERE id=? AND taskId=?').get(value?.referenceId||'',id);if(!r)fail('参考图不属于当前任务');intact(r);const radius=value.radius??2;let color;try{color=await referenceColor(storage.get(r.previewPath),value.x,value.y,radius);}catch(e){fail(e.message);}writable(id);intact(r);const data={hex:color.hex.toLowerCase(),rgb:color.rgb,point:{x:value.x,y:value.y},radius,algorithm:'ALPHA_WEIGHTED_SQUARE_V1',sourceSha:r.sourceSha,previewSha:r.previewSha};const sampleId=randomUUID(),createdAt=new Date().toISOString();db.prepare('INSERT INTO ColorSample VALUES (?,?,?,?,?)').run(sampleId,id,r.id,JSON.stringify(data),createdAt);return {...data,id:sampleId,referenceId:r.id,createdAt};}
 return {upload,sample,resolve,page:id=>{task(id);return {references:db.prepare('SELECT * FROM ColorReference WHERE taskId=? ORDER BY rowid DESC').all(id),samples:db.prepare('SELECT * FROM ColorSample WHERE taskId=? ORDER BY rowid DESC').all(id).map(decode)};},normalize:(id,s)=>normalizeColorSpec(s,sampleId=>resolve(id,sampleId))};
}
