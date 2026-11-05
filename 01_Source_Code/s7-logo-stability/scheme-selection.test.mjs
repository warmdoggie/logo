import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {downloadKey,selectedDownloadOutputs,syncDownloadSelection} from './download-selection.mjs';
import {visibleSchemeVersions} from './foil-selection.mjs';
import {createSchemes,ensureMixedSchemes} from './schemes.mjs';

async function workspace(){
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8'),html=await readFile(new URL('./demo.html',import.meta.url),'utf8'),outputs=new Map();
 const versions=html.match(/<fieldset id="generation-versions"[\s\S]*?<\/fieldset>/)[0];
 const versionInputs=[...versions.matchAll(/<input\b([^>]+)>/g)].map(([,attributes])=>({value:attributes.match(/value="([^"]+)"/)[1],checked:/\bchecked\b/.test(attributes)}));
 const context=vm.createContext({downloadKey,schemeNames:{ORIGINAL:'原色方案',BLACK:'黑白方案','GOLD FOIL':'烫金搭配','SILVER FOIL':'烫银搭配',CUSTOM:'自定义配色','ROSE GOLD FOIL':'烫玫瑰金搭配','LASER FOIL':'烫镭射搭配'},versionInputs,
  schemeState:null,visibleSchemeVersions,schemePhases:{},downloadSelection:{},loadedMultiProductId:'product',generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,
  generationSubmitting:false,copyingProductPreset:false,selectedMultiProductId:'product',taskLogos:[],multiPackageProducts:[],selectAllSchemes:checkbox(),
  schemeOutput:version=>outputs.get(version),taskDownloadOutputs:()=>[...outputs.values()],taskDraft:{schedule(){}},updateGenerateButton(){},updateDownloadSelection(){},queueSchemeCards(){},
 });
 const start=source.indexOf('function updateSchemeSelection(');
 if(start>=0)vm.runInContext(source.slice(start,source.indexOf('function renderSchemeCards()',start)),context);
 assert.equal(typeof context.updateSchemeSelection,'function','圆形勾选框应支持生成前选择');
 assert.equal(typeof context.updateAllSchemeSelection,'function','顶部全选圆圈应反映方案勾选状态');
 assert.equal(typeof context.changeAllSchemeSelection,'function','顶部全选圆圈应支持全选和全部取消');
 return {context,outputs};
}
const checkbox=()=>({setAttribute(name,value){this[name]=value;}});

test('before generation only original and black are selected and the all selector stays hollow',async()=>{
 const {context:c}=await workspace(),control=checkbox();
 assert.deepEqual(c.versionInputs.filter(input=>input.checked).map(input=>input.value),['ORIGINAL','BLACK']);
 c.updateAllSchemeSelection();assert.equal(c.selectAllSchemes.checked,false);assert.equal(c.selectAllSchemes.indeterminate,false);
 c.updateSchemeSelection(control,'BLACK',null,false);assert.equal(control.disabled,false);assert.equal(control.checked,true);
 c.changeSchemeSelection('BLACK',false);c.updateSchemeSelection(control,'BLACK',null,false);
 assert.equal(control.checked,false);assert.deepEqual(c.versionInputs.filter(input=>input.checked).map(input=>input.value),['ORIGINAL']);
 assert.deepEqual(c.downloadSelection,{});
 c.generationBusy=true;c.updateSchemeSelection(control,'BLACK',null,false);assert.equal(control.disabled,true);
});

test('select all and clear all share one generation selection across SKUs',async()=>{
 const {context:c}=await workspace();c.multiPackageProducts=[{id:'product'},{id:'other'}];
 c.changeAllSchemeSelection(true);c.updateAllSchemeSelection();
 assert.deepEqual(c.versionInputs.filter(input=>input.checked).map(input=>input.value),['ORIGINAL','BLACK','CUSTOM']);
 assert.equal(c.selectAllSchemes.checked,true);
 c.loadedMultiProductId='other';c.selectedMultiProductId='other';
 for(const version of ['ORIGINAL','BLACK','CUSTOM']){const control=checkbox();c.updateSchemeSelection(control,version,null,false);assert.equal(control.checked,true);}
 c.changeAllSchemeSelection(false);c.updateAllSchemeSelection();assert.equal(c.selectAllSchemes.checked,false);
 assert.deepEqual(c.versionInputs.filter(input=>input.checked),[]);
 c.loadedMultiProductId='product';c.selectedMultiProductId='product';
 for(const version of ['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL','CUSTOM','ROSE GOLD FOIL','LASER FOIL']){const control=checkbox();c.updateSchemeSelection(control,version,null,false);assert.equal(control.checked,false);}
});

test('select all and clear all include generated downloads from every selected SKU',async()=>{
 const {context:c,outputs}=await workspace();c.multiPackageProducts=[{id:'product'},{id:'other'}];
 const first={productId:'product',version:'BLACK',dataUrl:'/first.png'},second={productId:'other',version:'BLACK',dataUrl:'/second.png'};
 outputs.set('BLACK',first);outputs.set('other:BLACK',second);c.downloadSelection=syncDownloadSelection({},[first,second]);
 c.changeAllSchemeSelection(false);c.updateAllSchemeSelection();
 assert.deepEqual(selectedDownloadOutputs(c.downloadSelection,[first,second]),[]);assert.equal(c.selectAllSchemes.checked,false);
 c.changeAllSchemeSelection(true);c.updateAllSchemeSelection();
 assert.deepEqual(selectedDownloadOutputs(c.downloadSelection,[first,second]),[first,second]);assert.equal(c.selectAllSchemes.checked,true);
 c.changeSchemeSelection('BLACK',false);c.updateAllSchemeSelection();assert.equal(c.selectAllSchemes.checked,false);assert.equal(c.selectAllSchemes.indeterminate,false);
});

test('all selector reflects generated card selections even when generation preferences differ',async()=>{
 const {context:c,outputs}=await workspace();
 for(const version of ['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL','CUSTOM','ROSE GOLD FOIL','LASER FOIL'])outputs.set(version,{productId:'product',version,dataUrl:`/${version}.png`});
 c.downloadSelection=syncDownloadSelection({},[...outputs.values()]);c.updateAllSchemeSelection();assert.equal(c.selectAllSchemes.checked,true);
 c.changeSchemeSelection('CUSTOM',false);c.updateAllSchemeSelection();assert.equal(c.selectAllSchemes.checked,false);
});

test('all selector is disabled while generating or switching SKU',async()=>{
 const {context:c}=await workspace();
 c.generationSubmitting=true;c.updateAllSchemeSelection();assert.equal(c.selectAllSchemes.disabled,true);
 c.changeAllSchemeSelection(true);assert.deepEqual(c.versionInputs.filter(input=>input.checked).map(input=>input.value),['ORIGINAL','BLACK']);
 c.generationSubmitting=false;c.selectedMultiProductId='other';c.updateAllSchemeSelection();assert.equal(c.selectAllSchemes.disabled,true);
 c.selectedMultiProductId='product';c.updateAllSchemeSelection();assert.equal(c.selectAllSchemes.disabled,false);
});

test('after generation the same selector controls downloads without changing generation preferences',async()=>{
 const {context:c,outputs}=await workspace(),output={productId:'product',version:'BLACK',dataUrl:'/black.png'},control=checkbox();
 outputs.set('BLACK',output);c.downloadSelection=syncDownloadSelection({},[output]);
 c.updateSchemeSelection(control,'BLACK',output,false);assert.equal(control.checked,true);assert.equal(control.disabled,false);
 c.changeSchemeSelection('BLACK',false);c.updateSchemeSelection(control,'BLACK',output,false);
 assert.equal(control.checked,false);assert.deepEqual(selectedDownloadOutputs(c.downloadSelection,[output]),[]);
 assert.equal(c.versionInputs.find(input=>input.value==='BLACK').checked,true);
 c.changeSchemeSelection('BLACK',true);assert.deepEqual(selectedDownloadOutputs(c.downloadSelection,[output]),[output]);
 c.updateSchemeSelection(control,'BLACK',output,true);assert.equal(control.disabled,true);
});

test('母版禁止的历史失败烫印卡片不能再次勾选生成，但已有成图仍可下载',async()=>{
 const {context:c,outputs}=await workspace(),source=c.versionInputs.find(input=>input.value==='GOLD FOIL'),control=checkbox();source.disabled=true;
 c.updateSchemeSelection(control,'GOLD FOIL',null,false);assert.equal(control.disabled,true);
 c.changeSchemeSelection('GOLD FOIL',true);assert.equal(source.checked,false);
 const output={productId:'product',version:'GOLD FOIL',dataUrl:'/old-gold.png'};outputs.set('GOLD FOIL',output);c.downloadSelection=syncDownloadSelection({},[output]);
 c.updateSchemeSelection(control,'GOLD FOIL',output,false);assert.equal(control.disabled,false);assert.equal(control.checked,true);
});

test('在右侧取消烫印后立即刷新列表，不残留未启用的预览',async()=>{
 const {context:c}=await workspace();let displayed;
 c.queueSchemeCards=()=>{displayed=[...c.displayedSchemeVersions()];};
 c.versionInputs.find(input=>input.value==='SILVER FOIL').checked=true;c.queueSchemeCards();
 assert.deepEqual(displayed,['ORIGINAL','BLACK','CUSTOM','SILVER FOIL']);
 c.changeSchemeSelection('SILVER FOIL',false);
 assert.deepEqual(displayed,['ORIGINAL','BLACK','CUSTOM']);
});

async function clickableCards(){
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8'),cards=[],preview={};
 const element=()=>({disabled:false,setAttribute(){}});
 const c=vm.createContext({schemeNames:{ORIGINAL:'原色方案',BLACK:'黑白方案',MIX_ORIGINAL_SILVER:'产品原色 · 彩盒烫银'},foilVersions:[],versionInputs:[{value:'ORIGINAL',checked:true},{value:'BLACK',checked:false},{value:'MIX_ORIGINAL_SILVER',checked:false}],resultCards:new Map(),
  schemeState:ensureMixedSchemes(createSchemes([{id:'body',carrierType:'BODY',x:.5,y:.5,widthRatio:.1}]),['MIX_ORIGINAL_SILVER']),activeScheme:'ORIGINAL',placementScope:'shared',syncSchemeState(){},closePrintMenus(){},loadSchemeTargets(){},
  document:{querySelector:()=>preview,createElement:()=>{const nodes=new Map();return {dataset:{},addEventListener(){},querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector);}};}},results:{replaceChildren(){cards.length=0;},append:card=>cards.push(card)},schemeOutput:()=>null,changeSchemeSelection(){},regenerateResult(){},showModifiedPreview:new Set(),queueSchemeCards(){}
 });
 vm.runInContext(source.slice(source.indexOf('function bindSchemeSwipe('),source.indexOf('function renderSchemeCards(')),c);
 vm.runInContext(source.slice(source.indexOf('function switchScheme('),source.indexOf('function assetKey(')),c);
 vm.runInContext(source.slice(source.indexOf('function createSchemeCards(){'),source.indexOf("for(const button of document.querySelectorAll('[data-scope]')")),c);
 c.createSchemeCards();return {c,cards};
}

test('右侧卡片空白与标题都能切换方案，生成勾选不跟随改变',async()=>{
 const {c,cards}=await clickableCards(),blank={closest:()=>null};
 cards[1].onclick({target:blank});assert.equal(c.activeScheme,'BLACK');
 cards[2].onclick({target:blank});assert.equal(c.activeScheme,'MIX_ORIGINAL_SILVER');
 cards[0].onclick({target:blank});assert.equal(c.activeScheme,'ORIGINAL');
 assert.deepEqual(c.versionInputs.filter(input=>input.checked).map(input=>input.value),['ORIGINAL']);
});

test('圆圈、编辑按钮、缩略图、大图及重试控件不冒泡重复切换，SKU切换中也不响应空白点击',async()=>{
 const {c,cards}=await clickableCards(),card=cards[1];assert.equal(typeof card.onclick,'function');
 for(const selector of ['input','button','canvas','img','.generation-overlay']){card.onclick({target:{closest:query=>query.split(',').map(value=>value.trim()).includes(selector)?{}:null}});assert.equal(c.activeScheme,'ORIGINAL');}
 card.querySelector('.edit-scheme').disabled=true;card.onclick({target:{closest:()=>null}});assert.equal(c.activeScheme,'ORIGINAL');
});
