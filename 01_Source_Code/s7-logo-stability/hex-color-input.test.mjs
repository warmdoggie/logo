import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createSchemes,setCustomColors} from './schemes.mjs';

async function workspace(){
  const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
  const start=source.indexOf('function readHexColor(');
  assert.ok(start>=0,'HEX 输入应先验证再修改配色');
  const input=()=>({value:'#000000',setAttribute(name,value){this[name]=value;}}),nodes={};
  for(const group of ['product','carton']){nodes[`#custom-${group}-color`]=input();nodes[`#custom-${group}-color-value`]={};}
  const row={dataset:{targetId:'body',logoColor:'#000000'}},originalColorInput=input(),originalColorValue={};
  let previews=0;
  const c=vm.createContext({setCustomColors,activeScheme:'CUSTOM',copyingProductPreset:false,generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,
    schemeState:createSchemes([{id:'body',carrierType:'BODY',color:'#000000'},{id:'box',carrierType:'CARTON_FRONT',color:'#000000'}]),
    document:{querySelector:id=>nodes[id]},targets:{children:[row]},selectedTargetId:'body',originalColorInput,originalColorValue,
    syncSchemeState(){},loadSchemeTargets(){previews++;},drawPreview(){previews++;},taskDraft:{schedule(){}}
  });
  vm.runInContext(source.slice(start,source.indexOf("document.querySelector('#keep-original-colors').onchange",start)),c);
  return {c,nodes,row,originalColorInput,previews:()=>previews};
}

test('custom HEX fields accept six digits with optional hash and normalize case',async()=>{
  const {c,nodes}=await workspace();
  for(const [group,value,want] of [['product','aBc123','#ABC123'],['carton','#ff0055','#FF0055']]){
    const input=nodes[`#custom-${group}-color`];input.value=value;input.oninput({target:input});
    assert.equal(input.value,want);
  }
  assert.deepEqual(c.schemeState.schemes.find(s=>s.version==='CUSTOM').targets.map(t=>t.color),['#ABC123','#FF0055']);
});

test('incomplete or invalid HEX input never changes the last valid custom color',async()=>{
  const {c,nodes,previews}=await workspace(),input=nodes['#custom-product-color'];
  for(const value of ['', '#', '#123', '#12345g', 'rgb(1,2,3)']){
    input.value=value;input.oninput({target:input});
    assert.equal(c.schemeState.schemes.find(s=>s.version==='CUSTOM').targets[0].color,'#000000');
    assert.equal(input['aria-invalid'],'true');
  }
  assert.equal(previews(),0);
  input.value='112233';input.oninput({target:input});
  assert.equal(input['aria-invalid'],'false');assert.equal(nodes['#custom-product-color-value'].textContent,'');
  assert.equal(previews(),1);
});

test('the existing region color also accepts HEX text without saving partial input',async()=>{
  const {row,originalColorInput:input,previews}=await workspace();
  input.value='#12';input.oninput();assert.equal(row.dataset.logoColor,'#000000');assert.equal(previews(),0);
  input.value='abcdef';input.oninput();assert.equal(row.dataset.logoColor,'#ABCDEF');assert.equal(row.dataset.keepOriginal,'false');assert.equal(previews(),1);
});
