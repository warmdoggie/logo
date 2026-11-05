import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createSchemes,ensureMixedSchemes,editScheme} from './schemes.mjs';
import {masterTargetsFromTemplate,rebindMasterZones} from './product-master.mjs';
import {isCarton,resolveTargetPrint} from './target-print.mjs';
import {allowedFoilVersions} from './foil-selection.mjs';
import {mixedVersion,isMixedVersion,mixedVersionName,mixedVersionFinishes} from './generation-versions.mjs';
import {downloadKey,generationVersionsForProduct} from './download-selection.mjs';

const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
function fixture(choice){
 const view=x=>({foilTemplate:{id:'master-'+x},schemeState:createSchemes([{id:'body',carrierType:'BODY',x,y:.5,widthRatio:.1},{id:'box',carrierType:'CARTON_FRONT',x:.8,y:.5,widthRatio:.1}])});
 const a=view(.3),b=view(.6),versions=['ORIGINAL','BLACK','CUSTOM','GOLD FOIL','SILVER FOIL','ROSE GOLD FOIL','LASER FOIL'],nodes={'#generation-versions':{append(){}},'#preview-version':{append(){}}};
 const c=vm.createContext({generationVersionsForProduct,loadedTaskLogoId:null,taskDownloadOutputs:()=>[],downloadSelection:{},rebindMasterZones,structuredClone,mixedVersion,isMixedVersion,mixedVersionName,ensureMixedSchemes,addingPrintCombination:false,copyingProductPreset:false,generationBusy:false,generationSubmitting:false,multiPackageBusy:false,logoSelectionBusy:false,
  multiPackageProducts:[{id:'a',sku:'A'},{id:'b',sku:'B'}],multiProductViews:new Map([['a',a],['b',b]]),multiLogoViews:new Map(),selectedMultiProductId:'a',loadedMultiProductId:'a',schemeState:structuredClone(a.schemeState),schemeNames:Object.fromEntries(versions.map(v=>[v,v])),versionInputs:versions.map(value=>({value,checked:value==='ORIGINAL'})),
  document:{createElement:()=>({addEventListener(){}}),querySelector:selector=>nodes[selector]},fetch:async()=>({ok:true,json:async()=>({template:a.foilTemplate})}),loadMultiProductView:async product=>c.multiProductViews.get(product.id),choosePrintCombination:async templates=>{assert.equal(templates.length,1);assert.equal(templates[0],a.foilTemplate);return choice;},syncSchemeState(){},saveMultiProductView(){},createSchemeCards(){},switchScheme:version=>{c.activeScheme=version;},taskDraft:{schedule(){}},updateGenerateButton(){},queueSchemeCards(){},setStatus(){},selectedGenerationVersions:()=>c.versionInputs.filter(input=>input.checked).map(input=>input.value),
 });
 c.saveSchemeRemoval=()=>{};
 Object.assign(c,{downloadKey,schemeOutput:()=>null,updateDownloadSelection(){},updateAllSchemeSelection(){}});
 vm.runInContext(source.slice(source.indexOf('function changeSchemeSelection('),source.indexOf('function updateAllSchemeSelection(')),c);
 vm.runInContext(source.slice(source.indexOf('function reviveSchemeCard('),source.indexOf('function restoreRemovedScheme(')),c);
 const start=source.indexOf('function registerMixedVersions('),end=source.indexOf("document.querySelector('#add-print-combination').onclick",start);
 if(start>=0&&end>start)vm.runInContext(source.slice(start,end),c);
 return {c,a,b};
}
test('增加搭配仅修改当前 SKU，不影响其他产品的方案和位置',async()=>{
 const {c}=fixture({product:'ORIGINAL',carton:'GOLD FOIL'}),before=structuredClone(c.schemeState);
 await c.addPrintCombination();const version='MIX_ORIGINAL_GOLD';
 assert.equal(c.activeScheme,version);assert.equal(c.versionInputs.find(i=>i.value===version)?.checked,true);
 assert.equal(c.schemeState.schemes.find(s=>s.version===version).targets[0].x,.3);
 assert.equal(c.multiProductViews.get('b').schemeState.schemes.some(s=>s.version===version),false);
 assert.equal(c.schemeState.schemes.find(s=>s.version===version).targets[1].printFinish,'GOLD FOIL');
 assert.deepEqual(c.schemeState.schemes.find(s=>s.version==='CUSTOM'),before.schemes.find(s=>s.version==='CUSTOM'));
 await c.addPrintCombination();assert.equal(c.schemeState.schemes.filter(s=>s.version===version).length,1);
});
test('取消搭配保持原方案，普通原色组合复用已有卡片',async()=>{
 const cancelled=fixture(null),before=structuredClone(cancelled.c.schemeState);await cancelled.c.addPrintCombination();assert.deepEqual(cancelled.c.schemeState,before);
 const {c}=fixture({product:'ORIGINAL',carton:'ORIGINAL'});await c.addPrintCombination();assert.equal(c.activeScheme,'ORIGINAL');assert.equal(c.schemeState.schemes.length,7);
});

test('增加搭配可以重新选择已经取消的成图',async()=>{
 const {c}=fixture({product:'ORIGINAL',carton:'ORIGINAL'}),output={productId:'a',version:'ORIGINAL',dataUrl:'/original.png'};
 c.versionInputs.find(input=>input.value==='ORIGINAL').checked=false;
 c.schemeOutput=()=>output;c.taskDownloadOutputs=()=>[output];c.downloadSelection={[downloadKey(output)]:{dataUrl:output.dataUrl,selected:false}};
 c.selectedGenerationVersions=()=>generationVersionsForProduct(c.versionInputs.filter(input=>input.checked).map(input=>input.value),'a',[output],c.downloadSelection);
 await c.addPrintCombination();assert.deepEqual(Array.from(c.selectedGenerationVersions()),['ORIGINAL']);assert.equal(c.downloadSelection[downloadKey(output)].selected,true);
});

test('重新增加已删除搭配会恢复原卡片，不产生重复搭配',async()=>{
 const {c}=fixture({product:'ORIGINAL',carton:'ORIGINAL'});c.schemeState.removedSchemes=[{version:'ORIGINAL',selected:true}];
 await c.addPrintCombination();assert.equal(c.activeScheme,'ORIGINAL');assert.equal(c.schemeState.removedSchemes.length,0);assert.equal(c.schemeState.schemes.filter(scheme=>scheme.version==='ORIGINAL').length,1);
});

 test('恢复草稿同时恢复新增搭配和勾选，兼容仅在 SKU 或 Logo 布局保存的搭配',()=>{
 const {c}=fixture(null);
 c.restoreMixedVersions({selectedVersions:['MIX_ORIGINAL_GOLD'],multiProductLayouts:[{schemeState:{schemes:[{version:'MIX_ORIGINAL_GOLD'}]}}],multiLogoLayouts:[{schemeState:{schemes:[{version:'MIX_BLACK_SILVER'}]}}]});
 assert.equal(c.versionInputs.find(input=>input.value==='MIX_ORIGINAL_GOLD')?.checked,true);
 assert.equal(c.versionInputs.find(input=>input.value==='MIX_BLACK_SILVER')?.checked,false);
 assert.equal(c.schemeNames.MIX_BLACK_SILVER,'产品黑白 · 彩盒烫银');
 });

test('保存当前 SKU 布局保留母版工艺权限，新增搭配后不会全部变灰',()=>{
 const {c,a}=fixture(null),master=a.foilTemplate;
 Object.assign(c,{baseData:'base',baseImage:{},activeScheme:'ORIGINAL',placementScope:'shared',selectedTargetId:'body',lastResultPayload:null,savedSignatures:{},schemePhases:{},collectTargets:()=>[]});
 vm.runInContext(source.slice(source.indexOf('function saveMultiProductView(){'),source.indexOf('function captureMultiProductLayouts(){')),c);
 c.saveMultiProductView();assert.equal(c.multiProductViews.get('a').foilTemplate,master);
});

test('搭配的工艺下拉保持产品和彩盒选择，不能改成会与生成不一致的默认工艺',()=>{
 const finishInput={value:'VERSION',options:['VERSION','INK','BLACK','GOLD FOIL','SILVER FOIL'].map(value=>({value}))};
 Object.defineProperty(finishInput,'selectedOptions',{get:()=>finishInput.options.filter(option=>option.value===finishInput.value)});
 const c=vm.createContext({mixedVersionFinishes,isMixedVersion,activeScheme:'MIX_ORIGINAL_GOLD',multiProductViews:new Map([['a',{foilTemplate:{}}]]),loadedMultiProductId:'a',value:{masterZoneId:'p'},masterTargetsFromTemplate:()=>[],isCarton:target=>target.carrierType==='CARTON_FRONT',carrierInput:{value:'BODY',options:['BODY','CARTON_FRONT','CARTON_BACK'].map(value=>({value}))},finishInput,foilVersions:['GOLD FOIL','SILVER FOIL'],allowedFoilVersions:()=>['GOLD FOIL','SILVER FOIL'],readFoilRegions:()=>[],row:{querySelector:()=>({})},carrierNames:{},refreshDropdowns:[]});
 const start=source.indexOf('const syncPrintOptions=()=>'),end=source.indexOf('\n  syncPrintOptions();',start);vm.runInContext(source.slice(start,end)+';syncPrintOptions();',c);
 assert.equal(finishInput.value,'INK');assert.equal(finishInput.options.find(option=>option.value==='VERSION').disabled,true);
 assert.equal(finishInput.options.find(option=>option.value==='INK').disabled,false);
 c.carrierInput.value='CARTON_FRONT';vm.runInContext('syncPrintOptions()',c);
 assert.equal(finishInput.value,'GOLD FOIL');assert.equal(finishInput.options.find(option=>option.value==='BLACK').disabled,true);assert.equal(finishInput.options.find(option=>option.value==='GOLD FOIL').disabled,false);
 c.masterTargetsFromTemplate=()=>[{masterZoneId:'p',carrierType:'BODY'}];vm.runInContext('syncPrintOptions()',c);
 assert.equal(c.carrierInput.value,'BODY');assert.equal(c.carrierInput.options.find(option=>option.value==='CARTON_FRONT').disabled,true);assert.equal(finishInput.value,'INK');
});

test('实际母版省略 BODY 时，新增搭配仍显示产品 Logo 并可切回原色方案',()=>{
 const template={zones:[{id:'p',zoneType:'logo',name:'产品',x:.1,y:.2,width:.1,height:.3},{id:'c',zoneType:'logo',name:'彩盒',x:.7,y:.2,width:.1,height:.3}],automation:{carriers:[{id:'body',type:'BODY'},{id:'box',type:'CARTON'}],areas:[{zoneId:'p',carrierId:'body',foilProcesses:[]},{zoneId:'c',carrierId:'box'}]}};
 const masters=masterTargetsFromTemplate(template),version='MIX_ORIGINAL_SILVER',state=ensureMixedSchemes(createSchemes(masters),[version]),drawn=[];
 for(const target of state.schemes.find(scheme=>scheme.version===version).targets){
  const carrierInput={options:['BODY','CARTON_FRONT','CARTON_BACK'].map(value=>({value}))};let carrier=target.carrierType||'BODY';
  Object.defineProperty(carrierInput,'value',{get:()=>carrier,set:value=>{carrier=carrierInput.options.some(option=>option.value===String(value))?String(value):'';}});
  const finishInput={value:target.printFinish,options:['VERSION','INK','BLACK','SILVER FOIL'].map(value=>({value}))};Object.defineProperty(finishInput,'selectedOptions',{get:()=>finishInput.options.filter(option=>option.value===finishInput.value)});
  const c=vm.createContext({activeScheme:version,multiProductViews:new Map([['a',{foilTemplate:template}]]),loadedMultiProductId:'a',value:target,masterTargetsFromTemplate,isCarton,allowedFoilVersions,mixedVersionFinishes,isMixedVersion,carrierInput,finishInput,foilVersions:['GOLD FOIL','SILVER FOIL','ROSE GOLD FOIL','LASER FOIL'],readFoilRegions:()=>[],row:{querySelector:()=>({})},carrierNames:{},refreshDropdowns:[]});
  const start=source.indexOf('const syncPrintOptions=()=>'),end=source.indexOf('\n  syncPrintOptions();',start);vm.runInContext(source.slice(start,end)+';syncPrintOptions();',c);
  drawn.push({...target,carrierType:carrierInput.value,printFinish:finishInput.value});
 }
 assert.equal(drawn[0].carrierType,'BODY');assert.equal(resolveTargetPrint(drawn[0],version).version,'ORIGINAL');assert.equal(resolveTargetPrint(drawn[1],version).version,'SILVER FOIL');
 const previews=[],c=vm.createContext({schemeState:state,activeScheme:version,placementScope:'shared',syncSchemeState(){c.schemeState=editScheme(c.schemeState,c.activeScheme,drawn);},closePrintMenus(){},document:{querySelector:()=>({})},loadSchemeTargets(){for(const target of c.schemeState.schemes.find(scheme=>scheme.version===c.activeScheme).targets)previews.push(resolveTargetPrint(target,c.activeScheme).version);}});
 vm.runInContext(source.slice(source.indexOf('function switchScheme('),source.indexOf('function assetKey(')),c);c.switchScheme('ORIGINAL');assert.equal(c.activeScheme,'ORIGINAL');assert.deepEqual(previews,['ORIGINAL','ORIGINAL']);
});

test('切换 SKU 恢复各自生成选择，批量计划保留不同的搭配集合',()=>{
 const {c,a,b}=fixture(null);a.selectedVersions=['MIX_GOLD_ORIGINAL'];a.schemeState=ensureMixedSchemes(a.schemeState,a.selectedVersions);b.selectedVersions=['ORIGINAL'];
 c.restoreProductSelection(a);assert.equal(c.versionInputs.find(input=>input.value==='MIX_GOLD_ORIGINAL')?.checked,true);
 c.loadedMultiProductId='b';c.restoreProductSelection(b);assert.deepEqual(Array.from(c.selectedProductPlans(),plan=>({productId:plan.productId,selectedVersions:Array.from(plan.selectedVersions)})),[{productId:'a',selectedVersions:['MIX_GOLD_ORIGINAL']},{productId:'b',selectedVersions:['ORIGINAL']}]);
 assert.equal(c.versionInputs.find(input=>input.value==='MIX_GOLD_ORIGINAL').checked,false);
});
