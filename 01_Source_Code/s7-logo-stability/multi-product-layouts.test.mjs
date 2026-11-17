import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createSchemes,editScheme,schemeSignature} from './schemes.mjs';
import {generationVersionsForProduct} from './download-selection.mjs';
import {fitDefaultPlacements} from '../public/s7-placement.js';
import {masterTargetsFromTemplate} from './product-master.mjs';

test('batch submission includes cached product edits and the active product latest unswitched edits',async()=>{
  const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
  const snapshots=source.slice(source.indexOf('function saveMultiProductView(){'),source.indexOf('async function showMultiProduct('));
  const submission=source.slice(source.indexOf('async function runMultiPackageGeneration('),source.indexOf("document.querySelector('#generate').onclick="));
  const target=(x,widthRatio)=>({id:'master-zone',x,y:.5,widthRatio,rotation:20,curve:0,surface:'free'});
  const aTargets=[target(.35,.3)],bTargets=[target(.65,.4)];
  const aState=createSchemes(aTargets);
  aState.schemes[2].targets[0].rotation=-30;
  aState.schemes[2].independentGeometry=true;
  let requestBody;
  const context=vm.createContext({generationVersionsForProduct,loadedTaskLogoId:null,taskDownloadOutputs:()=>[],downloadSelection:{},copyingProductPreset:false,generationSubmitting:false,generationBusy:false,logoSelectionBusy:false,setTimeout,requestAnimationFrame:callback=>callback(),generationWatcher:null,resultMeta:{},queueSchemeCards(){},
    structuredClone,schemeSignature,schemeNames:{ORIGINAL:'原色',BLACK:'黑白','GOLD FOIL':'金','SILVER FOIL':'银'},multiProductJob:null,currentTaskId:null,multiPackageBusy:false,multiPackageProducts:[{id:'a',sku:'a'},{id:'b',sku:'b'}],logoData:'test-logo',mockupModel:{value:'flux-3-image'},
    selectedMultiProductId:'b',loadedMultiProductId:'b',baseData:'base-b',baseImage:{},logoImage:null,
    schemeState:createSchemes([target(.4,.2)]),activeScheme:'ORIGINAL',placementScope:'shared',selectedTargetId:'master-zone',lastResultPayload:null,savedSignatures:{},schemePhases:{},
    multiProductViews:new Map([['a',{targets:aTargets,schemeState:aState,activeScheme:'GOLD FOIL',selectedVersions:['BLACK','SILVER FOIL']}]]),multiProductResults:new Map(),
    loadMultiProductView:async product=>context.multiProductViews.get(product.id),collectTargets:()=>bTargets,
    selectedGenerationVersions:()=>['BLACK','SILVER FOIL'],
    syncSchemeState:()=>{context.schemeState=editScheme(context.schemeState,context.activeScheme,bTargets,true);},
    setStatus:()=>{},renderMultiProductResults:()=>{},restoreMultiProductGeneration:()=>{},updateGenerateButton:()=>{},s7User:null,
    fetch:async(url,options)=>{assert.equal(url,'/api/ai-render-multi');requestBody=JSON.parse(options.body);return {ok:true,headers:{get:()=> 'text/event-stream'}};},
    readProgressStream:async(response,onEvent)=>{for(const id of ['a','b'])await onEvent('product-done',{product:{id},complete:true,images:[],outputs:['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL']});}
  });
  vm.runInContext(source.slice(source.indexOf('function selectedProductPlans(){'),source.indexOf('function restoreMixedVersions'))+source.slice(source.indexOf('async function showGenerationSubmission('),source.indexOf('async function runGeneration('))+snapshots+submission,context);
  context.multiProductViews.get('a').baseAssetUrl='/api/my-space/tasks/task/assets/a.png';context.multiProductViews.get('a').baseData='base-a';
  context.multiProductViews.set('b',{baseAssetUrl:'/api/my-space/tasks/task/assets/b.png'});
  await vm.runInContext('runMultiPackageGeneration()',context);
  const firstRequest=structuredClone(requestBody);delete context.multiProductViews.get('a').baseData;await context.runMultiPackageGeneration();
  assert.equal(requestBody.productLayouts[0].baseAssetUrl,'/api/my-space/tasks/task/assets/a.png');
  assert.deepEqual(requestBody.productLayouts[0].schemeSignatures,firstRequest.productLayouts[0].schemeSignatures,'未访问的产品也应使用相同快照指纹');
  context.cachedAssetSource=[];context.cachedAssetKey='';
  vm.runInContext(source.slice(source.indexOf('function assetKey(){'),source.indexOf('function schemeOutput(')),context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.currentSignatures())),requestBody.productLayouts[1].schemeSignatures,'编辑预览和批量生成应使用同一快照指纹');
  assert.deepEqual(requestBody.productLayouts.map(layout=>layout.productId),['a','b']);
  assert.deepEqual(requestBody.selectedVersions,['BLACK','SILVER FOIL']);
  assert.deepEqual(requestBody.productLayouts[0].targets,aTargets);
  assert.deepEqual(requestBody.productLayouts[0].schemes,aState.schemes);
  assert.deepEqual(requestBody.productLayouts[1].targets,bTargets);
  assert.equal(requestBody.productLayouts[1].schemes[0].targets[0].widthRatio,.4);
  const stored=JSON.parse(JSON.stringify(vm.runInContext('captureMultiProductLayouts()',context)));
  context.loadedMultiProductId=null;
  context.multiProductViews=new Map(stored.map(layout=>[layout.productId,layout]));
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('captureMultiProductLayouts()',context))),stored);
});

test('inactive products fit their own default frames using their own image dimensions before batch capture',async()=>{
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
 const template={zones:[{id:'body',zoneType:'logo',x:.1,y:.1,width:.4,height:.8}],automation:{areas:[{zoneId:'body',presets:[{isDefault:true,orientation:'horizontal',box:{centerX:.3,centerY:.5,width:.2,height:.2,rotation:0}}]}]}};
 const views=new Map([['a',{baseImage:{naturalWidth:1000,naturalHeight:500}}],['b',{baseImage:{naturalWidth:500,naturalHeight:1000}}]]);
 for(const view of views.values())Object.assign(view,{foilTemplate:template,schemeState:createSchemes(masterTargetsFromTemplate(template)),activeScheme:'ORIGINAL'});
 const c=vm.createContext({fitDefaultPlacements,structuredClone,loadedMultiProductId:null,logoImage:{naturalWidth:100,naturalHeight:400},multiProductViews:views,multiPackageProducts:[{id:'a'},{id:'b'}]});
 vm.runInContext(source.slice(source.indexOf('function saveMultiProductView(){'),source.indexOf('async function showMultiProduct(')),c);
 const layouts=c.captureMultiProductLayouts();
 assert.ok(Math.abs(layouts[0].targets[0].widthRatio-.025)<1e-9);
 assert.ok(Math.abs(layouts[1].targets[0].widthRatio-.1)<1e-9);
});
