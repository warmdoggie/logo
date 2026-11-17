import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {pointerToNormalized} from './demo-geometry.mjs';
import {createSchemes} from './schemes.mjs';
import {createPlacementHistory} from './target-state.mjs';

const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
function workspace(){
 const events={},outlines=[],arrows=[],captures=[],target={id:'logo',x:.5,y:.5,widthRatio:.2,rotation:0,curve:0};
 const context={clearRect(){},drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(400*200*4)}),save(){},restore(){},translate(){},rotate(){},setLineDash(){},strokeRect:(...args)=>outlines.push(args),beginPath(){},moveTo(){},lineTo(){},stroke:()=>outlines.push('stroke'),fillRect(){}};
 const c=vm.createContext({canvas:{width:400,height:200,getContext:()=>context,getBoundingClientRect:()=>({left:0,top:0,width:400,height:200}),addEventListener:(name,callback)=>events[name]=callback,setPointerCapture:id=>captures.push(id),classList:{add(){}}},
  baseImage:{naturalWidth:400,naturalHeight:200},logoImage:{naturalWidth:40,naturalHeight:20},baseData:'base',previewEmpty:{},previewBaseImage:null,previewBasePixels:null,rebuildingTargets:false,selectedTargetId:'logo',selectedTargetIds:new Set(['logo']),dragTarget:null,dragMode:null,
  schemeState:createSchemes([target]),structuredClone,placementGestureStart:null,placementHistory:createPlacementHistory(),loadedMultiProductId:'product',loadedTaskLogoId:'logo',
  syncSchemeState(){},queueSchemeCards(){},taskDraft:{schedule(){}},collectTargets:()=>[target],targetRect:()=>({left:160,top:80,width:80,height:40}),handlePoints:()=>({center:{x:200,y:100},scale:{x:240,y:120},rotation:{x:200,y:40}}),
  pointerToNormalized,distance:(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),targetAt:point=>point.x>=.4&&point.x<=.6&&point.y>=.4&&point.y<=.6?target:null,canMoveTarget:()=>true,
  refreshTargetSelection(){},chooseContrastColor:()=>null,resolveTargetPrint:()=>({color:'#000000',finish:'flat'}),renderTintedLogoLayer:()=>({}),curvePreviewLogo:layer=>layer,drawRotationArrow:(...args)=>arrows.push(args),document:{querySelector:()=>({value:'BLACK'})}
 });
 vm.runInContext(source.slice(source.indexOf('function isTargetSelected('),source.indexOf('function drawPreview(){')),c);
 vm.runInContext(source.slice(source.indexOf('function drawPreview(){'),source.indexOf("canvas.addEventListener('pointermove'")),c);
 return {c,events,outlines,arrows,captures};
}

test('clicking empty canvas hides all outlines and clicking the logo selects it again',()=>{
 const {c,events,outlines,captures}=workspace();
 c.drawPreview();assert.ok(outlines.length>0);
 outlines.length=0;events.pointerdown({clientX:20,clientY:20,pointerId:1});
 assert.equal(c.selectedTargetId,null);assert.equal(c.dragTarget,null);assert.equal(outlines.length,0);assert.equal(captures.length,0);
 events.pointerdown({clientX:200,clientY:100,pointerId:2});
 assert.equal(c.selectedTargetId,'logo');assert.equal(c.dragMode,'move');assert.deepEqual(captures,[2]);assert.ok(outlines.length>0);
});

test('unselected logos draw without a dashed bounding box',()=>{
 const {c,outlines}=workspace();c.selectedTargetId=null;c.drawPreview();assert.equal(outlines.length,0);
});

test('Ctrl 点选可追加或取消 Logo，全部已选 Logo 显示外框，空白单击清空',()=>{
 const {c,events,outlines,arrows,captures}=workspace();
 const first={id:'logo',x:.25,y:.5,widthRatio:.1,rotation:0},second={id:'box',x:.75,y:.5,widthRatio:.1,rotation:0};
 c.collectTargets=()=>[first,second];c.targetAt=point=>point.x<.4?first:point.x>.6?second:null;
 c.selectedTargetIds=new Set(['logo']);
 events.pointerdown({clientX:300,clientY:100,pointerId:1,ctrlKey:true,preventDefault(){}});
 assert.deepEqual([...c.selectedTargetIds],['logo','box']);
 assert.equal(c.dragTarget,null);assert.equal(captures.length,0);
 outlines.length=0;arrows.length=0;c.drawPreview();assert.equal(outlines.filter(Array.isArray).length,2);assert.equal(arrows.length,2);
 events.pointerdown({clientX:100,clientY:100,pointerId:2,ctrlKey:true,preventDefault(){}});
 assert.deepEqual([...c.selectedTargetIds],['box']);
 events.pointerdown({clientX:200,clientY:190,pointerId:3,preventDefault(){}});
 assert.equal(c.selectedTargetId,null);assert.equal(c.selectedTargetIds.size,0);
});

test('local generation can be selected without contacting the AI model status endpoint',async()=>{
 const model={replaceChildren(...options){this.options=options;}},c=vm.createContext({mockupModel:model,Option:function(text,value){this.textContent=text;this.value=value;},renderMultiProductResults(){},fetch:async()=>{throw Error('local generation must not require the AI provider');}});
 vm.runInContext(source.slice(source.indexOf('async function loadMockupModels(){'),source.indexOf('function setPreviewScale(')),c);
 await c.loadMockupModels();assert.equal(model.value,'local');assert.ok(model.options.some(option=>option.value==='local'));
});

test('rotated and perspective logos can be reselected only within their visible bounds',()=>{
 const target={id:'logo',x:.5,y:.5,widthRatio:.4,rotation:90};
 const c=vm.createContext({canvas:{width:400,height:200},logoImage:{naturalWidth:100,naturalHeight:20},collectTargets:()=>[target]});
 vm.runInContext(source.slice(source.indexOf('function targetRect('),source.indexOf('function canvasPoint(')),c);
 assert.equal(c.targetAt({x:.5,y:.2})?.id,'logo');assert.equal(c.targetAt({x:.35,y:.5}),null);
 target.quad=[{x:.1,y:.1},{x:.3,y:.15},{x:.25,y:.4},{x:.05,y:.35}];
 assert.equal(c.targetAt({x:.15,y:.25})?.id,'logo');assert.equal(c.targetAt({x:.5,y:.5}),null);
});

test('the legacy multi-logo page offers local generation without AI model configuration',async()=>{
 const legacy=(await readFile(new URL('./multi-logo.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n'),nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{append(){},replaceChildren(...options){this.options=options;}});return nodes.get(id);};
 const c=vm.createContext({$:node,Option:function(text,value){this.textContent=text;this.value=value;},window:{parent:{postMessage(){}},addEventListener(){}},taskId:'task',path:value=>value,
  api:async url=>{if(url==='/api/session')return {user:{id:'test'}};if(url==='/api/features')return {multiLogo:true};if(url==='/api/product-library'||url==='/api/logo-library')return [];throw Error('No AI configuration');},
  createTaskDraft:()=>({load:async()=>({mode:'multi-logo',logos:[]}),activate(){},isDirty:()=>false}),createGenerationWatcher:()=>({refresh:async()=>{}}),renderLogos(){},selectProduct:async()=>{},controls(){},renderJob(){},renderLibrary(){},status(){},job:null
 });
 await vm.runInContext('(async()=>{'+legacy.slice(legacy.lastIndexOf("try{\n const session="))+'})()',c);
 assert.equal(node('model').value,'local');assert.ok(node('model').options.some(option=>option.value==='local'));
});
