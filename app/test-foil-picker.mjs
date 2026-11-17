import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mountFoilPicker} from './public/foil-targets.js';

test('changing foil updates the single swatch and name and collapses the options without changing target selection',()=>{
 const choices=['GOLD','SILVER','ROSE_GOLD','HOLOGRAPHIC'].map(value=>({value,checked:value==='GOLD'}));
 const targets=[{value:'PRODUCT',checked:true},{value:'CARTON',checked:false}];
 const nodes={'[data-foil-picker]':{open:true},'[data-foil-name]':{},'[data-foil-swatch]':{},'[data-answer="1"]':{}};
 const dialog={querySelector:s=>s==='[name=foilTarget]:checked'?targets.find(t=>t.checked):nodes[s],querySelectorAll:s=>s==='[name=foil]'?choices:targets};
 mountFoilPicker(dialog,{GOLD:{name:'烫金'},SILVER:{name:'烫银'},ROSE_GOLD:{name:'烫玫瑰金'},HOLOGRAPHIC:{name:'烫镭射'}});
 for(const [value,name]of [['SILVER','烫银'],['ROSE_GOLD','烫玫瑰金'],['HOLOGRAPHIC','烫镭射']]){
  nodes['[data-foil-picker]'].open=true;choices.find(c=>c.value===value).onchange();
  assert.equal(nodes['[data-foil-name]'].textContent,name);
  assert.equal(nodes['[data-foil-swatch]'].className,'sales-foil-swatch foil-'+value);
  assert.equal(nodes['[data-foil-picker]'].open,false);
  assert.deepEqual(targets.map(t=>t.checked),[true,false]);
 }
 targets[0].checked=false;targets[0].onchange();assert.equal(nodes['[data-answer="1"]'].disabled,true);
 targets[1].checked=true;targets[1].onchange();assert.equal(nodes['[data-answer="1"]'].disabled,false);
});
