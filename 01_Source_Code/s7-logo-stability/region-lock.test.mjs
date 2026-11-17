import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {constrainLogoPlacement,fitDefaultPlacements} from '../public/s7-placement.js';
import {createSchemes,editScheme,restoreSharedGeometry,schemeSignature} from './schemes.mjs';
import {canMoveTarget,setTargetMoveEnabled} from './target-state.mjs';
import {corners} from '../public/mockup-geometry.js';
import {containsPolygon,zonePoints} from '../public/zone-geometry.js';

const image={width:1000,height:500},logo={width:400,height:100};
const template={zones:[{id:'body',zoneType:'logo',x:.1,y:.2,width:.4,height:.6}]};
const initial={id:'logo',masterZoneId:'body',masterLocked:true,moveEnabled:true,x:.3,y:.5,widthRatio:.2,rotation:0};

test('normal movement stays in the product frame while an open region lock allows leaving it',()=>{
  const candidate={...initial,x:.8,y:.5};
  const locked=constrainLogoPlacement(candidate,initial,template,image,logo);
  assert.ok(Math.abs(locked.x-.4)<1e-7);
  const unlocked=constrainLogoPlacement({...candidate,regionUnlocked:true},initial,template,image,logo);
  assert.equal(unlocked.x,.8);assert.equal(unlocked.widthRatio,.2);
});

test('an open region lock retains the whole Logo inside the source image',()=>{
  const previous={...initial,regionUnlocked:true};
  const next=constrainLogoPlacement({...previous,x:.99,y:.99},previous,template,image,logo);
  assert.ok(Math.abs(next.x-.9)<1e-7);assert.ok(Math.abs(next.y-.95)<1e-7);
});

test('free movement also releases polygon product frames and their no-logo zones',()=>{
  const t={zones:[{...template.zones[0],shapeType:'POLYGON',points:[{x:.1,y:.2},{x:.5,y:.2},{x:.4,y:.8},{x:.1,y:.8}]},{zoneType:'no-logo',x:.65,y:.4,width:.3,height:.2}]};
  const candidate={...initial,x:.8,regionUnlocked:true,quad:[{x:.7,y:.45},{x:.9,y:.46},{x:.88,y:.55},{x:.72,y:.54}]};
  assert.deepEqual(constrainLogoPlacement(candidate,initial,t,image,logo),candidate);
});

test('closing the region lock returns an outside perspective Logo to its own product frame',()=>{
  const previous={...initial,x:.8,regionUnlocked:true,quad:[{x:.7,y:.45},{x:.9,y:.46},{x:.88,y:.55},{x:.72,y:.54}]};
  const next=constrainLogoPlacement({...previous,regionUnlocked:false},previous,template,image,logo);
  assert.ok(containsPolygon(zonePoints(template.zones[0],image),next.quad));
  assert.equal(next.regionUnlocked,false);
});

test('a shared unlocked placement survives switching schemes and restoring its saved state',()=>{
  const state=createSchemes([{...initial,moveEnabled:false}]);
  const edited=editScheme(state,'ORIGINAL',[{...initial,x:.8,regionUnlocked:true}]);
  const restored=fitDefaultPlacements(JSON.parse(JSON.stringify(edited)),template,image,logo);
  for(const target of [restored.sharedTargets[0],...restored.schemes.map(s=>s.targets[0])]){
    assert.equal(target.x,.8);assert.equal(target.regionUnlocked,true);
    assert.equal(canMoveTarget(target),true);
  }
});

test('changing only the frame lock does not mark an unchanged generated image as modified',()=>{
  const state=createSchemes([initial]);
  const edited=editScheme(state,'ORIGINAL',[{...initial,regionUnlocked:true}]);
  assert.equal(schemeSignature(edited.schemes[0]),schemeSignature(state.schemes[0]));
});

test('restoring a shared unlocked placement also restores its movement permission',()=>{
  let state=createSchemes([{...initial,moveEnabled:false,regionUnlocked:false}]);
  state=editScheme(state,'BLACK',[{...state.schemes[1].targets[0],x:.35}],false);
  state=editScheme(state,'ORIGINAL',[{...initial,regionUnlocked:true}],true);
  assert.equal(state.schemes[1].targets[0].moveEnabled,false);
  const restored=restoreSharedGeometry(state,'BLACK').schemes[1];
  assert.equal(restored.independentGeometry,false);
  assert.equal(restored.targets[0].regionUnlocked,true);
  assert.equal(canMoveTarget(restored.targets[0]),true);
});

test('the existing position button keeps manually added Logos movable within their product frame',()=>{
  const target={...initial,masterLocked:false,regionUnlocked:false};
  setTargetMoveEnabled(target,false);assert.equal(canMoveTarget(target),true);
  const moved=constrainLogoPlacement({...target,x:.8},target,template,image,logo);
  assert.ok(Math.abs(moved.x-.4)<1e-7);
  assert.ok(containsPolygon(zonePoints(template.zones[0],image),corners(moved,image,logo)));
});

const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
test('the region lock opens movement, recloses the frame, and only changes the selected Logo',()=>{
  const row={dataset:{targetId:'logo',regionUnlocked:'false',moveEnabled:'false'}},other={...initial,id:'other'},statuses=[];
  let current={...initial,moveEnabled:false};
  const c=vm.createContext({targets:{children:[row]},selectedTargetId:'logo',structuredClone,setTargetMoveEnabled,
    collectTargets:()=>[{...current,regionUnlocked:row.dataset.regionUnlocked==='true',moveEnabled:row.dataset.moveEnabled==='true'},other],
    keepTargetInsideCanvas:(target,previous)=>Object.assign(target,constrainLogoPlacement(target,previous,template,image,logo)),
    updateInputs:target=>{current={...target};},updateQuad(){},refreshTargetSelection(){},drawPreview(){},setStatus:message=>statuses.push(message)});
  const start=source.indexOf('function toggleTargetRegionLock(');
  assert.notEqual(start,-1,'the toolbar needs a region lock action');
  vm.runInContext(source.slice(start,source.indexOf("document.querySelector('#add-target').onclick",start)),c);
  c.toggleTargetRegionLock();
  assert.equal(row.dataset.regionUnlocked,'true');assert.equal(row.dataset.moveEnabled,'true');
  current={...current,x:.8};c.toggleTargetRegionLock();
  assert.equal(row.dataset.regionUnlocked,'false');assert.ok(Math.abs(current.x-.4)<1e-7);
  assert.equal(other.x,.3);assert.equal(other.regionUnlocked,undefined);assert.equal(statuses.length,2);
});
