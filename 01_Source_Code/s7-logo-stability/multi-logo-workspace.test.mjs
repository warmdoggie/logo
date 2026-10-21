import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createSchemes,editScheme,schemeSignature} from './schemes.mjs';

async function workspace(){
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
 const start=source.indexOf('function saveMultiLogoView(){');
 const context=vm.createContext({structuredClone,createSchemes,schemeSignature,crypto,
  taskLogos:[{id:'red',name:'红标',logoImage:'red-image'},{id:'blue',name:'蓝标',logoImage:'blue-image'}],
  selectedTaskLogoId:'red',loadedTaskLogoId:'red',multiLogoViews:new Map(),logoLoadRevision:0,logoSelectionBusy:false,multiLogoJob:null,multiLogoEnabled:true,
  logoData:'red-image',logoSourceData:'',logoImage:{},baseData:'product-image',baseImage:{},
  schemeState:createSchemes([{id:'body',x:.3,y:.4,widthRatio:.2}]),activeScheme:'ORIGINAL',placementScope:'shared',selectedTargetId:'body',lastResultPayload:null,savedSignatures:{},schemePhases:{},submittedSignatures:{},showModifiedPreview:new Set(),
  multiPackageProducts:[{id:'product',sku:'P1',name:'产品'}],loadedMultiProductId:'product',selectedMultiProductId:'product',multiPackageBusy:false,generationBusy:false,
  currentTaskId:'task',s7User:{id:'alice'},mockupModel:{value:'flux-3-image'},schemeNames:{ORIGINAL:'原色',BLACK:'黑白','GOLD FOIL':'金','SILVER FOIL':'银'},
  selectedGenerationVersions:()=>['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL'],
  collectTargets:()=>context.schemeState.schemes[0].targets,syncSchemeState:()=>{},
  loadImage:async()=>({naturalWidth:8,naturalHeight:5}),setSelectedLogoPreview:()=>{},loadSchemeTargets:()=>{},renderMultiProductResults:()=>{},renderProductLibrary:()=>{},renderLogoLibrary:()=>{},queueSchemeCards:()=>{},updateGenerateButton:()=>{},setStatus:()=>{},notifyTask:()=>{},
  document:{querySelector:()=>({value:'',textContent:''})},processButton:{disabled:false},processingPanel:{hidden:true},
  taskDraft:{schedule:()=>{},flush:async()=>{}},s7Path:value=>value,currentSignatures:()=>({}),
 });
 if(start>=0)vm.runInContext(source.slice(start,source.indexOf('function renderMultiProductResults(){',start)),context);
 assert.equal(typeof context.showTaskLogo,'function','普通任务应支持切换 Logo');
 return context;
}

test('switching logo thumbnails keeps independent edits and restores the matching four outputs',async()=>{
 const c=await workspace();
 c.schemeState=editScheme(c.schemeState,'ORIGINAL',[{id:'body',x:.65,y:.4,widthRatio:.35}],true);
 c.lastResultPayload={outputs:[{logoId:'red',version:'ORIGINAL',dataUrl:'/red.png'}]};
 await c.showTaskLogo('blue');
 c.schemeState=editScheme(c.schemeState,'ORIGINAL',[{id:'body',x:.8,y:.4,widthRatio:.15}],true);
 c.lastResultPayload={outputs:[{logoId:'blue',version:'ORIGINAL',dataUrl:'/blue.png'}]};
 await c.showTaskLogo('red');
 assert.equal(c.logoData,'red-image');assert.equal(c.schemeState.schemes[0].targets[0].x,.65);
 assert.equal(c.lastResultPayload.outputs[0].dataUrl,'/red.png');
 const saved=JSON.parse(JSON.stringify(c.captureMultiLogoLayouts()));
 assert.equal(saved.find(view=>view.logoId==='blue').schemeState.schemes[0].targets[0].x,.8);
 await c.showTaskLogo('blue');assert.equal(c.lastResultPayload.outputs[0].dataUrl,'/blue.png');
});

test('ordinary batch submission includes each logo layout and the latest unswitched edit',async()=>{
 const c=await workspace();let request;
 c.selectedGenerationVersions=()=>['BLACK'];
 c.schemeState=editScheme(c.schemeState,'ORIGINAL',[{id:'body',x:.7,y:.4,widthRatio:.25}],true);
 c.fetch=async(url,options)=>{request={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({kind:'multi-logo',outputs:[]})};};
 c.generationWatcher={track:()=>{}};
 await c.runMultiLogoGeneration();
 assert.equal(request.url,'/api/ai-render-logos');assert.equal(request.body.taskId,'task');
 assert.equal(request.body.productId,'product');assert.deepEqual(request.body.logos.map(logo=>logo.id),['red','blue']);
 assert.deepEqual(request.body.selectedVersions,['BLACK']);
 assert.equal(request.body.logoLayouts.find(view=>view.logoId==='red').schemes[0].targets[0].x,.7);
});

test('AI processing writes back to its original logo when a different thumbnail is selected before completion',async()=>{
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
 const apply={},nodes={'#apply-processing':apply,'#processing-status':{},'input[name="logo-output-color"]:checked':{value:'original'}};
 let finish;const response=new Promise(resolve=>finish=resolve);
 const context=vm.createContext({document:{querySelector:id=>nodes[id]},
  loadedTaskLogoId:'red',logoData:'red-before',logoSourceData:'red-source',logoImage:{},
  taskLogos:[{id:'red',name:'红标',logoImage:'red-before'},{id:'blue',name:'蓝标',logoImage:'blue-before'}],
  fetch:()=>response,loadImage:async()=>({}),saveLogo:()=>{},logoStorage:{},useSavedLogoButton:{},clearSavedLogoButton:{},processingPanel:{},
  setSelectedLogoPreview:()=>{},drawPreview:()=>{},setStatus:()=>{},renderMultiProductResults:()=>{},renderLogoLibrary:()=>{},taskDraft:{schedule:()=>{}},
 });
 const start=source.indexOf("document.querySelector('#apply-processing').onclick=");
 vm.runInContext(source.slice(start,source.indexOf('async function loadAiProviderStatus()',start)),context);
 const processing=apply.onclick();context.loadedTaskLogoId='blue';context.logoData='blue-before';context.logoSourceData='blue-source';
 finish({ok:true,json:async()=>({dataUrl:'data:image/png;base64,red-processed',width:8,height:5,logoLibrary:{name:'红标'}})});await processing;
 assert.equal(context.logoData,'blue-before');assert.equal(context.logoSourceData,'blue-source');
 assert.equal(context.taskLogos.find(logo=>logo.id==='red').logoImage,'red-processed');
 assert.equal(context.taskLogos.find(logo=>logo.id==='blue').logoImage,'blue-before');
});

test('initial product loading retains a completed legacy logo job for restoration',async()=>{
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
 const job={kind:'multi-logo',status:'complete',product:{id:'product'},outputs:[{logoId:'red',version:'ORIGINAL',dataUrl:'/legacy-red.png'}]};
 const context=vm.createContext({structuredClone,taskLogos:[{id:'red'},{id:'blue'}],multiLogoJob:job,multiLogoViews:new Map(),multiProductJob:null,
  multiPackageProducts:[{id:'product',sku:'P1',name:'产品'}],loadedMultiProductId:null,selectedMultiProductId:'product',multiProductLoadRevision:0,
  multiProductViews:new Map([['product',{baseData:'base',baseImage:{},schemeState:createSchemes([{id:'body',x:.5,y:.5,widthRatio:.2}]),activeScheme:'ORIGINAL',placementScope:'shared',selectedTargetId:'body'}]]),
  renderMultiProductResults:()=>{},queueSchemeCards:()=>{},saveMultiProductView:()=>{},setStatus:()=>{},loadSchemeTargets:()=>{},document:{querySelector:()=>({})},
 });
 vm.runInContext(source.slice(source.indexOf('async function showMultiProduct('),source.indexOf('function saveMultiLogoView(){')),context);
 await context.showMultiProduct('product');
 assert.equal(context.loadedMultiProductId,'product');assert.equal(context.multiLogoJob,job);
 assert.equal(context.multiLogoJob.outputs[0].dataUrl,'/legacy-red.png');
 assert.equal(context.multiLogoViews.get('blue')?.schemeState?.schemes[0].targets[0].x,.5,'未访问的 Logo 也应拥有独立的产品母版布局');
});

test('a logo cannot be removed while its thumbnail is still loading',async()=>{
 const c=await workspace();let finish;const image=new Promise(resolve=>finish=resolve);c.loadImage=()=>image;
 const switching=c.showTaskLogo('blue');await c.removeTaskLogo('blue');
 finish({});await switching;
 assert.deepEqual(c.taskLogos.map(logo=>logo.id),['red','blue']);
 assert.equal(c.loadedTaskLogoId,'blue');assert.equal(c.logoData,'blue-image');
});

test('returning to the loaded logo cancels a pending different logo switch',async()=>{
 const c=await workspace();let finish;c.loadImage=()=>new Promise(resolve=>finish=resolve);
 const switching=c.showTaskLogo('blue');await c.showTaskLogo('red');finish({});await switching;
 assert.equal(c.selectedTaskLogoId,'red');assert.equal(c.loadedTaskLogoId,'red');assert.equal(c.logoData,'red-image');assert.equal(c.logoSelectionBusy,false);
});

test('a newer non-logo generation cannot replay an older logo batch when more logos are later selected',async()=>{
 const c=await workspace(),source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
 c.multiLogoJob={kind:'multi-logo',product:{id:'product'},outputs:[{logoId:'red',version:'ORIGINAL',dataUrl:'/old.png'}]};
 c.restoreMultiProductGeneration=()=>{};
 vm.runInContext(source.slice(source.indexOf('function restoreGeneration('),source.indexOf('function generationRequest(')),c);
 c.restoreGeneration({kind:'multi-product',outputs:[],stages:{}});
 assert.equal(c.multiLogoJob,null);
});

test('choosing the first product after multiple logos selects it for preview loading',async()=>{
 const c=await workspace(),source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
 c.selectedMultiProductId=null;c.loadedMultiProductId=null;c.renderMultiLogoTabs=()=>{};
 vm.runInContext(source.slice(source.indexOf('function renderMultiProductResults(){'),source.indexOf('async function openProductLibrary()')),c);
 c.renderMultiProductResults();assert.equal(c.selectedMultiProductId,'product');
});
