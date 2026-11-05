import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createSchemes,ensureMixedSchemes} from './schemes.mjs';
const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
function workspace(){
 const a=ensureMixedSchemes(createSchemes([{id:'p',x:.5,y:.5,widthRatio:.1}]),['MIX_GOLD_ORIGINAL']),b=createSchemes([{id:'q',x:.3,y:.5,widthRatio:.1}]);
 const views=new Map([['a',{schemeState:a,selectedVersions:['MIX_GOLD_ORIGINAL']}],['b',{schemeState:b,selectedVersions:['ORIGINAL','BLACK']}]]),requests=[];
 const c=vm.createContext({structuredClone,copyingProductPreset:false,generationSubmitting:false,generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,multiPackageProducts:[{id:'a'},{id:'b'}],selectedMultiProductId:'a',loadedMultiProductId:'a',multiProductViews:views,currentTaskId:'task',s7User:{id:'u'},logoData:'logo',mockupModel:{value:'local'},
 selectedGenerationVersions:()=>['MIX_GOLD_ORIGINAL'],captureMultiProductLayouts:()=>[...views].map(([productId,view])=>({productId,schemeState:view.schemeState,selectedVersions:view.selectedVersions,targets:view.schemeState.sharedTargets})),loadMultiProductView:async product=>views.get(product.id),schemeSignature:()=>'',showGenerationSubmission:async()=>{},taskDraft:{flush:async()=>{}},generationWatcher:{track(){}},updateGenerateButton(){},setStatus(){},failGenerationSubmission:(_versions,error)=>{throw error;},
 fetch:async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});return {ok:true,json:async()=>({id:'job',status:'running'})};}});
 const helper=source.indexOf('function selectedProductPlans(){');if(helper>=0)vm.runInContext(source.slice(helper,source.indexOf('function restoreMixedVersions',helper)),c);
 const start=source.indexOf('async function runMultiPackageGeneration(');vm.runInContext(source.slice(start,source.indexOf("document.querySelector('#generate').onclick=",start)),c);
 return {c,requests,views};
}
test('批量提交按 SKU 的选择生成，顶部版本为各产品实际请求的并集',async()=>{
 const {c,requests}=workspace();await c.runMultiPackageGeneration();const input=requests[0].body;
 assert.deepEqual(new Set(input.selectedVersions),new Set(['MIX_GOLD_ORIGINAL','ORIGINAL','BLACK']));
 assert.deepEqual(input.productLayouts.map(layout=>[layout.productId,layout.selectedVersions]),[['a',['MIX_GOLD_ORIGINAL']],['b',['ORIGINAL','BLACK']]]);
});
test('只重做当前 SKU 时，其他产品不产生请求且原有勾选不变',async()=>{
 const {c,requests,views}=workspace();await c.runMultiPackageGeneration({onlyProductId:'a',selectedVersions:['MIX_GOLD_ORIGINAL']});const input=requests[0].body;
 assert.deepEqual(input.selectedVersions,['MIX_GOLD_ORIGINAL']);assert.deepEqual(input.productLayouts.find(layout=>layout.productId==='b').selectedVersions,[]);assert.deepEqual(views.get('b').selectedVersions,['ORIGINAL','BLACK']);
});
test('当前 SKU 取消全部勾选后，仍可提交其他 SKU 所选搭配',async()=>{
 const {c,requests,views}=workspace();c.selectedGenerationVersions=()=>[];views.get('a').selectedVersions=[];await c.runMultiPackageGeneration();assert.equal(requests.length,1);assert.deepEqual(requests[0].body.selectedVersions,['ORIGINAL','BLACK']);
});
