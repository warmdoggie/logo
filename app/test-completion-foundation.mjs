import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {ruleService,compareCondition} from './rule-engine.mjs';
import {targetOverrideService} from './target-overrides.mjs';
import {transformPlacement} from './public/placement-transform.js';
import {autoPlace} from './public/auto-placement.js';
test('非方图默认框旋转缩放与反变换、沿长轴和跟随区域方向',()=>{
 const image={width:1600,height:900},before={x:.1,y:.2,width:.3,height:.5,rotation:25},after={x:.2,y:.1,width:.4,height:.6,rotation:55};
 const box={centerX:.25,centerY:.45,width:.1,height:.1,rotation:25};const moved=transformPlacement(box,before,after,image),back=transformPlacement(moved,after,before,image);
 for(const k of Object.keys(box))assert.ok(Math.abs(back[k]-box[k])<1e-10,k);assert.equal(moved.rotation,55);
 const zone={shapeType:'RECT',zoneType:'logo',x:0,y:0,width:1,height:1,maxLogoWidthRatio:1,maxLogoHeightRatio:1,rotation:0};
 const preset={orientation:'long-axis',box:{centerX:.5,centerY:.5,width:.1,height:.6,rotation:0}};
 assert.equal(autoPlace(zone,preset,[zone],image,{width:100,height:30}).rotation,90);
 assert.equal(autoPlace({...zone,shapeType:'ROTATED_RECT',rotation:20},{...preset,orientation:'follow-body'},[zone],image,{width:100,height:30}).rotation,20);
});
test('规则多选、多个推荐工艺、历史保真及删除后重新发布',()=>{
 const db=new DatabaseSync(':memory:');try{
 for(const name of ['schema.sql','rule-schema.sql','management-schema.sql'])db.exec(readFileSync(new URL(name,import.meta.url),'utf8'));
 const service=ruleService(db,{}),actor={username:'admin',role:'ADMIN'};
 const input={ruleCode:'MULTI',name:'本体不可烫金银',scopeType:'GLOBAL',resultType:'BLOCK',hardness:'HARD',businessMessage:'不能使用烫金、烫银',internalNote:'',recommendedAction:'',recommendedProcesses:['NORMAL_PRINT','BLACK_PRINT'],enabled:true,isExample:false,baseVersion:0,conditions:[{field:'processType',operator:'IN',value:['HOT_STAMP_GOLD','HOT_STAMP_SILVER']}]};
 const a=service.publish(input,actor);assert.deepEqual(a.recommendedProcesses,input.recommendedProcesses);
 for(const processType of ['HOT_STAMP_GOLD','HOT_STAMP_SILVER'])assert.equal(compareCondition({processType},a.conditions[0]),true);
 assert.equal(compareCondition({processType:'NORMAL_PRINT'},a.conditions[0]),false);
 assert.throws(()=>service.publish({...input,ruleCode:'EMPTY',conditions:[{field:'processType',operator:'IN',value:[]}]},actor));
 assert.throws(()=>service.publish({...input,ruleCode:'CONFLICT',recommendedProcesses:['HOT_STAMP_GOLD']},actor));
 service.remove(a.id,actor);assert.equal(service.list().length,0);const old=service.getRule(a.id);assert.equal(old.enabled,true);assert.equal(old.createdBy,a.createdBy);assert.equal(old.updatedAt,a.updatedAt);
 assert.throws(()=>service.publish(input,actor),/已更新/);
 const b=service.publish({...input,baseVersion:1},actor);assert.equal(b.version,2);assert.deepEqual(service.getRule(a.id).recommendedProcesses,input.recommendedProcesses);
 assert.deepEqual(ruleService(db,{}).getRule(b.id).conditions,input.conditions);
 }finally{db.close();}
});
test('任务限定摆放：区域预设切换、关闭目标、越权及空方案拒绝、默认恢复',()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec(`CREATE TABLE Task(id TEXT PRIMARY KEY);CREATE TABLE TaskManagement(taskId TEXT,lifecycle TEXT);CREATE TABLE Product(id TEXT,sku TEXT);CREATE TABLE TaskProduct(id TEXT,taskId TEXT,productId TEXT);CREATE TABLE TaskProductLifecycle(taskProductId TEXT,lifecycle TEXT);CREATE TABLE TaskProductTemplate(taskProductId TEXT,templateId TEXT);CREATE TABLE TemplateAutomation(templateId TEXT,definitionJson TEXT);CREATE TABLE ProductTemplate(id TEXT,standardImage TEXT);CREATE TABLE TemplateZone(templateId TEXT);INSERT INTO ProductTemplate VALUES ('tpl','test.png');INSERT INTO Task VALUES ('t');INSERT INTO Product VALUES ('p','SKU');INSERT INTO TaskProduct VALUES ('tp','t','p');INSERT INTO TaskProductTemplate VALUES ('tp','tpl');`);
 const definition={carriers:[{id:'body'},{id:'carton'}],areas:[{id:'a',carrierId:'body',autoEligible:true,presets:[{id:'h'},{id:'v'}]},{id:'b',carrierId:'carton',autoEligible:true,presets:[{id:'c'}]}],schemes:[{id:'A',targets:[{areaId:'a',presetId:'h'},{areaId:'b',presetId:'c'}]}]};
 db.prepare('INSERT INTO TemplateAutomation VALUES (?,?)').run('tpl',JSON.stringify(definition));const api=targetOverrideService(db,()=>false),actor={username:'sales'};
 const settings=[{taskProductId:'tp',schemeId:'A',sourceAreaId:'a',areaId:'a',presetId:'v',disabled:false},{taskProductId:'tp',schemeId:'A',sourceAreaId:'b',areaId:'b',presetId:'c',disabled:true}];
 api.save('t',{baseVersion:0,settings},actor);assert.deepEqual(api.resolve(definition,definition.schemes[0],api.current('t').settings,'tp'),[{areaId:'a',presetId:'v'}]);
 assert.throws(()=>api.save('t',{baseVersion:1,settings:settings.map(o=>({...o,disabled:true}))},actor),/至少保留/);
 assert.throws(()=>api.save('t',{baseVersion:1,settings:[{...settings[0],taskProductId:'other'}]},actor),/不属于/);
 assert.throws(()=>api.save('t',{baseVersion:1,settings:[{...settings[0],areaId:'b',presetId:'c'}]},actor),/同一载体/);
 assert.throws(()=>api.save('t',{baseVersion:0,settings:[]},actor),/已变化/);
 api.save('t',{baseVersion:1,settings:[]},actor);assert.deepEqual(api.resolve(definition,definition.schemes[0],api.current('t').settings,'tp'),definition.schemes[0].targets);
 assert.deepEqual(JSON.parse(db.prepare('SELECT definitionJson FROM TemplateAutomation').get().definitionJson),definition);
 assert.equal(db.prepare('SELECT count(*) n FROM TaskTargetOverrides').get().n,2);
 }finally{db.close();}
});
