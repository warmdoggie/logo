import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createSchemes,editSelectedLogos} from './schemes.mjs';
import {isCarton} from './target-print.mjs';
import {pointerToNormalized,widthRatioFromScalePointer,rotationFromPointer} from './demo-geometry.mjs';
import {rotateTargetInPlace} from './target-state.mjs';
import {rotationGestureMode} from './rotation-handle.mjs';

const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
function workspace(){
  const events={},timers=[],statuses=[];let clock=1000;
  const c=vm.createContext({structuredClone,Set,editSelectedLogos,isCarton,pointerToNormalized,widthRatioFromScalePointer,rotationFromPointer,rotateTargetInPlace,rotationGestureMode,
    schemeState:createSchemes([{id:'p1',x:.25,y:.5,widthRatio:.12,rotation:0,carrierType:'BODY',color:'#112233'},{id:'p2',x:.55,y:.5,widthRatio:.12,rotation:0,carrierType:'BODY',color:'#112233'},{id:'box',x:.83,y:.5,widthRatio:.1,rotation:0,carrierType:'CARTON_FRONT',color:'#FF0000'}]),
    activeScheme:'CUSTOM',selectedTargetIds:new Set(['p1','p2','box']),selectedTargetId:'p2',dragTarget:null,dragMode:null,dragBatchGroup:null,rotateTimer:null,rotatePointerId:null,rotateStartedAt:0,ROTATE_LONG_PRESS_MS:350,
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
