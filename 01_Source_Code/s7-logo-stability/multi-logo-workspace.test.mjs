import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createSchemes,editScheme,schemeSignature,ensureCustomScheme} from './schemes.mjs';
import {masterTargetsFromTemplate,rebindMasterZones} from './product-master.mjs';
import {preparePlacementLogo} from './placement-logo.mjs';
import {fitDefaultPlacements} from '../public/s7-placement.js';

async function workspace(){
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
 const start=source.indexOf('function saveMultiLogoView(){');
 const context=vm.createContext({fitDefaultPlacements,preparePlacementLogo,fetch:async()=>assert.fail('prepared logos need no preparation request'),masterTargetsFromTemplate,rebindMasterZones,restoreProductSelection(){},structuredClone,createSchemes,schemeSignature,crypto,copyingProductPreset:false,generationSubmitting:false,setTimeout,requestAnimationFrame:callback=>callback(),generationWatcher:null,resultMeta:{},
  taskLogos:[{id:'red',name:'红标',logoImage:'red-image',placementPrepared:'crop-only'},{id:'blue',name:'蓝标',logoImage:'blue-image',placementPrepared:'crop-only'}],
  selectedTaskLogoId:'red',loadedTaskLogoId:'red',multiLogoViews:new Map(),logoLoadRevision:0,logoSelectionBusy:false,logoDecoding:false,logoImportBusy:false,multiLogoJob:null,multiLogoEnabled:true,
  logoData:'red-image',logoSourceData:'',logoImage:{},baseData:'product-image',baseImage:{},multiProductViews:new Map(),
  schemeState:createSchemes([{id:'body',x:.3,y:.4,widthRatio:.2}]),activeScheme:'ORIGINAL',placementScope:'shared',selectedTargetId:'body',lastResultPayload:null,savedSignatures:{},schemePhases:{},submittedSignatures:{},showModifiedPreview:new Set(),
  multiPackageProducts:[{id:'product',sku:'P1',name:'产品'}],loadedMultiProductId:'product',selectedMultiProductId:'product',multiPackageBusy:false,generationBusy:false,
  currentTaskId:'task',s7User:{id:'alice'},mockupModel:{value:'flux-3-image'},schemeNames:{ORIGINAL:'原色',BLACK:'黑白','GOLD FOIL':'金','SILVER FOIL':'银'},
  selectedGenerationVersions:()=>['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL'],
  collectTargets:()=>context.schemeState.schemes[0].targets,syncSchemeState:()=>{},
  loadImage:async()=>({naturalWidth:8,naturalHeight:5}),setSelectedLogoPreview:()=>{},loadSchemeTargets:()=>{},renderMultiProductResults:()=>{},renderProductLibrary:()=>{},renderLogoLibrary:()=>{},queueSchemeCards:()=>{},updateGenerateButton:()=>{},setStatus:()=>{},notifyTask:()=>{},
  document:{querySelector:()=>({value:'',textContent:''})},processButton:{disabled:false},processingPanel:{hidden:true},
  taskDraft:{schedule:()=>{},flush:async()=>{}},s7Path:value=>value,currentSignatures:()=>({}),
 });
 vm.runInContext(source.slice(source.indexOf('async function showGenerationSubmission('),source.indexOf('async function runGeneration(')),context);
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

test('a newly selected Logo starts in its green default frame rather than inheriting another Logo manual edits',async()=>{
 const c=await workspace(),template={zones:[{id:'body',zoneType:'logo',x:.1,y:.1,width:.4,height:.8}],automation:{areas:[{zoneId:'body',presets:[{isDefault:true,orientation:'horizontal',box:{centerX:.3,centerY:.5,width:.2,height:.2,rotation:0}}]}]}};
 c.baseImage={naturalWidth:1000,naturalHeight:500};c.multiProductViews.set('product',{foilTemplate:template});
 c.schemeState=createSchemes(masterTargetsFromTemplate(template));
 c.schemeState.placementLogoAspect=.625;
 c.schemeState.sharedTargets[0].x=.4;c.schemeState.schemes.forEach(s=>{s.targets[0].x=.4;s.targets[0].widthRatio=.1;});
 c.loadSchemeTargets=()=>{c.schemeState=fitDefaultPlacements(c.schemeState,template,{width:1000,height:500},{width:8,height:5});};
 await c.showTaskLogo('blue');
 assert.equal(c.schemeState.schemes[0].targets[0].x,.3);
 assert.ok(Math.abs(c.schemeState.schemes[0].targets[0].widthRatio-.16)<1e-9);
 assert.equal(c.multiLogoViews.get('red').schemeState.schemes[0].targets[0].x,.4);
});

test('batch submission fits inactive Logo views even when their thumbnails were never opened',async()=>{
 const c=await workspace(),template={zones:[{id:'body',zoneType:'logo',x:.1,y:.1,width:.4,height:.8}],automation:{areas:[{zoneId:'body',presets:[{isDefault:true,orientation:'horizontal',box:{centerX:.3,centerY:.5,width:.2,height:.2,rotation:0}}]}]}};
 c.baseImage={naturalWidth:1000,naturalHeight:500};c.logoImage={naturalWidth:8,naturalHeight:5};
 c.schemeState=createSchemes(masterTargetsFromTemplate(template));c.multiProductViews.set('product',{foilTemplate:template});
 c.multiLogoViews.set('blue',{schemeState:structuredClone(c.schemeState),activeScheme:'ORIGINAL'});
 let submitted;c.fetch=async(_url,options)=>{submitted=JSON.parse(options.body);return {ok:true,json:async()=>({kind:'multi-logo',outputs:[]})};};
 c.generationWatcher={pause(){},track(){}};
 await c.runMultiLogoGeneration();
 for(const layout of submitted.logoLayouts)for(const scheme of layout.schemes){assert.ok(Math.abs(scheme.targets[0].x-.3)<1e-9);assert.ok(Math.abs(scheme.targets[0].widthRatio-.16)<1e-9);}
});

test('ordinary batch submission includes each logo layout and the latest unswitched edit',async()=>{
 const c=await workspace();let request;
 c.taskLogos[0].sourceData='red-original';c.logoSourceData='red-original';c.taskLogos[1].aiRefined=true;
 c.selectedGenerationVersions=()=>['BLACK'];
 c.multiProductViews.set('product',{baseAssetUrl:'/api/my-space/tasks/task/assets/product.png'});
 c.schemeState=editScheme(c.schemeState,'ORIGINAL',[{id:'body',x:.7,y:.4,widthRatio:.25}],true);
 c.fetch=async(url,options)=>{request={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({kind:'multi-logo',outputs:[]})};};
 c.generationWatcher={pause:()=>{},track:()=>{}};
 await c.runMultiLogoGeneration();
 assert.equal(request.url,'/api/ai-render-logos');assert.equal(request.body.taskId,'task');
 assert.equal(request.body.baseAssetUrl,'/api/my-space/tasks/task/assets/product.png');
 assert.equal(request.body.productId,'product');assert.deepEqual(request.body.logos.map(logo=>logo.id),['red','blue']);
 assert.equal(request.body.logos[0].logoImage,'red-image');assert.equal(request.body.logos[0].preserveLogoDetails,false);
 assert.equal(request.body.logos[1].logoImage,'blue-image');assert.equal(request.body.logos[1].preserveLogoDetails,true);
 assert.deepEqual(request.body.selectedVersions,['BLACK']);
 assert.equal(request.body.logoLayouts.find(view=>view.logoId==='red').schemes[0].targets[0].x,.7);
});

test('initial product loading retains a completed legacy logo job for restoration',async()=>{
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
 const job={kind:'multi-logo',status:'complete',product:{id:'product'},outputs:[{logoId:'red',version:'ORIGINAL',dataUrl:'/legacy-red.png'}]};
 const context=vm.createContext({masterTargetsFromTemplate,rebindMasterZones,restoreProductSelection(){},structuredClone,ensureCustomScheme,taskLogos:[{id:'red'},{id:'blue'}],selectedTaskLogoId:null,loadedTaskLogoId:null,multiLogoJob:job,multiLogoViews:new Map(),multiProductJob:null,
  multiPackageProducts:[{id:'product',sku:'P1',name:'产品'}],loadedMultiProductId:null,selectedMultiProductId:'product',multiProductLoadRevision:0,
  multiProductViews:new Map([['product',{foilTemplate:{zones:[]},baseData:'base',baseImage:{},schemeState:createSchemes([{id:'body',x:.5,y:.5,widthRatio:.2}]),activeScheme:'ORIGINAL',placementScope:'shared',selectedTargetId:'body'}]]),
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

test('母版重新发布后，尚未切换过的 Logo 草稿也更新区域编号并保留独立位置',async()=>{
 const c=await workspace(),template={zones:[{id:'new-body',zoneType:'logo',x:.1,y:.1,width:.2,height:.2}]};c.multiProductViews.set('product',{foilTemplate:template});
 c.schemeState=createSchemes([{id:'body',masterZoneId:'old-body',x:.3,y:.4,widthRatio:.2}]);
 c.multiLogoViews.set('blue',{targets:[{id:'body',masterZoneId:'old-body',x:.8,y:.4,widthRatio:.2}],schemeState:createSchemes([{id:'body',masterZoneId:'old-body',x:.8,y:.4,widthRatio:.2}]),activeScheme:'ORIGINAL'});
 const layouts=c.captureMultiLogoLayouts();assert.equal(layouts.length,2);
 for(const layout of layouts){assert.equal(layout.targets[0].masterZoneId,'new-body');assert.equal(layout.schemeState.sharedTargets[0].masterZoneId,'new-body');for(const scheme of layout.schemeState.schemes)assert.equal(scheme.targets[0].masterZoneId,'new-body');}
 assert.equal(layouts.find(layout=>layout.logoId==='blue').targets[0].x,.8);assert.equal(layouts.find(layout=>layout.logoId==='red').targets[0].x,.3);
});
