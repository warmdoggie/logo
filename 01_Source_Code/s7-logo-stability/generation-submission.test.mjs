import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createGenerationWatcher,previewStatus} from './generation-client.mjs';
import {preparePlacementLogo} from './placement-logo.mjs';

const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});return {promise,resolve,reject};};
async function fixture(kind){
 const saved=deferred(),flushing=deferred(),requested=deferred(),response=deferred(),button={},retry={},meta={},status={},nodes={'#generate':button,'#generate-modified':retry,'#apply-product-preset':{},'#product-preset-options':{},'#custom-product-color':{},'#custom-carton-color':{},'#custom-product-color-picker':{},'#custom-carton-color-picker':{}};
 for(const name of ['size','color','print-finish','rotation'])nodes['#copy-preset-'+name]={checked:true};
 const versions=['ORIGINAL','BLACK'],record={id:'new',status:'running',outputs:[],stages:{ORIGINAL:{stage:'generating'},BLACK:{stage:'generating'}}};
 let requests=0;
 const c=vm.createContext({preparePlacementLogo,loadImage:async()=>({naturalWidth:100,naturalHeight:40}),multiLogoViews:new Map([['a',{}],['b',{}]]),addingPrintCombination:false,structuredClone,setTimeout,requestAnimationFrame:callback=>setTimeout(callback,0),generationSubmitting:false,generationBusy:false,multiPackageBusy:false,copyingProductPreset:false,logoSelectionBusy:false,
  activeScheme:'ORIGINAL',baseData:'base',logoData:'logo',currentTaskId:'task',s7User:{id:'alice'},multiLogoEnabled:true,mockupModel:{value:'local'},
  updatePlacementUndo(){},localLogoBusy:false,processButton:{setAttribute(){}},aiLogoBusy:false,aiRefineButton:{setAttribute(){}},aiRefineDownload:{},
  taskLogos:kind==='logos'?[{id:'a',logoImage:'a'},{id:'b',logoImage:'b'}]:[],multiPackageProducts:kind==='products'?[{id:'a'},{id:'b'}]:[{id:'a'}],loadedMultiProductId:'a',selectedMultiProductId:'a',loadedTaskLogoId:'a',multiProductViews:new Map([['a',{}],['b',{}]]),
  schemeState:{schemes:versions.map(version=>({version,targets:[]}))},schemePhases:{},lastResultPayload:{outputs:[]},resultMeta:meta,status,
  document:{querySelectorAll:()=>[],querySelector:id=>nodes[id]},multiProductTabs:{querySelectorAll:()=>[]},selectedProductPlans:()=>c.multiPackageProducts.map(product=>({productId:product.id,selectedVersions:versions})),loadMultiProductView:async product=>c.multiProductViews.get(product.id),selectedGenerationVersions:()=>versions,modifiedSchemes:()=>[],
  captureMultiLogoLayouts:()=>[],captureMultiProductLayouts:()=>[{productId:'a',schemeState:{schemes:[]}},{productId:'b',schemeState:{schemes:[]}}],collectTargets:()=>[],schemeSignature:()=>'',
  syncSchemeState(){},currentSignatures:()=>({}),setStatus:(message,type)=>{status.textContent=message;status.className=type;},notifyTask(){},queueSchemeCards(){},renderMultiProductResults(){},updateAllSchemeSelection(){},
  taskDraft:{schedule(){},flush:()=>{flushing.resolve();return saved.promise;}},generationRequest:()=>({}),generationWatcher:{pause(){},track(value){c.generationBusy=kind==='single';c.multiPackageBusy=kind!=='single';c.record=value;}},
  fetch:()=>{requests++;requested.resolve();return response.promise;}
 });
 vm.runInContext(source.slice(source.indexOf('function updateGenerateButton(){'),source.indexOf('for(const input of versionInputs)',source.indexOf('function updateGenerateButton(){'))),c);
 const helper=source.indexOf('async function showGenerationSubmission(');
 if(helper>=0)vm.runInContext(source.slice(helper,source.indexOf('async function runGeneration(',helper)),c);
 vm.runInContext(source.slice(source.indexOf('async function submitBackgroundGeneration('),source.indexOf('function beginResultProgress(')),c);
 vm.runInContext(source.slice(source.indexOf('async function runGeneration('),source.indexOf("document.querySelector('#generate').onclick=")),c);
 vm.runInContext(source.slice(source.indexOf('async function runMultiLogoGeneration('),source.indexOf('function renderMultiProductResults(){')),c);
 const run=()=>kind==='logos'?c.runMultiLogoGeneration():kind==='products'?c.runMultiPackageGeneration():c.runGeneration(versions);
 return {c,button,meta,status,run,saved,flushing,requested,response,record,requests:()=>requests};
}

for(const kind of ['single','products','logos'])test(`${kind}: 保存草稿和提交尚未返回时立即显示生成状态，重复点击只提交一次`,async()=>{
 const f=await fixture(kind),pending=f.run();
 assert.equal(f.button.disabled,true);assert.match(f.button.textContent,/生成中|正在生成/);assert.match(f.meta.textContent,/正在生成/);
 assert.equal(f.c.aiRefineButton.disabled,true,'生成期间不能替换 Logo');
 assert.equal(f.c.processButton.disabled,true,'生成期间不能加工 Logo');
 assert.equal(f.c.multiProductTabs.inert,true);
 assert.equal(previewStatus(null,f.c.schemePhases.BLACK,false).busy,true);
 await f.run();assert.equal(f.requests(),0);
 await f.flushing.promise;f.saved.resolve();await f.requested.promise;assert.equal(f.requests(),1);
 await f.run();assert.equal(f.requests(),1);
 f.response.resolve({ok:true,json:async()=>f.record});await pending;
 assert.equal(f.c.record.id,'new');assert.equal(f.button.disabled,true);
 assert.equal(f.c.multiProductTabs.inert,false);
});

test('保存草稿失败时显示失败并恢复按钮，允许下一次提交',async()=>{
 const f=await fixture('single'),pending=f.run();f.saved.reject(Error('保存失败'));await pending;
 assert.equal(f.button.disabled,false);assert.match(f.status.textContent,/保存失败/);assert.equal(f.c.generationSubmitting,false);
 assert.equal(previewStatus(null,f.c.schemePhases.BLACK,false).busy,false);assert.equal(f.requests(),0);
});

test('烫印提示返回修改后清除提交状态并保留已有图片',async()=>{
 const f=await fixture('single');f.c.lastResultPayload={outputs:[{version:'ORIGINAL'}]};
 const pending=f.run();await f.flushing.promise;f.saved.resolve();await f.requested.promise;
 f.response.reject(Object.assign(Error('已返回修改'),{cancelled:true}));await pending;
 assert.equal(f.button.disabled,false);assert.doesNotMatch(f.meta.textContent,/正在生成|失败/);
 assert.equal(f.c.schemePhases.ORIGINAL.stage,'complete');assert.equal(f.c.schemePhases.BLACK,undefined);
 assert.equal(f.c.generationSubmitting,false);assert.equal(f.c.generationBusy,false);
});

test('提交开始前发出的旧进度查询不能覆盖新任务或错误状态',async()=>{
 const old=deferred(),seen=[],errors=[];
 const watcher=createGenerationWatcher({request:()=>old.promise,onChange:value=>seen.push(value.id),onError:error=>errors.push(error),interval:10000});
 const pending=watcher.refresh();watcher.track({id:'new',status:'running'});old.resolve({id:'old',status:'complete'});await pending;watcher.stop();
 assert.deepEqual(seen,['new']);assert.deepEqual(errors,[]);
});

test('提交期间重新进入页面发出的查询不能覆盖提交失败提示',async()=>{
 const f=await fixture('single'),old=deferred();
 const watcher=createGenerationWatcher({request:()=>old.promise,onChange:()=>{f.status.textContent='旧任务已完成';},onError:()=>{},interval:10000});
 f.c.generationWatcher=watcher;
 const pending=f.run(),query=watcher.refresh();f.saved.reject(Error('提交保存失败'));await pending;
 old.resolve({id:'previous',status:'complete'});await query;watcher.stop();
 assert.match(f.status.textContent,/提交保存失败/);
});

test('批量生成的烫印确认返回修改后，立即刷新卡片解除生成中的遮罩',async()=>{
 const f=await fixture('products');let refreshes=0;f.c.queueSchemeCards=()=>refreshes++;const pending=f.run();
 await f.flushing.promise;f.saved.resolve();await f.requested.promise;const before=refreshes;
 f.response.reject(Object.assign(Error('已返回修改'),{cancelled:true}));await pending;
 assert.equal(f.c.generationSubmitting,false);assert.equal(f.c.multiPackageBusy,false);assert.equal(f.c.schemePhases.ORIGINAL,undefined);assert.ok(refreshes>before);
});
