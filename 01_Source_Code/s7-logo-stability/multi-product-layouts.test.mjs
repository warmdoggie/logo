import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createSchemes,editScheme,schemeSignature} from './schemes.mjs';

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
  const context=vm.createContext({
    structuredClone,schemeSignature,schemeNames:{ORIGINAL:'原色',BLACK:'黑白','GOLD FOIL':'金','SILVER FOIL':'银'},multiProductJob:null,currentTaskId:null,multiPackageBusy:false,multiPackageProducts:[{id:'a',sku:'a'},{id:'b',sku:'b'}],logoData:'test-logo',mockupModel:{value:'flux-3-image'},
    selectedMultiProductId:'b',loadedMultiProductId:'b',baseData:'base-b',baseImage:{},
    schemeState:createSchemes([target(.4,.2)]),activeScheme:'ORIGINAL',placementScope:'shared',selectedTargetId:'master-zone',lastResultPayload:null,savedSignatures:{},schemePhases:{},
    multiProductViews:new Map([['a',{targets:aTargets,schemeState:aState,activeScheme:'GOLD FOIL'}]]),multiProductResults:new Map(),
    collectTargets:()=>bTargets,
    syncSchemeState:()=>{context.schemeState=editScheme(context.schemeState,context.activeScheme,bTargets,true);},
    setStatus:()=>{},renderMultiProductResults:()=>{},restoreMultiProductGeneration:()=>{},updateGenerateButton:()=>{},s7User:null,
    fetch:async(url,options)=>{assert.equal(url,'/api/ai-render-multi');requestBody=JSON.parse(options.body);return {ok:true,headers:{get:()=> 'text/event-stream'}};},
    readProgressStream:async(response,onEvent)=>{for(const id of ['a','b'])await onEvent('product-done',{product:{id},complete:true,images:[],outputs:['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL']});}
  });
  vm.runInContext(snapshots+submission,context);
  await vm.runInContext('runMultiPackageGeneration()',context);
  assert.deepEqual(requestBody.productLayouts.map(layout=>layout.productId),['a','b']);
  assert.deepEqual(requestBody.productLayouts[0].targets,aTargets);
  assert.deepEqual(requestBody.productLayouts[0].schemes,aState.schemes);
  assert.deepEqual(requestBody.productLayouts[1].targets,bTargets);
  assert.equal(requestBody.productLayouts[1].schemes[0].targets[0].widthRatio,.4);
  const stored=JSON.parse(JSON.stringify(vm.runInContext('captureMultiProductLayouts()',context)));
  context.loadedMultiProductId=null;
  context.multiProductViews=new Map(stored.map(layout=>[layout.productId,layout]));
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('captureMultiProductLayouts()',context))),stored);
});
