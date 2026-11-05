import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as geometry from './public/zone-geometry.js';

test('canvas selection cycles through overlapping zones and clears outside them',()=>{
 const zones=[
  {id:'body',x:.2,y:.2,width:.3,height:.3},
  {id:'carton',x:.1,y:.1,width:.6,height:.6}
 ];
 const image={width:1000,height:700},p={x:.3,y:.3};
 assert.equal(geometry.pickZone(zones,p,image,null,false),'carton');
 assert.equal(geometry.pickZone(zones,p,image,'carton',true),'body');
 assert.equal(geometry.pickZone(zones,p,image,'body',true),'carton');
 assert.equal(geometry.pickZone(zones,{x:.8,y:.8},image,'body',true),null);
 assert.equal(geometry.pickZone(zones,{x:.6,y:.6},image,'body',true),'carton');
});
