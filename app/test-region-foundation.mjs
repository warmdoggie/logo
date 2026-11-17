import {test} from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {automationStore} from './template-automation.mjs';
import {normalizeRegionPrinting,regionPolicy,manufacturingAllowed} from './region-printing.mjs';
import {validateManualPlacement} from './public/manual-placement.js';
import {chooseCartonInk} from './carton-ink.mjs';import {sharp} from './logo-pixels.mjs';
import {regionChoices,normalizeAreaOverrides} from './region-sales.mjs';
test('区域工艺：产品硬阻止、彩盒烫印仅警告且不能覆盖其他阻止',()=>{
 const settings=normalizeRegionPrinting({allowed:['UV_PRINT'],defaultProcess:'UV_PRINT',ink:'BLACK'},{type:'BODY'});
 assert.equal(regionPolicy(settings,{type:'BODY'},'HOT_STAMP').status,'BLOCK');
 assert.equal(regionPolicy(settings,{type:'CARTON'},'HOT_STAMP').status,'WARNING');
 assert.equal(regionPolicy(settings,{type:'CARTON'},'PRINT_3D').status,'BLOCK');
 assert.equal(manufacturingAllowed({overallStatus:'WARNING',matchedRules:[{result:'WARNING',ruleCode:'CARTON_FOIL'}]},true),true);
 assert.equal(manufacturingAllowed({overallStatus:'WARNING',matchedRules:[{result:'WARNING',ruleCode:'OTHER'}]},true),false);
 assert.equal(manufacturingAllowed({overallStatus:'BLOCK',matchedRules:[]},true),false);
});
test('V2 母版不需要旧方案，自动覆盖所有配置区域，默认摆放仍留在安全范围',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE ProductTemplate(id TEXT PRIMARY KEY)');const store=automationStore(db);
 const zone={zoneType:'logo',x:.1,y:.1,width:.8,height:.8},area={id:'a',carrierId:'c',name:'产品正面',zoneIndex:0,autoEligible:true,printing:{allowed:['UV_PRINT'],defaultProcess:'UV_PRINT',ink:'WHITE'},presets:[{id:'p',name:'默认',orientation:'horizontal',isDefault:true,box:{centerX:.5,centerY:.5,width:.3,height:.2,rotation:0}}]};
 const input={version:2,carriers:[{id:'c',name:'产品',type:'BODY'}],areas:[area]};
 const d=store.normalize(input,[zone],{width:800,height:1000});assert.equal(d.schemes.length,1);assert.equal(d.schemes[0].targets.length,1);assert.equal(d.areas[0].printing.ink,'WHITE');
 assert.throws(()=>store.normalize({...input,areas:[]},[zone],{width:800,height:1000}),/每个 Logo/);
 assert.throws(()=>store.normalize({...input,areas:[{...area,printing:{...area.printing,defaultProcess:'HOT_STAMP'}}]},[zone],{width:800,height:1000}),/默认工艺/);db.close();
});
test('手动调整可超过蓝框和预设但不能覆盖禁区或离开图片',()=>{
 const image={width:800,height:1000},logo={width:200,height:100},zones=[{zoneType:'logo',x:.1,y:.1,width:.1,height:.1},{zoneType:'no-logo',name:'成分表',x:.7,y:.7,width:.2,height:.2}];
 assert.deepEqual(validateManualPlacement({x:.4,y:.4,widthRatio:.3,rotation:45},zones,image,logo),[]);
 assert.match(validateManualPlacement({x:.8,y:.8,widthRatio:.2,rotation:0},zones,image,logo).join(),/禁止/);
 assert.match(validateManualPlacement({x:.01,y:.01,widthRatio:.4,rotation:0},zones,image,logo).join(),/移出/);
});
test('彩盒本地判色：白底黑字、黑底白字，混色必须人工二选一',async()=>{
 const image={width:200,height:200},logo={width:100,height:100},p={x:.5,y:.5,widthRatio:.8,rotation:0};
 const make=background=>sharp({create:{...image,channels:3,background}}).png().toBuffer();
 assert.equal((await chooseCartonInk(await make('#ffffff'),p,image,logo)).hex,'#000000');assert.equal((await chooseCartonInk(await make('#000000'),p,image,logo)).hex,'#ffffff');
 const mixed=await sharp(await make('#ffffff')).composite([{input:Buffer.from('<svg width="200" height="200"><rect width="100" height="200" fill="black"/></svg>')}]).png().toBuffer();assert.equal((await chooseCartonInk(mixed,p,image,logo)).status,'CHOICE_REQUIRED');
});
test('产品与彩盒选择独立：普通色同步，烫印转彩盒黑白，手动覆盖保留',()=>{
 const area=(id,type,allowed)=>({area:{id,name:id,printing:{allowed,defaultProcess:'SCREEN_PRINT',ink:type==='CARTON'?'AUTO':'WHITE'}},carrier:{type}}),plan={targets:[area('p','BODY',['SCREEN_PRINT','HOT_STAMP']),area('b','CARTON',['SCREEN_PRINT'])]},item={id:'i'},draft={foil:'SILVER',overrides:{}};
 const ink=regionChoices(plan,item,'INK',draft);assert.equal(ink[1].appearance.hex,'#ffffff');const foil=regionChoices(plan,item,'FOIL',draft);assert.equal(foil[0].process,'HOT_STAMP');assert.equal(foil[1].process,'SCREEN_PRINT');assert.equal(foil[1].appearance.mode,'AUTO_BW');
 draft.overrides['i:FOIL']={areas:normalizeAreaOverrides({b:{appearance:{mode:'SOLID',hex:'#ff0000'}}},['p','b'])};assert.equal(regionChoices(plan,item,'FOIL',draft)[1].appearance.hex,'#ff0000');assert.throws(()=>normalizeAreaOverrides({foreign:{}},['p','b']),/不属于/);
});
