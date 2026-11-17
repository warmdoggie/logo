import {test} from 'node:test';
import assert from 'node:assert/strict';
import {regionChoices,regionChoiceSignature} from './region-sales.mjs';
import {normalizeSalesDraft} from './sales-workflow.mjs';
import {manufacturingAllowed} from './region-printing.mjs';

const target=(id,carton,allowed=['SCREEN_PRINT','HOT_STAMP'])=>({area:{id,name:carton?'彩盒':'产品',printing:{allowed,defaultProcess:'SCREEN_PRINT',ink:carton?'AUTO':'WHITE'}},carrier:{type:carton?'CARTON':'BODY'}});
const product=target('product',false),carton=target('carton',true,['SCREEN_PRINT']),plan={targets:[product,carton]},item={id:'item',templateId:'v1'},draft={schemes:['FOIL'],foil:'SILVER',productIds:['item'],overrides:{}};

test('烫印目标独立：产品、彩盒、两者；每种颜色实际区域与所选一致',()=>{
 for(const foil of ['GOLD','SILVER','ROSE_GOLD','HOLOGRAPHIC'])for(const targets of [['PRODUCT'],['CARTON'],['PRODUCT','CARTON']]){
  const rows=regionChoices(plan,item,'FOIL',{...draft,foil,foilTargets:targets});
  assert.equal(rows[0].process,targets.includes('PRODUCT')?'HOT_STAMP':'SCREEN_PRINT');
  assert.equal(rows[1].process,targets.includes('CARTON')?'HOT_STAMP':'SCREEN_PRINT');
  for(const row of rows.filter(r=>r.process==='HOT_STAMP'))assert.equal(row.appearance.foil,foil);
  if(!targets.includes('CARTON'))assert.equal(rows[1].appearance.mode,'AUTO_BW');
  if(!targets.includes('PRODUCT'))assert.equal(rows[0].appearance.mode,'ORIGINAL');
  if(targets.includes('CARTON'))assert.equal(rows[1].policy.code,'CARTON_FOIL');
 }
 const ink=regionChoices(plan,item,'INK',{...draft,foilTargets:['CARTON']});assert.deepEqual(ink.map(r=>r.appearance),[{mode:'SOLID',hex:'#ffffff'},{mode:'SOLID',hex:'#ffffff'}]);
});

test('产品严格禁止；彩盒软提醒不能给产品越权；允许明确选择仅继续彩盒',()=>{
 const blockedPlan={targets:[target('product',false,['SCREEN_PRINT']),carton]};
 const forged={...draft,foilTargets:['PRODUCT'],overrides:{'item:FOIL':{areas:{product:{cartonFoilConfirmed:true}}}}};
 assert.throws(()=>regionChoices(blockedPlan,item,'FOIL',forged),e=>e.issueType==='PROCESS_BLOCK'&&!e.detail);
 let detail;try{regionChoices(blockedPlan,item,'FOIL',{...draft,foilTargets:['PRODUCT','CARTON']});}catch(e){detail=e.detail;}
 assert.equal(detail.type,'PRODUCT_FOIL_BLOCK');assert.equal(detail.fallback[0].process,'SCREEN_PRINT');
 const areas=Object.fromEntries(detail.fallback.map(({areaId,...value})=>[areaId,value]));
 const rows=regionChoices(blockedPlan,item,'FOIL',{...draft,foilTargets:['PRODUCT','CARTON'],overrides:{'item:FOIL':{areas}}});assert.equal(rows[0].process,'SCREEN_PRINT');assert.equal(rows[1].policy.code,'CARTON_FOIL');
 assert.equal(manufacturingAllowed({testOnly:false,overallStatus:'BLOCK',matchedRules:[{result:'BLOCK',ruleCode:'PRODUCT'}]},true),false);
 assert.equal(manufacturingAllowed({testOnly:false,overallStatus:'WARNING',matchedRules:[{result:'WARNING',ruleCode:'CARTON_FOIL'}]},false),false);
 assert.equal(manufacturingAllowed({testOnly:false,overallStatus:'WARNING',matchedRules:[{result:'WARNING',ruleCode:'CARTON_FOIL'}]},true),true);
});

test('名称不会绕过区域归属；无目标、空选择、未知目标拒绝',()=>{
 const namedCarton={...product,area:{...product.area,name:'彩盒',printing:{...product.area.printing,allowed:['SCREEN_PRINT']}}};
 assert.throws(()=>regionChoices({targets:[namedCarton]},item,'FOIL',{...draft,foilTargets:['PRODUCT']}),/产品区域不支持/);
 assert.throws(()=>regionChoices({targets:[namedCarton]},item,'FOIL',{...draft,foilTargets:['CARTON']}),/没有所选的烫印区域/);
 for(const foilTargets of [[],['NOPE'],['PRODUCT','CARTON','PRODUCT']])assert.throws(()=>normalizeSalesDraft({...draft,foilTargets},[item]),/烫印区域/);
});

test('已有未选择目标的方案保持兼容；范围变化会使旧图失效',()=>{
 const old=regionChoices(plan,item,'FOIL',draft);assert.equal(old[0].process,'HOT_STAMP');assert.equal(old[1].process,'SCREEN_PRINT');
 assert.equal(regionChoices({targets:[carton]},item,'FOIL',draft)[0].process,'HOT_STAMP');
 assert.equal(Object.hasOwn(normalizeSalesDraft(draft,[item]),'foilTargets'),false);
 assert.notEqual(regionChoiceSignature(item,'FOIL',draft),regionChoiceSignature(item,'FOIL',{...draft,foilTargets:['CARTON']}));
 assert.equal(regionChoiceSignature(item,'ORIGINAL',draft),regionChoiceSignature(item,'ORIGINAL',{...draft,foilTargets:['CARTON']}));
});
