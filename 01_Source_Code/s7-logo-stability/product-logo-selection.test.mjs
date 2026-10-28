import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createSchemes} from './schemes.mjs';
import {masterTargetsFromTemplate} from './product-master.mjs';

const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
const red={id:'red',name:'红标',logoImage:'red-image'},blue={id:'blue',name:'蓝标',logoImage:'blue-image'};

function workspace(ids=['a']){
 const responses=new Map(ids.map(id=>[id,Promise.withResolvers()])),requests=[],renders=[],statuses=[];
 const nodes={};
 const c=vm.createContext({structuredClone,createSchemes,masterTargetsFromTemplate,
  multiPackageProducts:ids.map(id=>({id,sku:id.toUpperCase()})),multiProductViews:new Map(),multiProductLoads:new Map(),multiProductResults:new Map(),multiProductJob:null,
  selectedMultiProductId:null,loadedMultiProductId:null,multiProductLoadRevision:0,multiPackageBusy:false,generationBusy:false,
  taskLogos:[],selectedTaskLogoId:null,loadedTaskLogoId:null,logoLoadRevision:0,logoSelectionBusy:false,logoDecoding:false,logoImportBusy:false,multiLogoViews:new Map(),multiLogoJob:null,multiLogoEnabled:true,currentTaskId:'task',s7User:{id:'user'},
  baseData:'',baseImage:null,logoData:'',logoSourceData:'',logoImage:null,
  schemeState:createSchemes([{id:'placeholder',x:.5,y:.5,widthRatio:.2}]),activeScheme:'ORIGINAL',placementScope:'shared',selectedTargetId:'placeholder',savedSignatures:{},schemePhases:{},lastResultPayload:null,
  fetch:url=>{requests.push(url);const id=url.split('/').at(-1);return url.includes('/template/')?Promise.resolve({ok:true,json:async()=>({template:{zones:[{id:'body-'+id,zoneType:'logo',x:id==='a'?.1:.6,y:.2,width:.2,height:.2}]}})}):responses.get(id).promise;},
  fileData:async blob=>({data:'base-'+blob.id,dataUrl:'base:'+blob.id}),loadImage:async src=>({src,naturalWidth:100,naturalHeight:100}),
  collectTargets:()=>c.schemeState.schemes[0].targets,syncSchemeState(){},loadSchemeTargets:()=>renders.push({product:c.loadedMultiProductId,logo:c.loadedTaskLogoId}),
  setSelectedLogoPreview(){},renderMultiProductResults(){},renderProductLibrary(){},renderLogoLibrary(){},queueSchemeCards(){},updateGenerateButton(){},drawPreview(){},taskDraft:{schedule(){}},
  setStatus:(text,type)=>statuses.push({text,type}),document:{querySelector:id=>nodes[id]??= {}},processButton:{disabled:true},processingPanel:{hidden:true},selectedLogoPreview:{hidden:true}
 });
 vm.runInContext(source.slice(source.indexOf('async function removeTaskProduct('),source.indexOf('function renderMultiProductResults(){')),c);
 const complete=(id,ok=true)=>responses.get(id).resolve({ok,blob:async()=>({id})});
 return {c,complete,responses,requests,renders,statuses};
}

test('产品加载中选择 Logo，产品就绪后自动应用并使用其母版',async()=>{
 const {c,complete,requests}=workspace();
 const loading=c.showMultiProduct('a');await c.addTaskLogo({...red});
 assert.equal(c.selectedTaskLogoId,'red');assert.equal(c.loadedTaskLogoId,null);
 complete('a');await loading;
 assert.equal(c.loadedMultiProductId,'a');assert.equal(c.loadedTaskLogoId,'red');assert.equal(c.logoData,'red-image');
 assert.equal(c.schemeState.schemes.length,4);assert.equal(c.schemeState.schemes[0].targets[0].id,'master-body-a');
 assert.equal(c.logoSelectionBusy,false);assert.equal(requests.filter(url=>url==='/api/product-library/image/a').length,1);
});

test('产品加载中连续选择多个 Logo，只应用最后选中的一个',async()=>{
 const {c,complete}=workspace(),loading=c.showMultiProduct('a');
 await c.addTaskLogo({...red});await c.addTaskLogo({...blue});complete('a');await loading;
 assert.equal(c.selectedTaskLogoId,'blue');assert.equal(c.loadedTaskLogoId,'blue');assert.equal(c.logoData,'blue-image');
 assert.deepEqual(c.taskLogos.map(logo=>logo.id),['red','blue']);
 await c.showTaskLogo('red');assert.equal(c.logoData,'red-image');assert.equal(c.schemeState.schemes[0].targets[0].id,'master-body-a');
});

test('取消尚未应用的 Logo 后，产品加载完成不能恢复它',async()=>{
 const {c,complete}=workspace(),loading=c.showMultiProduct('a');
 await c.addTaskLogo({...red});await c.removeTaskLogo('red');complete('a');await loading;
 assert.equal(c.taskLogos.length,0);assert.equal(c.selectedTaskLogoId,null);assert.equal(c.loadedTaskLogoId,null);assert.equal(c.logoData,'');
});

test('取消最后选中的待应用 Logo，产品就绪后应用仍保留的 Logo',async()=>{
 const {c,complete}=workspace(),loading=c.showMultiProduct('a');
 await c.addTaskLogo({...red});await c.addTaskLogo({...blue});await c.removeTaskLogo('blue');complete('a');await loading;
 assert.equal(c.selectedTaskLogoId,'red');assert.equal(c.loadedTaskLogoId,'red');assert.equal(c.logoData,'red-image');
});

test('加载中切换产品，Logo 只应用到最后选择的产品',async()=>{
 const {c,complete,renders}=workspace(['a','b']),first=c.showMultiProduct('a');
 await c.addTaskLogo({...red});const last=c.showMultiProduct('b');
 complete('a');await first;assert.equal(c.loadedMultiProductId,null);
 complete('b');await last;
 assert.equal(c.loadedMultiProductId,'b');assert.equal(c.loadedTaskLogoId,'red');assert.equal(c.logoData,'red-image');
 assert.equal(c.schemeState.schemes[0].targets[0].id,'master-body-b');assert.ok(renders.every(render=>render.product==='b'));
});

test('产品加载失败保留 Logo 选择，重试成功后自动应用',async()=>{
 const {c,complete,responses,statuses}=workspace(),failed=c.showMultiProduct('a');
 await c.addTaskLogo({...red});complete('a',false);await failed;
 assert.equal(c.loadedMultiProductId,null);assert.ok(statuses.some(status=>status.type==='error'));
 responses.set('a',Promise.withResolvers());const retry=c.showMultiProduct('a');complete('a');await retry;
 assert.equal(c.loadedMultiProductId,'a');assert.equal(c.loadedTaskLogoId,'red');assert.equal(c.logoData,'red-image');assert.equal(c.logoSelectionBusy,false);
});

test('返回已经加载的产品时，也要立即应用等待中的 Logo',async()=>{
 const {c,complete}=workspace(['a','b']);complete('a');await c.showMultiProduct('a');
 const pending=c.showMultiProduct('b');await c.addTaskLogo({...red});await c.showMultiProduct('a');
 assert.equal(c.loadedMultiProductId,'a');assert.equal(c.loadedTaskLogoId,'red');assert.equal(c.logoData,'red-image');
 complete('b');await pending;assert.equal(c.loadedMultiProductId,'a');assert.equal(c.schemeState.schemes[0].targets[0].id,'master-body-a');
});

for(const inputType of ['library','upload'])for(const decodeFails of [false,true])test(`${inputType} 收尾保留自动解码的操作锁，${decodeFails?'解码失败可重试':'完成后恢复可用'}`,async()=>{
 const {c,complete}=workspace(),added=Promise.withResolvers(),finishSelection=Promise.withResolvers(),decoding=Promise.withResolvers(),finishDecode=Promise.withResolvers();
 const add=c.addTaskLogo,fetch=c.fetch,fileData=c.fileData;
 c.addTaskLogo=async logo=>{await add(logo);added.resolve();await finishSelection.promise;};
 c.fetch=url=>url.includes('/logo-library/')?Promise.resolve({ok:true,blob:async()=>({logo:true})}):fetch(url);
 c.fileData=blob=>blob.id?fileData(blob):Promise.resolve({data:'red-image'});
 c.loadImage=async src=>{if(src.startsWith('base:'))return {src};decoding.resolve();return finishDecode.promise;};
 let select,libraryInput;
 if(inputType==='library'){
  const list={dataset:{},inputs:[],querySelectorAll(){return this.inputs;},set innerHTML(html){this.inputs=[...html.matchAll(/data-logo-id="([^"]+)"/g)].map(match=>({dataset:{logoId:match[1]},addEventListener(_event,handler){this.change=handler;}}));}};
  Object.assign(c,{logoLibraryList:list,logoLibrarySearch:{value:''},logoLibraryItems:[{...red,createdAt:'2026-10-28',imageUrl:'/api/logo-library/red/image'}],logoLibraryPath:value=>value,esc:value=>value});
  vm.runInContext(source.slice(source.indexOf('function renderLogoLibrary(){'),source.indexOf('async function openLogoLibrary()')),c);
  c.renderLogoLibrary();const input=list.inputs[0];libraryInput=input;select=()=>{input.checked=true;return input.change();};
 }else{
  const input={files:[{name:'Logo.png'}],value:'Logo.png'},query=c.document.querySelector;
  c.crypto=crypto;c.document.querySelector=id=>id==='#logo-image'?input:query(id);
  const start=source.indexOf("document.querySelector('#logo-image').onchange=");
  vm.runInContext(source.slice(start,source.indexOf('useSavedLogoButton.onclick=',start)),c);
  select=()=>input.onchange({target:input});
 }
 const product=c.showMultiProduct('a'),selection=select();await added.promise;complete('a');await decoding.promise;
 finishSelection.resolve();await selection;
 assert.equal(c.logoSelectionBusy,true,'原始选择操作收尾后，自动解码仍应持有操作锁');
 const id=c.taskLogos[0].id;await c.removeTaskLogo(id);assert.equal(c.taskLogos.length,1);
 if(decodeFails)finishDecode.reject(Error('图片无法读取'));else finishDecode.resolve({});
 await product;assert.equal(c.logoSelectionBusy,false);
 if(decodeFails){assert.equal(c.loadedTaskLogoId,null);c.loadImage=async()=>({});await c.showTaskLogo(id);}
 assert.equal(c.loadedTaskLogoId,id);
 if(libraryInput)assert.equal(libraryInput.disabled,false,'自动应用结束后，Logo 选择框应恢复可用');
});

test('批量上传仍在读取后续文件时，首个 Logo 自动应用不能提前解锁',async()=>{
 const {c,complete}=workspace(),readingSecond=Promise.withResolvers(),secondFile=Promise.withResolvers();
 const productList={dataset:{},inputs:[],querySelectorAll(){return this.inputs;},set innerHTML(html){this.inputs=[...html.matchAll(/data-batch-product-id="([^"]+)"/g)].map(match=>({dataset:{batchProductId:match[1]},addEventListener(){}}));}};
 Object.assign(c,{productLibraryList:productList,productLibrarySearch:{value:'A'},productLibraryProducts:[{id:'a',sku:'A',name:'测试产品',imageUrl:'/api/product-library/image/a',hasMaster:true}],readProductCategory:()=>({category:'',subcategory:''}),esc:value=>value,s7Path:value=>value});
 vm.runInContext(source.slice(source.indexOf('function renderProductLibrary(){'),source.indexOf('async function removeTaskProduct(')),c);c.renderProductLibrary();
 const input={files:[{name:'1.png'},{name:'2.png'}],value:'files'},query=c.document.querySelector,fileData=c.fileData;
 c.crypto=crypto;c.document.querySelector=id=>id==='#logo-image'?input:query(id);
 c.fileData=async blob=>{if(blob.id)return fileData(blob);if(blob.name==='2.png'){readingSecond.resolve();await secondFile.promise;}return {data:blob.name==='1.png'?'red-image':'blue-image'};};
 const start=source.indexOf("document.querySelector('#logo-image').onchange=");
 vm.runInContext(source.slice(start,source.indexOf('useSavedLogoButton.onclick=',start)),c);
 const product=c.showMultiProduct('a'),upload=input.onchange({target:input});await readingSecond.promise;
 complete('a');await product;
 assert.equal(c.logoSelectionBusy,true,'后续文件读取期间应继续禁止生成和移除');
 await c.removeTaskLogo(c.taskLogos[0].id);assert.equal(c.taskLogos.length,1);
 secondFile.resolve();await upload;
 assert.equal(c.taskLogos.length,2);assert.equal(c.logoData,'blue-image');assert.equal(c.logoSelectionBusy,false);
 assert.equal(productList.inputs[0].disabled,false,'上传完成后产品选择应恢复可用');
});
