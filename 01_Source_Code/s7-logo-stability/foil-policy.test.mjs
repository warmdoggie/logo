import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFoilPolicy} from './foil-policy.mjs';

function fixture(){
 const zones=[{id:'body',zoneType:'logo',name:'瓶身'},{id:'carton',zoneType:'logo',name:'彩盒'}];
 const template={id:'master-1',version:1,zones,automation:{carriers:[{id:'b',type:'BODY'},{id:'c',type:'CARTON'}],areas:[{zoneId:'body',carrierId:'b',foilProcesses:['GOLD FOIL']},{zoneId:'carton',carrierId:'c',foilProcesses:[]}]}};
 const policy=createFoilPolicy({productCatalog:async()=>[{id:'p',sku:'E0049'}],productTemplate:async()=>({template})});
 const targets=[{id:'t1',masterZoneId:'body',carrierType:'BODY'},{id:'t2',masterZoneId:'carton',carrierType:'CARTON_FRONT',printFinish:'INK'}];
 const input={taskId:'task',productId:'p',selectedVersions:['GOLD FOIL'],foilRegions:['product'],targets,schemes:[{version:'GOLD FOIL',targets:structuredClone(targets)}]};
 return {policy,template,input};
}

test('产品按母版允许工艺校验，未选彩盒保持油墨',async()=>{
 const {policy,input}=fixture(),out=await policy.prepare(input,{}, {userId:'u',requireConfirmation:true});
 assert.equal(out.report.blocked.length,0);assert.equal(out.report.warnings.length,0);
 assert.equal(out.input.schemes[0].targets[0].printFinish,'GOLD FOIL');
 assert.equal(out.input.schemes[0].targets[1].printFinish,'INK');
});
test('彩盒需要本次确认，知晓后实际保留彩盒烫印',async()=>{
 const {policy,input}=fixture();input.foilRegions=['carton'];
 const preview=await policy.prepare(input,{}, {userId:'u'});
 assert.equal(preview.report.warnings.length,1);assert.ok(preview.report.confirmationToken);
 await assert.rejects(()=>policy.prepare(input,{}, {userId:'u',requireConfirmation:true}),e=>e.code==='CARTON_FOIL_CONFIRMATION_REQUIRED');
 const out=await policy.prepare({...input,foilAcknowledgement:preview.report.confirmationToken},{},{userId:'u',requireConfirmation:true});
 assert.equal(out.input.schemes[0].targets[0].printFinish,'INK');
 assert.equal(out.input.schemes[0].targets[1].printFinish,'GOLD FOIL');
 assert.equal(out.input.foilAudit.cartonAcknowledged,true);
});
test('产品硬禁止优先于彩盒确认，伪造载体不能绕过',async()=>{
 const {policy,input}=fixture();input.selectedVersions=['SILVER FOIL'];input.schemes[0].version='SILVER FOIL';input.foilRegions=['product','carton'];
 input.schemes[0].targets[0].carrierType='CARTON_FRONT';
 const preview=await policy.prepare(input,{}, {userId:'u'});
 assert.equal(preview.report.blocked.length,1);assert.equal(preview.report.confirmationToken,undefined);
 await assert.rejects(()=>policy.prepare({...input,foilAcknowledgement:'forged'},{},{userId:'u',requireConfirmation:true}),e=>e.code==='FOIL_BLOCKED');
});
test('确认绑定用户、母版版本、区域、工艺和目标位置',async()=>{
 const {policy,input,template}=fixture();input.foilRegions=['carton'];
 const {report}=await policy.prepare(input,{}, {userId:'u'});input.foilAcknowledgement=report.confirmationToken;
 for(const change of [v=>v.foilRegions.push('product'),v=>v.schemes[0].targets[1].x=.7]){
  const changed=structuredClone(input);change(changed);
  await assert.rejects(()=>policy.prepare(changed,{}, {userId:'u',requireConfirmation:true}),e=>e.code==='CARTON_FOIL_CONFIRMATION_REQUIRED');
 }
 await assert.rejects(()=>policy.prepare(input,{}, {userId:'other',requireConfirmation:true}),e=>e.code==='CARTON_FOIL_CONFIRMATION_REQUIRED');
 template.version=2;
 await assert.rejects(()=>policy.prepare(input,{}, {userId:'u',requireConfirmation:true}),e=>e.code==='CARTON_FOIL_CONFIRMATION_REQUIRED');
});
test('过期区域身份被拒绝，非烫印仍可使用原流程',async()=>{
 const {policy,input}=fixture();input.schemes[0].targets[0].masterZoneId='old-zone';
 await assert.rejects(()=>policy.prepare(input,{},{}),/母版.*更新|区域.*母版/);
 const plain={selectedVersions:['ORIGINAL'],targets:[{id:'manual'}]};
 assert.deepEqual((await policy.prepare(plain,{},{})).input,plain);
});
test('单产品生成不能注入其他模式的布局替代实际目标校验',async()=>{
 const {policy,input}=fixture();
 for(const extra of [{productIds:['p'],productLayouts:[{productId:'p',targets:[]}]},{logoLayouts:[{logoId:'fake',targets:[]}]}]){
  await assert.rejects(()=>policy.prepare({...input,...extra},{},{mode:'single'}),/生成模式|布局/);
 }
});
test('多 Logo 自动补全并校验每个 Logo 布局，不留下未校验回退',async()=>{
 const {policy,input}=fixture();input.foilRegions=['carton'];input.logos=[{id:'one'},{id:'two'}];
 input.logoLayouts=[{logoId:'one',targets:input.targets,schemes:input.schemes}];
 const preview=await policy.prepare(input,{}, {mode:'multi-logo'});
 assert.equal(preview.input.logoLayouts.length,2);
 for(const layout of preview.input.logoLayouts){assert.equal(layout.targets[0].masterZoneId,'body');assert.equal(layout.schemes[0].targets[0].printFinish,'INK');assert.equal(layout.schemes[0].targets[1].printFinish,'GOLD FOIL');}
});
test('只重做指定产品时不被其他未生成产品的工艺阻止',async()=>{
 const {template,input}=fixture();
 const policy=createFoilPolicy({productCatalog:async()=>[{id:'p',sku:'可烫印'},{id:'q',sku:'不可烫印'}],productTemplate:async product=>({template:product.id==='p'?template:{...template,automation:{...template.automation,areas:template.automation.areas.map(a=>({...a,foilProcesses:[]}))}}})});
 const batch={...input,productIds:['p','q'],productLayouts:['p','q'].map(productId=>({productId,targets:input.targets,schemes:input.schemes})),onlyProductId:'p'};delete batch.productId;
 const result=await policy.prepare(batch,{}, {mode:'multi-product',requireConfirmation:true});
 assert.equal(result.report.blocked.length,0);assert.equal(result.input.productLayouts.length,2);
});
test('跨模式重做参数不能让实际生成对象跳过校验',async()=>{
 const {policy,input}=fixture();
 for(const [mode,extra] of [
  ['single',{logos:[{id:'x'}],onlyLogoId:'x'}],
  ['multi-product',{productIds:['p'],productLayouts:[{productId:'p',targets:input.targets,schemes:input.schemes}],logos:[{id:'x'}],onlyLogoId:'x'}],
  ['multi-logo',{logos:[{id:'x'}],productIds:['other'],onlyProductId:'other'}]
 ])await assert.rejects(()=>policy.prepare({...input,...extra},{},{mode,requireConfirmation:true}),/生成模式|重做/);
});
