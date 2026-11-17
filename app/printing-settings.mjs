import {randomUUID} from 'node:crypto';
import {requireProfessional} from './professional-access.mjs';
export const PRINT_METHODS={UV_PRINT:'UV印刷',PRINT_3D:'3D打印',SCREEN_PRINT:'丝印',HOT_STAMP:'烫印'};
export const FOIL_EFFECTS={GOLD:{name:'烫金',hex:'#c4a052'},SILVER:{name:'烫银',hex:'#bfc3c9'},ROSE_GOLD:{name:'烫玫瑰金',hex:'#b87f6c'},HOLOGRAPHIC:{name:'烫镭射',hex:'#9ca5c9'}};
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export function normalizePrintSettings(v){
 if(!v||!Array.isArray(v.allowed)||!v.allowed.length||v.allowed.length>4||v.allowed.some(p=>!Object.hasOwn(PRINT_METHODS,p)))fail('请勾选至少一种有效的适用工艺');
 const allowed=[...new Set(v.allowed)];if(!allowed.includes(v.defaultProcess))fail('默认工艺必须从适用工艺中选择');
 if(!['BLACK','WHITE'].includes(v.ink))fail('请由设计师预设黑色或白色油墨');
 return {allowed,defaultProcess:v.defaultProcess,ink:v.ink};
}
export function printingSettingsService(db){
 db.exec(`CREATE TABLE IF NOT EXISTS ProductPrintingSettings(id TEXT PRIMARY KEY,productId TEXT NOT NULL REFERENCES Product(id) ON DELETE CASCADE,version INTEGER NOT NULL,settingsJson TEXT NOT NULL,createdBy TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(productId,version))`);
 const get=id=>{const row=db.prepare('SELECT * FROM ProductPrintingSettings WHERE productId=? ORDER BY version DESC LIMIT 1').get(id);return row?{...JSON.parse(row.settingsJson),version:row.version,id:row.id,createdAt:row.createdAt}:{version:0,allowed:[],defaultProcess:null,ink:null};};
 function save(id,input,actor){requireProfessional(actor);if(!db.prepare('SELECT id FROM Product WHERE id=?').get(id))fail('产品不存在',404);const value=normalizePrintSettings(input),old=get(id);if(input.baseVersion!==old.version)fail('工艺资料已更新，请刷新后保存',409);const version=old.version+1;db.prepare('INSERT INTO ProductPrintingSettings VALUES (?,?,?,?,?,?)').run(randomUUID(),id,version,JSON.stringify(value),actor.username,new Date().toISOString());return get(id);}
 return {get,save};
}
export function legacyProcessAliases(process,color,foil){
 if(process==='HOT_STAMP')return foil==='GOLD'?['HOT_STAMP_GOLD']:foil==='SILVER'?['HOT_STAMP_SILVER']:[];
 return ['NORMAL_PRINT',...({'#000000':['BLACK_PRINT'],'#ffffff':['WHITE_PRINT'],'#c4a052':['GOLD_PRINT'],'#bfc3c9':['SILVER_PRINT']}[color?.toLowerCase()]||[])];
}
