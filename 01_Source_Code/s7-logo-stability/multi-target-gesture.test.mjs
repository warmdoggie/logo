import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createSchemes,editSelectedLogos} from './schemes.mjs';
import {isCarton} from './target-print.mjs';
import {pointerToNormalized,widthRatioFromScalePointer,rotationFromPointer} from './demo-geometry.mjs';
import {rotateTargetInPlace,createPlacementHistory,canMoveTarget,setTargetMoveEnabled} from './target-state.mjs';
import {rotationGestureMode} from './rotation-handle.mjs';
import {fitDefaultPlacements,constrainLogoPlacement} from '../public/s7-placement.js';

const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
function workspace(){
  const events={},timers=[],statuses=[];let clock=1000;
  const c=vm.createContext({fitDefaultPlacements,multiProductViews:new Map(),structuredClone,Set,editSelectedLogos,isCarton,pointerToNormalized,widthRatioFromScalePointer,rotationFromPointer,rotateTargetInPlace,rotationGestureMode,
    placementHistory:createPlacementHistory(),placementGestureStart:null,loadedTaskLogoId:'logo',undoPlacementButton:{},
    schemeState:createSchemes([{id:'p1',x:.25,y:.5,widthRatio:.12,rotation:0,carrierType:'BODY',color:'#112233'},{id:'p2',x:.55,y:.5,widthRatio:.12,rotation:0,carrierType:'BODY',color:'#112233'},{id:'box',x:.83,y:.5,widthRatio:.1,rotation:0,carrierType:'CARTON_FRONT',color:'#FF0000'}]),
    activeScheme:'CUSTOM',selectedTargetIds:new Set(['p1','p2','box']),selectedTargetId:'p2',dragTarget:null,dragMode:null,dragBatchGroup:null,rotateTimer:null,rotatePointerId:null,rotateStartedAt:0,rotationGesture:null,ROTATE_LONG_PRESS_MS:350,
    copyingProductPreset:false,generationSubmitting:false,generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,selectedMultiProductId:'a',loadedMultiProductId:'a',
    baseImage:{naturalWidth:600,naturalHeight:300},logoImage:{naturalWidth:120,naturalHeight:40},
    canvas:{width:600,height:300,getBoundingClientRect:()=>({left:0,top:0,width:600,height:300}),addEventListener:(name,fn)=>events[name]=fn,setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){},classList:{add(){},remove(){}}},
    Date:{now:()=>clock},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},
    collectTargets:()=>c.schemeState.schemes.find(s=>s.version===c.activeScheme).targets,
    handlePoints:target=>({center:{x:target.x*600,y:150},scale:{x:target.x*600+target.widthRatio*300,y:162},rotation:{x:target.x*600+50,y:100},rotationReferenceAngle:-45}),
    distance:(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),targetAt:()=>null,canMoveTarget:()=>true,
    syncSchemeState(){},loadSchemeTargets(){},refreshTargetSelection(){},drawPreview(){},updateInputs(){},updateQuad(){},keepTargetInsideCanvas(){},taskDraft:{schedule(){}},setStatus:(message,type)=>statuses.push({message,type})
  });
  vm.runInContext(source.slice(source.indexOf('function isTargetSelected('),source.indexOf('function drawPreview(){')),c);
  vm.runInContext(source.slice(source.indexOf('function applySelectedLogoPatch('),source.indexOf('function refreshTargetSelection(')),c);
  vm.runInContext(source.slice(source.indexOf("canvas.addEventListener('pointerdown'"),source.indexOf("canvas.addEventListener('contextmenu'")),c);
  return {c,events,timers,statuses,setClock:value=>{clock=value;}};
}
const event=(x,y,type='pointerdown')=>({clientX:x,clientY:y,pointerId:1,type,preventDefault(){}});

test('the original position button does not freeze a manually added Logo and dragging still stops at its product frame',()=>{
  const {c,events}=workspace(),template={zones:[{id:'body',zoneType:'logo',x:.1,y:.2,width:.4,height:.6}]};
  const target=c.collectTargets()[0];
  Object.assign(target,{masterZoneId:'body',masterLocked:false,regionUnlocked:false,widthRatio:.1});
  setTargetMoveEnabled(target,false);
  c.canMoveTarget=canMoveTarget;c.selectedTargetIds=new Set([target.id]);c.selectedTargetId=target.id;c.targetAt=()=>target;
  c.keepTargetInsideCanvas=(value,previous)=>Object.assign(value,constrainLogoPlacement(value,previous,template,{width:600,height:300},{width:120,height:40}));
  events.pointerdown(event(150,150));assert.equal(c.dragMode,'move');
  events.pointermove(event(540,150,'pointermove'));
  assert.ok(Math.abs(target.x-.45)<1e-7);assert.equal(target.y,.5);
  events.pointerup(event(540,150,'pointerup'));assert.equal(c.dragTarget,null);
});

test('多选后可拖动非主选 Logo 的缩放手柄，同类一起变大，保留全部选择及其他类别',()=>{
  const {c,events}=workspace(),before=structuredClone(c.schemeState);
  events.pointerdown(event(186,162));
  assert.equal(c.dragMode,'scale');assert.equal(c.dragTarget.id,'p1');assert.equal(c.selectedTargetIds.size,3);
  events.pointermove(event(210,162,'pointermove'));
  for(let index=0;index<5;index++){
    assert.equal(c.schemeState.schemes[index].targets[0].widthRatio,.2);
    assert.equal(c.schemeState.schemes[index].targets[1].widthRatio,.2);
    assert.deepEqual(c.schemeState.schemes[index].targets[2],before.schemes[index].targets[2]);
    for(let target=0;target<2;target++)for(const key of ['x','y','color','rotation'])assert.equal(c.schemeState.schemes[index].targets[target][key],before.schemes[index].targets[target][key]);
  }
  events.pointerup(event(210,162,'pointerup'));assert.equal(c.dragTarget,null);assert.equal(c.selectedTargetIds.size,3);
});

test('多选短按旋转箭头，同类统一逆时针旋转90度并同步所有版本',()=>{
  const {c,events,setClock}=workspace();
  events.pointerdown(event(380,100));assert.equal(c.dragMode,'rotate-pending');
  setClock(1100);events.pointerup(event(380,100,'pointerup'));
  for(const scheme of c.schemeState.schemes)assert.deepEqual(scheme.targets.map(t=>t.rotation),[-90,-90,0]);
  assert.equal(c.selectedTargetIds.size,3);assert.equal(c.dragBatchGroup,null);
});

test('混合多选时操作彩盒旋转箭头，只改变彩盒组，不改变产品组',()=>{
  const {c,events,setClock}=workspace();
  events.pointerdown(event(548,100));assert.equal(c.dragBatchGroup,'carton');
  setClock(1100);events.pointerup(event(548,100,'pointerup'));
  for(const scheme of c.schemeState.schemes)assert.deepEqual(scheme.targets.map(t=>t.rotation),[0,0,-90]);
  assert.equal(c.selectedTargetIds.size,3);
});

test('多选长按箭头后自由旋转，同类角度一起更新，抬起不追加90度',()=>{
  const {c,events,timers,setClock}=workspace();
  events.pointerdown(event(380,100));setClock(1400);timers[0]();
  events.pointermove(event(330,210,'pointermove'));events.pointerup(event(330,210,'pointerup'));
  for(const scheme of c.schemeState.schemes)assert.deepEqual(scheme.targets.map(t=>t.rotation),[135,135,0]);
});

test('多选拖动导致任一区域越界时整批保留原值，取消短按不触发旋转',()=>{
  const {c,events,statuses}=workspace(),before=structuredClone(c.schemeState);
  events.pointerdown(event(186,162));events.pointermove(event(450,162,'pointermove'));events.pointercancel(event(450,162,'pointercancel'));
  assert.deepEqual(c.schemeState,before);assert.equal(statuses.at(-1).type,'error');
  events.pointerdown(event(380,100));events.pointercancel(event(380,100,'pointercancel'));
  assert.deepEqual(c.schemeState,before);assert.equal(c.selectedTargetIds.size,3);
});

test('holding an off-center point on the rotation arrow does not jump when free rotation begins',()=>{
  const {c,events,timers,setClock}=workspace();
  events.pointerdown(event(385,105));setClock(1400);timers[0]();
  events.pointermove(event(385,105,'pointermove'));
  for(const scheme of c.schemeState.schemes)assert.deepEqual(scheme.targets.map(t=>t.rotation),[0,0,0]);
});

test('one held rotation gesture completes a full turn without progressively shrinking or moving its center',()=>{
  const {c,events,timers,setClock}=workspace(),template={zones:[{id:'body',zoneType:'logo',x:.1,y:.4,width:.8,height:.2}]};
  c.selectedTargetIds=new Set(['p2']);c.logoImage={naturalWidth:3,naturalHeight:1};
  const target=c.schemeState.schemes.find(s=>s.version===c.activeScheme).targets[1];Object.assign(target,{masterZoneId:'body',widthRatio:.2});
  c.keepTargetInsideCanvas=(value,previous)=>Object.assign(value,constrainLogoPlacement(value,previous,template,{width:600,height:300},{width:3,height:1}));
  events.pointerdown(event(380,100));setClock(1400);timers[0]();
  for(const [x,y,rotation] of [[380,200,90],[280,200,-180],[280,100,-90],[380,100,0]]){
    events.pointermove(event(x,y,'pointermove'));assert.equal(c.dragTarget.rotation,rotation);assert.equal(c.dragTarget.x,.55);assert.equal(c.dragTarget.y,.5);
  }
  assert.equal(c.dragTarget.widthRatio,.2);
});

test('group rotation near the image edge is fitted to its region rather than rejected before fitting',()=>{
  const {c,statuses}=workspace(),template={zones:[{id:'body',zoneType:'logo',x:.75,y:0,width:.25,height:1}]};
  c.multiProductViews.set('a',{foilTemplate:template});c.selectedTargetIds=new Set(['p1']);c.logoImage={naturalWidth:1,naturalHeight:3};
  for(const targets of [c.schemeState.sharedTargets,...c.schemeState.schemes.map(s=>s.targets)])Object.assign(targets[0],{masterZoneId:'body',x:.95,widthRatio:.08});
  c.applySelectedLogoPatch('product',{rotation:45});
  assert.equal(c.schemeState.schemes[0].targets[0].rotation,45);
  assert.equal(statuses.at(-1).type,'success');
});

test('clicking the rotation arrow chooses rotation when its hit area overlaps the scale handle',()=>{
  const {c,events}=workspace();c.selectedTargetIds=new Set(['p2']);
  c.handlePoints=()=>({center:{x:330,y:150},scale:{x:380,y:100},rotation:{x:390,y:100}});
  events.pointerdown(event(390,100));
  assert.equal(c.dragMode,'rotate-pending');
});

test('one free rotation gesture with many pointer moves creates only one undo step',()=>{
 const {c,events,timers,setClock}=workspace(),before=structuredClone(c.schemeState);
 events.pointerdown(event(380,100));setClock(1400);timers[0]();
 for(const [x,y] of [[390,110],[400,130],[360,200],[330,210]])events.pointermove(event(x,y,'pointermove'));
 assert.equal(c.placementHistory.canUndo(c.placementHistoryContext()),false);
 events.pointerup(event(330,210,'pointerup'));assert.equal(c.undoPlacementButton.disabled,false);
 c.undoPlacementButton.onclick();
 assert.deepEqual(c.schemeState,before);assert.equal(c.undoPlacementButton.disabled,true);
});

test('four canvas rotations allow exactly three undo clicks and block undo while generating',()=>{
 const {c,events,setClock}=workspace();
 for(let step=0;step<4;step++){setClock(1000+step*1000);events.pointerdown(event(380,100));setClock(1100+step*1000);events.pointerup(event(380,100,'pointerup'));}
 c.generationSubmitting=true;c.undoPlacementButton.onclick();
 assert.equal(c.schemeState.schemes[0].targets[0].rotation,0);
 c.generationSubmitting=false;
 for(const angle of [90,-180,-90]){c.undoPlacementButton.onclick();for(const scheme of c.schemeState.schemes)assert.deepEqual(scheme.targets.map(t=>t.rotation),[angle,angle,0]);}
 assert.equal(c.undoPlacementButton.disabled,true);c.undoPlacementButton.onclick();
 assert.equal(c.schemeState.schemes[0].targets[0].rotation,-90);
});

test('a click or cancelled rotation without a geometry change leaves undo disabled',()=>{
 const {c,events}=workspace();events.pointerdown(event(380,100));events.pointercancel(event(380,100,'pointercancel'));
 assert.equal(c.undoPlacementButton.disabled,true);
 c.loadedTaskLogoId='other';c.updatePlacementUndo();assert.equal(c.undoPlacementButton.disabled,true);
});
