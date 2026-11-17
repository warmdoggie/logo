import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

async function workspace(){
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8'),controls=new Map(),changes=[];
 for(const group of ['product','carton']){
  const input=new EventTarget();Object.assign(input,{value:'#000000',setAttribute(name,value){this[name]=value;}});
  input.addEventListener('input',event=>input.oninput?.(event));
  controls.set(`#custom-${group}-color`,input);
  controls.set(`#custom-${group}-color-picker`,{value:'#000000'});
  controls.set(`#custom-${group}-color-value`,{textContent:''});
 }
 const context=vm.createContext({document:{querySelector:selector=>controls.get(selector)},Event,activeScheme:'CUSTOM',copyingProductPreset:false,generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,schemeState:{},syncSchemeState(){},setCustomColors(state,patch){changes.push(patch);return state;},loadSchemeTargets(){},taskDraft:{schedule(){}}});
 const start=source.indexOf('function readHexColor(');
 vm.runInContext(source.slice(start,source.indexOf('originalColorInput.oninput=',start)),context);
 return {controls,changes,context};
}

for(const group of ['product','carton']){
 test(`${group} swatch applies its color through the existing scheme edit`,async()=>{
  const {controls,changes}=await workspace(),picker=controls.get(`#custom-${group}-color-picker`);
  picker.value='#27a5df';assert.equal(typeof picker.oninput,'function','预览色块应能选色');picker.oninput();
  assert.equal(controls.get(`#custom-${group}-color`).value,'#27A5DF');
  assert.equal(JSON.stringify(changes),JSON.stringify([{[group]:'#27A5DF'}]));
  const other=group==='product'?'carton':'product';
  assert.equal(controls.get(`#custom-${other}-color`).value,'#000000');
 });
 test(`${group} HEX edits update the swatch and incomplete input preserves its last color`,async()=>{
  const {controls,changes}=await workspace(),input=controls.get(`#custom-${group}-color`),picker=controls.get(`#custom-${group}-color-picker`);
  input.value='e34f62';input.dispatchEvent(new Event('input'));
  assert.equal(picker.value.toLowerCase(),'#e34f62');assert.equal(changes.length,1);
  input.value='#e34';input.dispatchEvent(new Event('input'));
  assert.equal(picker.value.toLowerCase(),'#e34f62');assert.equal(changes.length,1);assert.equal(input['aria-invalid'],'true');
 });
}
