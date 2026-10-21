import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {downloadKey,selectedDownloadOutputs,syncDownloadSelection} from './download-selection.mjs';

async function workspace(){
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8'),outputs=new Map();
 const context=vm.createContext({downloadKey,schemeNames:{ORIGINAL:'原色方案',BLACK:'黑白方案','GOLD FOIL':'烫金搭配','SILVER FOIL':'烫银搭配'},versionInputs:['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL'].map(value=>({value,checked:true})),
  downloadSelection:{},loadedMultiProductId:'product',generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,
  schemeOutput:version=>outputs.get(version),taskDraft:{schedule(){}},updateGenerateButton(){},updateDownloadSelection(){},
 });
 const start=source.indexOf('function updateSchemeSelection(');
 if(start>=0)vm.runInContext(source.slice(start,source.indexOf('function renderSchemeCards()',start)),context);
 assert.equal(typeof context.updateSchemeSelection,'function','圆形勾选框应支持生成前选择');
 return {context,outputs};
}
const checkbox=()=>({setAttribute(name,value){this[name]=value;}});

test('before generation the round selectors default to all selected and update generation choices',async()=>{
 const {context:c}=await workspace(),control=checkbox();
 c.updateSchemeSelection(control,'BLACK',null,false);assert.equal(control.disabled,false);assert.equal(control.checked,true);
 c.changeSchemeSelection('BLACK',false);c.updateSchemeSelection(control,'BLACK',null,false);
 assert.equal(control.checked,false);assert.deepEqual(c.versionInputs.filter(input=>input.checked).map(input=>input.value),['ORIGINAL','GOLD FOIL','SILVER FOIL']);
 assert.deepEqual(c.downloadSelection,{});
 c.generationBusy=true;c.updateSchemeSelection(control,'BLACK',null,false);assert.equal(control.disabled,true);
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
