import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');

function library(){
 const list={dataset:{},inputs:[],writes:0,querySelectorAll(){return this.inputs;},set innerHTML(html){this.html=html;this.writes++;this.inputs=[...html.matchAll(/data-logo-id="([^"]+)"/g)].map(match=>({dataset:{logoId:match[1]},checked:false,disabled:false,addEventListener(_event,handler){this.change=handler;}}));}};
 let release;const pending=new Promise(resolve=>release=resolve),requests=[];
 const c=vm.createContext({logoLibraryList:list,logoLibrarySearch:{value:''},logoLibraryItems:[{id:'one',name:'Logo.png',createdAt:'2026-10-26',imageUrl:'/api/logo-library/one/image'}],taskLogos:[],generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,multiLogoEnabled:true,multiPackageProducts:[],esc:value=>value,logoLibraryPath:value=>value,updateGenerateButton(){},renderProductLibrary(){},setStatus(){},fetch:url=>{requests.push(url);return pending;},fileData:async()=>({data:'original-image'}),addTaskLogo:async logo=>{c.taskLogos.push(logo);c.renderLogoLibrary();}});
 vm.runInContext(source.slice(source.indexOf('function renderLogoLibrary(){'),source.indexOf('async function openLogoLibrary()')),c);
 c.renderLogoLibrary();return {c,list,requests,release};
}

test('Logo 列表只显示缩略图，选择期间保留勾选及图片节点，原图只请求一次',async()=>{
 const {c,list,requests,release}=library();
 assert.match(list.html,/image\?thumbnail=1/);
 const input=list.inputs[0];input.checked=true;const loading=input.change();
 assert.equal(list.inputs[0],input);assert.equal(input.checked,true);assert.equal(input.disabled,true);
 assert.deepEqual(requests,['/api/logo-library/one/image']);
 release({ok:true,blob:async()=>({})});await loading;
 assert.equal(list.inputs[0],input);assert.equal(input.checked,true);assert.equal(input.disabled,false);assert.equal(list.writes,1);
 assert.equal(c.taskLogos[0].logoImage,'original-image');
});

test('Logo 原图加载失败后清除待选状态并恢复可选',async()=>{
 const {list,release}=library();const input=list.inputs[0];input.checked=true;
 const loading=input.change();release({ok:false});await loading;
 assert.equal(list.inputs[0],input);assert.equal(input.checked,false);assert.equal(input.disabled,false);
});

test('任务草稿只保存一份 Logo 原图，兼容无 Logo 列表的旧任务',()=>{
 const capture=source.match(/capture:(\(\)=>\{.*?\}),\s*onSaved:/s)[1];
 const c=vm.createContext({captureMultiLogoLayouts:()=>[],captureMultiProductLayouts:()=>[],mode:'ordinary',taskLogos:[{id:'one',logoImage:'original-image',sourceData:'source-image'}],selectedTaskLogoId:'one',schemeState:null,activeScheme:'BLACK',placementScope:'shared',savedSignatures:{},dismissedGenerationId:null,downloadSelection:{},selectedGenerationVersions:()=>[],baseData:'',loadedMultiProductId:null,logoData:'original-image',logoSourceData:'source-image',baseImage:null,logoImage:{src:'data:image/png;base64,original-image'},collectTargets:()=>[],selectedTargetId:null,mockupModel:{value:'model'},document:{querySelector:()=>({value:'original',textContent:''})},multiPackageProducts:[],lastResultPayload:null,selectedMultiProductId:null});
 const save=vm.runInContext(capture,c);const state=save();
 assert.equal(state.logoData,'');assert.equal(state.logoSourceData,'');assert.equal(state.logoDataUrl,'');
 assert.equal(JSON.stringify(state).split('original-image').length-1,1);
 c.taskLogos=[];assert.equal(save().logoData,'original-image');assert.equal(save().logoSourceData,'source-image');
});
