import test from 'node:test';
import assert from 'node:assert/strict';
import {constrainLogoPlacement} from '../public/s7-placement.js';
import {corners} from '../public/mockup-geometry.js';
import {containsPolygon,zonePoints} from '../public/zone-geometry.js';
import {rotateTargetInPlace} from './target-state.mjs';

const image={width:1000,height:500},logo={width:400,height:100};
const template={zones:[{id:'body',zoneType:'logo',x:.1,y:.4,width:.8,height:.2}]};
const initial={id:'body-logo',masterZoneId:'body',x:.5,y:.5,widthRatio:.2,rotation:0};

test('repeated quarter-turns stay exact and never stop at an intermediate boundary angle',()=>{
  let target=structuredClone(initial);
  for(const expected of [-90,-180,90,0,-90,-180,90,0]){
    const requested=rotateTargetInPlace(structuredClone(target),-90);
    target=constrainLogoPlacement(requested,target,template,image,logo);
    assert.equal(target.rotation,expected);
    assert.equal(target.x,.5);assert.equal(target.y,.5);
    assert.ok(containsPolygon(zonePoints(template.zones[0],image),corners(target,image,logo)));
  }
});

test('free rotation retains every requested angle through both wrap boundaries and keeps its center',()=>{
  let previous=structuredClone(initial);
  for(const rotation of [-30,-60,-90,-120,-150,-179,179,150,120,90,60,30,0]){
    const requested={...initial,rotation};
    const next=constrainLogoPlacement(requested,previous,template,image,logo);
    assert.equal(next.rotation,rotation);
    assert.equal(next.x,initial.x);assert.equal(next.y,initial.y);
    assert.ok(containsPolygon(zonePoints(template.zones[0],image),corners(next,image,logo)));
    previous=next;
  }
  assert.equal(previous.widthRatio,initial.widthRatio,'returning to the starting angle restores the gesture starting width');
});

test('turning a perspective Logo on a nonsquare image rotates its pixel geometry without clipping corners',()=>{
  const target={...initial,quad:[{x:.4,y:.45},{x:.6,y:.45},{x:.6,y:.55},{x:.4,y:.55}]};
  const requested=rotateTargetInPlace(structuredClone(target),-90,2);
  assert.deepEqual(requested.quad,[{x:.475,y:.7},{x:.475,y:.3},{x:.525,y:.3},{x:.525,y:.7}]);
  const result=constrainLogoPlacement(requested,target,template,image,logo);
  assert.equal(result.rotation,-90);
  assert.ok(containsPolygon(zonePoints(template.zones[0],image),result.quad));
});
