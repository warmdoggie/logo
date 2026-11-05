import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {visibleSchemeVersions} from './foil-selection.mjs';
import {createSchemes,editScheme,schemeSignature} from './schemes.mjs';

async function workspace(){
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
 const state={schemes:['ORIGINAL','BLACK','CUSTOM'].map(version=>({version,targets:[]}))};
 const c=vm.createContext({schemeState:structuredClone(state),activeScheme:'ORIGINAL',loadedMultiProductId:'one',selectedMultiProductId:'one',taskLogos:[],selectedTaskLogoId:'logo',loadedTaskLogoId:'logo',multiLogoViews:new Map(),multiProductViews:new Map([['two',{schemeState:structuredClone(state)}]]),generationBusy:false,generationSubmitting:false,multiPackageBusy:false,logoSelectionBusy:false,copyingProductPreset:false,
  versionInputs:[{value:'ORIGINAL',checked:true},{value:'BLACK',checked:true},{value:'CUSTOM',checked:false}],visibleSchemeVersions,schemePhases:{},taskDownloadOutputs:()=>[],syncSchemeState(){},saveMultiProductView(){this.multiProductViews.set(this.loadedMultiProductId,{schemeState:structuredClone(this.schemeState)});},switchScheme(version){this.activeScheme=version;},updateGenerateButton(){},updateDownloadSelection(){},queueSchemeCards(){},taskDraft:{schedule(){}},schemeNames:{ORIGINAL:'原色方案',BLACK:'黑白方案',CUSTOM:'自定义配色'},document:{querySelector:()=>({hidden:false,textContent:'',disabled:false})}});
 c.switchScheme=version=>{c.activeScheme=version;};c.saveMultiProductView=()=>{c.multiProductViews.set(c.loadedMultiProductId,{schemeState:structuredClone(c.schemeState)});};
 const start=source.indexOf('function schemeRemovalBlocked(');
 assert.notEqual(start,-1,'workspace must support reversible card removal');
 vm.runInContext(source.slice(start,source.indexOf('function changeAllSchemeSelection(',start)),c);
 return c;
}

test('删除当前方案会切换到剩余搭配、取消生成勾选，只影响当前 SKU，且可撤销',async()=>{
 const c=await workspace();c.removeSchemeCard('ORIGINAL');
 assert.deepEqual([...c.displayedSchemeVersions()],['BLACK','CUSTOM']);assert.equal(c.activeScheme,'BLACK');assert.equal(c.versionInputs[0].checked,false);
 assert.equal(c.multiProductViews.get('two').schemeState.removedSchemes,undefined);
 c.restoreRemovedScheme();assert.deepEqual([...c.displayedSchemeVersions()],['ORIGINAL','BLACK','CUSTOM']);assert.equal(c.versionInputs[0].checked,true);assert.equal(c.activeScheme,'ORIGINAL');
});
test('全部删除可保持空列表，草稿还原不复活，逐个撤销保留原勾选状态',async()=>{
 const c=await workspace();for(const version of ['ORIGINAL','BLACK','CUSTOM'])c.removeSchemeCard(version);
 c.schemeState=JSON.parse(JSON.stringify(c.schemeState));assert.deepEqual([...c.displayedSchemeVersions()],[]);
 c.restoreRemovedScheme();assert.deepEqual([...c.displayedSchemeVersions()],['CUSTOM']);assert.equal(c.versionInputs[2].checked,false);
});
test('生成中、切换 SKU 或 Logo 时不能删除或撤销',async()=>{
 const c=await workspace();c.generationBusy=true;c.removeSchemeCard('BLACK');assert.equal(c.schemeState.removedSchemes,undefined);
 c.generationBusy=false;c.selectedMultiProductId='two';c.removeSchemeCard('BLACK');assert.equal(c.schemeState.removedSchemes,undefined);
 c.selectedMultiProductId='one';c.taskLogos=[{},{}];c.loadedTaskLogoId='other';c.removeSchemeCard('BLACK');assert.equal(c.schemeState.removedSchemes,undefined);
});
test('已删除搭配退出下载列表，其他 SKU 同工艺成图仍保留，撤销后可找回',async()=>{
 const c=await workspace(),source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
 Object.assign(c,{multiPackageProducts:[{id:'one'},{id:'two'}],multiProductJob:{outputs:[{productId:'one',version:'BLACK',dataUrl:'/one.png'},{productId:'two',version:'BLACK',dataUrl:'/two.png'}]},s7Path:value=>value});
 vm.runInContext(source.slice(source.indexOf('function taskDownloadOutputs('),source.indexOf('function updateDownloadSelection(')),c);
 c.removeSchemeCard('BLACK');assert.deepEqual([...c.taskDownloadOutputs()].map(output=>output.productId),['two']);
 c.restoreRemovedScheme();assert.deepEqual([...c.taskDownloadOutputs()].map(output=>output.productId),['one','two']);
});
test('删除已生成搭配后，修改其他方案不会让它参加“重新生成已修改的方案”',async()=>{
 const c=await workspace(),source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
 c.schemeState=createSchemes([{id:'body',x:.3,y:.5,widthRatio:.1}]);
 Object.assign(c,{schemeSignature,assetKey:()=>'',schemeOutput:version=>version==='BLACK'?{version,dataUrl:'/black.png'}:null});
 vm.runInContext(source.slice(source.indexOf('function currentSignatures('),source.indexOf('function schemeOutput(')),c);
 vm.runInContext(source.slice(source.indexOf('function modifiedSchemes('),source.indexOf('function queueSchemeCards(')),c);
 c.savedSignatures=c.currentSignatures();c.removeSchemeCard('BLACK');
 c.schemeState=editScheme(c.schemeState,'ORIGINAL',[{id:'body',x:.4,y:.5,widthRatio:.1}],true);
 assert.deepEqual([...c.modifiedSchemes()],[]);
});

function card(){
 const handlers={},classes=new Set();return {handlers,style:{setProperty(name,value){this[name]=value;},removeProperty(name){delete this[name];}},dataset:{},classList:{add:v=>classes.add(v),remove:(...values)=>values.forEach(v=>classes.delete(v)),toggle:(v,on)=>on?classes.add(v):classes.delete(v)},addEventListener(name,fn){handlers[name]=fn;},setPointerCapture(){},releasePointerCapture(){},hasPointerCapture:()=>true};
}
const event=(x,y=0,extra={})=>({clientX:x,clientY:y,pointerId:1,button:0,pointerType:'mouse',target:{closest:()=>null},preventDefault(){},...extra});
async function swipe(){
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8'),c=vm.createContext({});
 vm.runInContext(source.slice(source.indexOf('function bindSchemeSwipe('),source.indexOf('function renderSchemeCards(')),c);return c.bindSchemeSwipe;
}
test('左拖达到阈值松手删除，拖动后不触发卡片点击',async()=>{
 const bindSchemeSwipe=await swipe(),node=card();let deleted=0,stopped=false;
 bindSchemeSwipe(node,{canRemove:()=>true,onRemove:()=>deleted++});
 node.handlers.pointerdown(event(200));node.handlers.pointermove(event(100));assert.equal(deleted,0);node.handlers.pointerup(event(100));assert.equal(deleted,1);
 node.handlers.click({preventDefault(){},stopImmediatePropagation(){stopped=true;}});assert.equal(stopped,true);
});
test('短拖、右拖、纵向滚动、取消手势、按钮点击或禁用状态都不删除',async()=>{
 const bindSchemeSwipe=await swipe();
 for(const [x,y,end]of [[170,0,'pointerup'],[300,0,'pointerup'],[100,150,'pointerup'],[100,0,'pointercancel']]){
  const node=card();let deleted=0;bindSchemeSwipe(node,{canRemove:()=>true,onRemove:()=>deleted++});node.handlers.pointerdown(event(200));node.handlers.pointermove(event(x,y));node.handlers[end](event(x,y));assert.equal(deleted,0);
 }
 for(const options of [{canRemove:()=>false},{canRemove:()=>true,target:{closest:()=>({})}}]){
  const node=card();let deleted=0;bindSchemeSwipe(node,{canRemove:options.canRemove,onRemove:()=>deleted++});node.handlers.pointerdown(event(200,0,options.target?{target:options.target}:{}));node.handlers.pointermove(event(100));node.handlers.pointerup(event(100));assert.equal(deleted,0);
 }
});
