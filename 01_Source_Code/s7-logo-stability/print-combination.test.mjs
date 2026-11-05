import test from 'node:test';
import assert from 'node:assert/strict';
import * as dialogs from './foil-confirmation.mjs';

const finishes=['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL','ROSE GOLD FOIL','LASER FOIL'];
const template={zones:[{id:'p',zoneType:'logo'},{id:'c',zoneType:'logo'}],automation:{carriers:[{id:'p',type:'BODY'},{id:'c',type:'CARTON'}],areas:[{zoneId:'p',carrierId:'p',foilProcesses:['SILVER FOIL']},{zoneId:'c',carrierId:'c'}]}};
function fixture(){
 const product={value:'ORIGINAL',options:finishes.map(value=>({value,disabled:false}))},carton={value:'ORIGINAL',options:finishes.map(value=>({value,disabled:false}))};
 const nodes={'[data-combination-product]':product,'[data-combination-carton]':carton,'[data-combination-cancel]':{},'[data-combination-confirm]':{},'[data-combination-error]':{},'[data-combination-warning]':{},'[data-combination-rule]':{}};
 const dialog={open:false,querySelector:key=>nodes[key],showModal(){this.open=true;},close(){this.open=false;}};
 return {dialog,product,carton,nodes};
}
test('增加搭配默认普通印刷，产品禁用母版不支持的工艺而彩盒可选烫印',async()=>{
 const f=fixture(),choose=dialogs.mountPrintCombinationDialog(f.dialog),pending=choose([template]);
 assert.equal(f.dialog.open,true);assert.equal(f.product.value,'ORIGINAL');assert.equal(f.carton.value,'ORIGINAL');
 assert.equal(f.product.options.find(o=>o.value==='GOLD FOIL').disabled,true);
 assert.equal(f.product.options.find(o=>o.value==='SILVER FOIL').disabled,false);
 assert.equal(f.carton.options.find(o=>o.value==='GOLD FOIL').disabled,false);
 f.carton.value='GOLD FOIL';f.carton.onchange();assert.equal(f.nodes['[data-combination-warning]'].hidden,false);
 f.nodes['[data-combination-confirm]'].onclick();assert.deepEqual(await pending,{product:'ORIGINAL',carton:'GOLD FOIL'});assert.equal(f.dialog.open,false);
});
test('取消增加搭配不产生选择，重新打开默认不烫印',async()=>{
 const f=fixture(),choose=dialogs.mountPrintCombinationDialog(f.dialog),first=choose([template]);
 assert.equal(f.dialog.open,true);f.carton.value='SILVER FOIL';f.nodes['[data-combination-cancel]'].onclick();assert.equal(await first,null);
 const second=choose([template]);assert.equal(f.carton.value,'ORIGINAL');f.nodes['[data-combination-cancel]'].onclick();assert.equal(await second,null);
});
test('禁用工艺即使被注入选择也不能确认，混合 SKU 使用母版共同支持工艺',async()=>{
 const f=fixture(),other=structuredClone(template);other.automation.areas[0].foilProcesses=[];
 const choose=dialogs.mountPrintCombinationDialog(f.dialog),pending=choose([template,other]);
 assert.equal(f.dialog.open,true);assert.equal(f.product.options.find(o=>o.value==='SILVER FOIL').disabled,true);
 f.product.value='SILVER FOIL';f.nodes['[data-combination-confirm]'].onclick();assert.equal(f.dialog.open,true);assert.ok(f.nodes['[data-combination-error]'].textContent);
 f.nodes['[data-combination-cancel]'].onclick();assert.equal(await pending,null);
});
