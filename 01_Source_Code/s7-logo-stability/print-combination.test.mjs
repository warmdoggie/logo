import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPrintCombinationDialog} from './foil-confirmation.mjs';

const finishes=['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL','ROSE GOLD FOIL','LASER FOIL'];
const template={zones:[{id:'p',zoneType:'logo'},{id:'c',zoneType:'logo'}],automation:{carriers:[{id:'p',type:'BODY'},{id:'c',type:'CARTON'}],areas:[{zoneId:'p',carrierId:'p',foilProcesses:['SILVER FOIL']},{zoneId:'c',carrierId:'c'}]}};
function fixture(){
 const product={value:'ORIGINAL',options:finishes.map(value=>({value,disabled:false}))},carton={value:'ORIGINAL',options:finishes.map(value=>({value,disabled:false}))};
 const nodes={'[data-combination-product]':product,'[data-combination-carton]':carton,'[data-combination-cancel]':{},'[data-combination-confirm]':{},'[data-combination-error]':{},'[data-combination-warning]':{},'[data-combination-rule]':{}};
 const dialog={open:false,querySelector:key=>nodes[key],showModal(){this.open=true;},close(){this.open=false;}};
 return {dialog,product,carton,nodes};
}

test('only the two printing dropdowns are needed; each keeps its own selection and permission checks',async()=>{
 const f=fixture(),pending=mountPrintCombinationDialog(f.dialog)([template]);
 assert.equal(f.dialog.open,true);assert.equal(f.product.value,'ORIGINAL');assert.equal(f.carton.value,'ORIGINAL');
 assert.equal(f.product.options.find(o=>o.value==='GOLD FOIL').disabled,true);
 assert.equal(f.product.options.find(o=>o.value==='SILVER FOIL').disabled,false);
 assert.equal(f.carton.options.find(o=>o.value==='GOLD FOIL').disabled,false);
 f.product.value='SILVER FOIL';f.product.onchange();
 f.carton.value='GOLD FOIL';f.carton.onchange();
 assert.equal(f.product.value,'SILVER FOIL');assert.equal(f.nodes['[data-combination-warning]'].hidden,false);
 f.nodes['[data-combination-confirm]'].onclick();
 assert.deepEqual(await pending,{product:'SILVER FOIL',carton:'GOLD FOIL'});assert.equal(f.dialog.open,false);
});

test('cancelling keeps no selection and reopening defaults to ordinary printing',async()=>{
 const f=fixture(),choose=mountPrintCombinationDialog(f.dialog),first=choose([template]);
 f.carton.value='SILVER FOIL';f.nodes['[data-combination-cancel]'].onclick();assert.equal(await first,null);
 const second=choose([template]);assert.equal(f.product.value,'ORIGINAL');assert.equal(f.carton.value,'ORIGINAL');
 f.nodes['[data-combination-cancel]'].onclick();assert.equal(await second,null);
});

test('injected unsupported foil cannot be confirmed and mixed SKUs use shared permissions',async()=>{
 const f=fixture(),other=structuredClone(template);other.automation.areas[0].foilProcesses=[];
 const pending=mountPrintCombinationDialog(f.dialog)([template,other]);
 assert.equal(f.product.options.find(o=>o.value==='SILVER FOIL').disabled,true);
 f.product.value='SILVER FOIL';f.nodes['[data-combination-confirm]'].onclick();
 assert.equal(f.dialog.open,true);assert.ok(f.nodes['[data-combination-error]'].textContent);
 f.nodes['[data-combination-cancel]'].onclick();assert.equal(await pending,null);
});

test('carton warning follows only the carton dropdown without changing product printing',async()=>{
 const f=fixture(),pending=mountPrintCombinationDialog(f.dialog)([template]);
 f.product.value='BLACK';f.product.onchange();f.carton.value='SILVER FOIL';f.carton.onchange();
 assert.equal(f.nodes['[data-combination-warning]'].hidden,false);
 f.carton.value='ORIGINAL';f.carton.onchange();
 assert.equal(f.nodes['[data-combination-warning]'].hidden,true);assert.equal(f.product.value,'BLACK');
 f.nodes['[data-combination-confirm]'].onclick();assert.deepEqual(await pending,{product:'BLACK',carton:'ORIGINAL'});
});
