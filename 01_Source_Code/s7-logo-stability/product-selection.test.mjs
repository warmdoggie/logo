import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createSchemes} from './schemes.mjs';
import {masterTargetsFromTemplate} from './product-master.mjs';

const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');

function library(){
 const product={id:'one',sku:'F001',name:'产品',category:'脸部',subcategory:'腮红',imageUrl:'/api/product-library/image/one',hasMaster:true};
 const list={dataset:{},inputs:[],writes:0,querySelectorAll(){return this.inputs;},set innerHTML(html){this.html=html;this.writes++;this.inputs=[...html.matchAll(/data-batch-product-id="([^"]+)"/g)].map(match=>({dataset:{batchProductId:match[1]},checked:false,disabled:false,addEventListener(_event,handler){this.change=handler;}}));}};
 const c=vm.createContext({productLibraryList:list,productLibrarySearch:{value:'F001'},productLibraryProducts:[product],readProductCategory:()=>({category:'',subcategory:''}),multiPackageProducts:[],taskLogos:[],generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,esc:value=>value,s7Path:value=>'/s7'+value});
 vm.runInContext(source.slice(source.indexOf('function renderProductLibrary(){'),source.indexOf('async function removeTaskProduct(')),c);
 c.renderProductLibrary();return {c,list,product};
}

test('产品选择列表使用缩略图，不用原图展示搜索结果',()=>{
 const {list}=library();
 assert.match(list.html,/src="\/s7\/api\/product-library\/image\/one\?thumbnail=1"/);
});

test('仅更新勾选或忙碌状态时保留产品图片节点',()=>{
 const {c,list,product}=library(),input=list.inputs[0];
 c.multiPackageProducts=[product];c.renderProductLibrary();
 assert.equal(list.inputs[0],input);assert.equal(input.checked,true);
 c.logoSelectionBusy=true;c.renderProductLibrary();
 assert.equal(input.disabled,true);assert.equal(list.writes,1);
 c.logoSelectionBusy=false;c.multiPackageProducts=[];c.renderProductLibrary();
 assert.equal(input.checked,false);assert.equal(input.disabled,false);
 c.productLibrarySearch.value='';c.renderProductLibrary();assert.equal(list.inputs.length,0);
 c.productLibrarySearch.value='F001';c.renderProductLibrary();assert.equal(list.inputs.length,1);
});

function workspace(){
 const targets=[{id:'body',x:.5,y:.5,widthRatio:.2}],a={baseData:'base-a',baseImage:{id:'a'},schemeState:createSchemes(targets),activeScheme:'ORIGINAL',placementScope:'shared',selectedTargetId:'body',savedSignatures:{}};
 const pending=Promise.withResolvers(),requests=[],rendered=[],errors=[];
 const c=vm.createContext({currentTaskId:null,s7User:null,structuredClone,createSchemes,masterTargetsFromTemplate,multiProductViews:new Map([['a',a]]),multiProductLoads:new Map(),multiPackageProducts:[{id:'a',sku:'A'},{id:'b',sku:'B'}],selectedMultiProductId:'a',loadedMultiProductId:'a',multiProductLoadRevision:0,taskLogos:[],multiProductJob:null,...a,
  renderMultiProductResults(){},saveMultiProductView(){},queueSchemeCards(){},setStatus:(message,type)=>{if(type==='error')errors.push(message);},
  fetch:url=>{requests.push(url);return url.includes('/template/')?Promise.resolve({ok:true,json:async()=>({template:{zones:[{id:'body',zoneType:'logo',x:.2,y:.2,width:.4,height:.2}]}})}):pending.promise;},
  fileData:async()=>({data:'base-b',dataUrl:'data:image/png;base64,base-b'}),loadImage:async()=>({id:'b'}),document:{querySelector:()=>({})},loadSchemeTargets:()=>rendered.push(c.loadedMultiProductId)
 });
 vm.runInContext(source.slice(source.indexOf('async function showMultiProduct('),source.indexOf('function saveMultiLogoView(){')),c);
 return {c,pending,requests,rendered,errors};
}

test('原图加载中切走再切回同一产品，只下载一次并显示最后选中的产品',async()=>{
 const {c,pending,requests,rendered}=workspace();
 const first=c.showMultiProduct('b');await c.showMultiProduct('a');const second=c.showMultiProduct('b');
 pending.resolve({ok:true,blob:async()=>({})});await Promise.all([first,second]);
 assert.deepEqual(requests,['/api/product-library/image/b','/api/product-library/template/b']);
 assert.equal(c.loadedMultiProductId,'b');assert.equal(c.baseData,'base-b');assert.deepEqual(rendered,['b']);
 await c.showMultiProduct('a');await c.showMultiProduct('b');assert.equal(requests.length,2);
 assert.equal(c.schemeState.schemes.length,4);
});

test('原图加载失败后允许重新请求，不缓存失败结果',async()=>{
 const {c,pending,requests,errors}=workspace();
 const failed=c.showMultiProduct('b');pending.resolve({ok:false});await failed;
 assert.equal(c.loadedMultiProductId,'a');assert.equal(errors.length,1);
 c.fetch=async url=>{requests.push(url);return {ok:true,blob:async()=>({}),json:async()=>({template:{zones:[{id:'body',zoneType:'logo',x:.2,y:.2,width:.4,height:.2}]}})};};
 await c.showMultiProduct('b');assert.equal(c.loadedMultiProductId,'b');assert.equal(c.baseData,'base-b');
 assert.equal(requests.filter(url=>url==='/api/product-library/image/b').length,2);
});

test('恢复非当前产品时读取已保存快照，并继续保存该引用',async()=>{
 const {c,pending,requests}=workspace(),url='/api/my-space/tasks/task/assets/snapshot.png';
 c.multiProductViews.set('b',{baseAssetUrl:url,targets:[{id:'saved',x:.7,y:.5,widthRatio:.2}],schemeState:createSchemes([{id:'saved',x:.7,y:.5,widthRatio:.2}]),activeScheme:'ORIGINAL',placementScope:'shared',selectedTargetId:'saved'});
 const loading=c.showMultiProduct('b');pending.resolve({ok:true,blob:async()=>({})});await loading;
 assert.deepEqual(requests,[url+'?preview=1']);assert.equal(c.schemeState.schemes[0].targets[0].id,'saved');
 vm.runInContext(source.slice(source.indexOf('function captureMultiProductLayouts(){'),source.indexOf('async function showMultiProduct(')),c);
 assert.equal(c.captureMultiProductLayouts().find(layout=>layout.productId==='b').baseAssetUrl,url);
});
