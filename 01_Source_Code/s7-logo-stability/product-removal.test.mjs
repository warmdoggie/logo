import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createSchemes} from './schemes.mjs';

async function workspace(){
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
 const view=id=>({baseData:`base-${id}`,baseImage:{id},targets:[{id:'body',x:id==='a'?.3:.7,y:.5,widthRatio:.2}],schemeState:createSchemes([{id:'body',x:id==='a'?.3:.7,y:.5,widthRatio:.2}]),activeScheme:'ORIGINAL',placementScope:'shared',selectedTargetId:'body',lastResultPayload:{outputs:[{version:'ORIGINAL',dataUrl:`/${id}.png`}]},savedSignatures:{},schemePhases:{}});
 const first=view('a'),nodes={};
 const c=vm.createContext({currentTaskId:null,s7User:null,structuredClone,createSchemes,taskLogos:[{id:'logo'}],selectedTaskLogoId:'logo',loadedTaskLogoId:'logo',logoData:'logo',logoImage:{},logoSelectionBusy:false,generationBusy:false,multiPackageBusy:false,
  multiPackageProducts:[{id:'a',sku:'A'},{id:'b',sku:'B'}],selectedMultiProductId:'a',loadedMultiProductId:'a',multiProductLoadRevision:0,
  multiProductViews:new Map([['a',first],['b',view('b')]]),multiProductLoads:new Map(),multiProductResults:new Map([['a',{}],['b',{}]]),multiProductJob:null,multiLogoJob:null,multiLogoViews:new Map(),
  ...first,submittedSignatures:{},showModifiedPreview:new Set(),generationId:'old-job',dismissedGenerationId:null,
  collectTargets:()=>c.schemeState.schemes[0].targets,syncSchemeState:()=>{},loadSchemeTargets:()=>{},drawPreview:()=>{},
  renderProductLibrary:()=>{},renderMultiProductResults:()=>{},queueSchemeCards:()=>{},updateGenerateButton:()=>{},setStatus:()=>{},taskDraft:{schedule:()=>{}},
  document:{querySelector:id=>nodes[id]||= {}},
 });
 const start=source.indexOf('async function removeTaskProduct(');
 assert.ok(start>=0,'产品预览卡片应支持从任务移除产品');
 vm.runInContext(source.slice(start,source.indexOf('function saveMultiLogoView(){',start)),c);
 return c;
}

test('removing the active product shows the remaining product with its own layout and output',async()=>{
 const c=await workspace();await c.removeTaskProduct('a');
 assert.deepEqual(c.multiPackageProducts.map(p=>p.id),['b']);
 assert.equal(c.selectedMultiProductId,'b');assert.equal(c.loadedMultiProductId,'b');
 assert.equal(c.schemeState.schemes[0].targets[0].x,.7);assert.equal(c.lastResultPayload.outputs[0].dataUrl,'/b.png');
 assert.equal(c.logoData,'logo');assert.equal(c.multiProductViews.get('a').schemeState.schemes[0].targets[0].x,.3);
});

test('removing an inactive product keeps the current product edits',async()=>{
 const c=await workspace();c.schemeState.schemes[0].targets[0].x=.42;await c.removeTaskProduct('b');
 assert.equal(c.loadedMultiProductId,'a');assert.equal(c.selectedMultiProductId,'a');
 assert.equal(c.schemeState.schemes[0].targets[0].x,.42);assert.equal(c.lastResultPayload.outputs[0].dataUrl,'/a.png');
 assert.equal(c.dismissedGenerationId,null,'移除无关产品不能屏蔽仍保留产品的生成记录');
});

test('removing the last product clears its image and outputs while retaining the logo',async()=>{
 const c=await workspace();c.multiPackageProducts=c.multiPackageProducts.slice(0,1);await c.removeTaskProduct('a');
 assert.equal(c.multiPackageProducts.length,0);assert.equal(c.selectedMultiProductId,null);assert.equal(c.loadedMultiProductId,null);
 assert.equal(c.baseData,'');assert.equal(c.baseImage,null);assert.equal(c.lastResultPayload,null);assert.equal(c.logoData,'logo');
});

test('product removal is unavailable during generation or logo loading',async()=>{
 for(const busy of ['generationBusy','multiPackageBusy','logoSelectionBusy']){
  const c=await workspace();c[busy]=true;await c.removeTaskProduct('a');
  assert.deepEqual(c.multiPackageProducts.map(p=>p.id),['a','b']);assert.equal(c.loadedMultiProductId,'a');
 }
});

test('removing a loading product ignores its late image response',async()=>{
 const c=await workspace();c.multiProductViews.delete('b');let finish;
 const response=new Promise(resolve=>finish=resolve);c.fetch=()=>response;
 const pending=c.showMultiProduct('b');await c.removeTaskProduct('b');
 finish({ok:false});await pending;
 assert.equal(c.selectedMultiProductId,'a');assert.equal(c.loadedMultiProductId,'a');assert.equal(c.baseData,'base-a');
});

test('restoring a saved removal cannot replay the removed product generation but accepts a new job',async()=>{
 const c=await workspace();c.multiPackageProducts=c.multiPackageProducts.slice(0,1);await c.removeTaskProduct('a');
 const saved=JSON.parse(JSON.stringify({dismissedGenerationId:c.dismissedGenerationId,baseData:c.baseData,multiPackageProducts:c.multiPackageProducts,lastResultPayload:c.lastResultPayload}));
 const restored=await workspace();Object.assign(restored,saved,{baseImage:null,generationId:null,schemePhases:{},status:{},resultMeta:{},s7Path:value=>value,schemeOutput:()=>undefined});
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
 vm.runInContext(source.slice(source.indexOf('function restoreGeneration('),source.indexOf('function generationRequest('))+source.slice(source.indexOf('function beginResultProgress('),source.indexOf('async function readProgressStream(')),restored);
 const record={id:'old-job',status:'complete',selectedVersions:['ORIGINAL'],outputs:[{version:'ORIGINAL',dataUrl:'/removed-product.png'}],stages:{ORIGINAL:{stage:'complete'}}};
 restored.restoreGeneration(record);assert.equal(restored.lastResultPayload,null);
 restored.restoreGeneration({...record,id:'new-job',outputs:[{version:'ORIGINAL',dataUrl:'/new-product.png'}]});
 assert.equal(restored.lastResultPayload.outputs[0].dataUrl,'/new-product.png');
});
