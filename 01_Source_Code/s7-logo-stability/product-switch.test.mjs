import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('切到尚在加载的产品后立即返回，必须重新呈现原产品并丢弃迟到的加载',async()=>{
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8'),rendered=[];
 let release;const pending=new Promise(r=>release=r);
 const context=vm.createContext({taskLogos:[],selectedMultiProductId:'a',loadedMultiProductId:'a',multiProductLoadRevision:0,multiPackageProducts:[{id:'a',sku:'A'},{id:'b',sku:'B'}],multiProductViews:new Map(),renderMultiProductResults:()=>{},saveMultiProductView:()=>{},setStatus:()=>{},fetch:()=>pending,queueSchemeCards:()=>rendered.push(context.selectedMultiProductId)});
 vm.runInContext(source.slice(source.indexOf('async function showMultiProduct('),source.indexOf('function renderMultiProductResults()')),context);
 const loading=vm.runInContext("showMultiProduct('b')",context);await vm.runInContext("showMultiProduct('a')",context);
 assert.deepEqual(rendered,['b','a']);release({ok:false});await loading;assert.equal(context.loadedMultiProductId,'a');
});

test('尚未有批量生成记录时，切换到新产品不能沿用上个产品的成图',async()=>{
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
 const context=vm.createContext({taskLogos:[],selectedMultiProductId:'b',loadedMultiProductId:'a',multiProductJob:null,multiProductViews:new Map(),lastResultPayload:{outputs:[{version:'ORIGINAL',dataUrl:'/a.png'}]},s7Path:value=>value});
 vm.runInContext(source.slice(source.indexOf('function schemeOutput('),source.indexOf('function modifiedSchemes()')),context);
 assert.equal(vm.runInContext("schemeOutput('ORIGINAL')",context),undefined);
 context.multiProductViews.set('b',{lastResultPayload:{outputs:[{version:'ORIGINAL',dataUrl:'/b.png'}]}});
 assert.equal(vm.runInContext("schemeOutput('ORIGINAL').dataUrl",context),'/b.png');
});

test('刷新产品状态保留标签节点，清空再选回同一产品仍能重建标签',async()=>{
 const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
 const tabs={dataset:{},buttons:[],replaceChildren(){this.buttons=[];},querySelectorAll(){return this.buttons;},set innerHTML(text){this.buttons=[...text.matchAll(/data-multi-product-id="([^"]+)"/g)].map(match=>({dataset:{multiProductId:match[1]},classList:{toggle(){}},setAttribute(){},querySelector(){return {};},addEventListener(){}}));}};
 const product={id:'a',sku:'A'},context=vm.createContext({taskLogos:[],multiPackageProducts:[product],selectedMultiProductId:'a',multiProductTabs:tabs,multiProductOutput:{replaceChildren(){}},results:{},previewSection:{},resultMeta:{},multiProductResults:new Map(),multiProductJob:null,multiPackageBusy:false,s7Path:value=>value,esc:value=>value});
 vm.runInContext(source.slice(source.indexOf('function renderMultiProductResults(){'),source.indexOf('async function openProductLibrary()')),context);
 vm.runInContext('renderMultiProductResults()',context);const button=tabs.buttons[0];vm.runInContext('renderMultiProductResults()',context);assert.equal(tabs.buttons[0],button);
 context.multiPackageProducts=[];vm.runInContext('renderMultiProductResults()',context);context.multiPackageProducts=[product];
 assert.doesNotThrow(()=>vm.runInContext('renderMultiProductResults()',context));assert.equal(tabs.buttons.length,1);
});
