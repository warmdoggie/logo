import {test} from 'node:test';import assert from 'node:assert/strict';
import {zonePoints,containsPolygon,polygonOverlap,polygonError} from './public/zone-geometry.js';
import {validatePlacement,placement,corners} from './public/mockup-geometry.js';
test('几何：非正方形图片旋转、凹口、交叉边、禁区接触和等比适配',()=>{
 const image={width:800,height:400},logo={width:100,height:30},base={zoneType:'logo',x:.25,y:.3,width:.5,height:.2,defaultAnchorX:.5,defaultAnchorY:.4,maxLogoWidthRatio:.3,maxLogoHeightRatio:.3,defaultRotation:20,allowRotation:true,orientation:'free'},rot={...base,shapeType:'ROTATED_RECT',rotation:20};
 const pts=zonePoints(rot,image);assert.ok(Math.abs(pts[0].x-(.5+(-200*Math.cos(Math.PI/9)+40*Math.sin(Math.PI/9))/800))<1e-10);
 assert.deepEqual(validatePlacement(placement(rot,image,logo),rot,[rot],image,logo),[]);assert.match(validatePlacement({x:.25,y:.3,widthRatio:.05,rotation:0},rot,[rot],image,logo).join(''),/超出/);
 const concave=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:.6,y:1},{x:.6,y:.3},{x:.4,y:.3},{x:.4,y:1},{x:0,y:1}],bridge=[{x:.2,y:.5},{x:.8,y:.5},{x:.8,y:.8},{x:.2,y:.8}];assert.equal(containsPolygon(concave,bridge),false,'all four corners inside but edge crosses notch');
 const notch=[{x:.45,y:.5},{x:.55,y:.5},{x:.55,y:.8},{x:.45,y:.8}];assert.equal(polygonOverlap(concave,notch),false);assert.equal(polygonOverlap(concave,bridge),true);
 const square=[{x:0,y:0},{x:.5,y:0},{x:.5,y:.5},{x:0,y:.5}],touch=square.map(p=>({...p,x:p.x+.5}));assert.equal(polygonOverlap(square,touch),false);assert.equal(polygonOverlap(square,square),true);assert.ok(polygonError([square[0],square[2],square[1],square[3]]));assert.ok(polygonError([square[0],square[1],square[1],square[3]]));
 const polygon={...base,shapeType:'POLYGON',pointsJson:JSON.stringify(concave),defaultAnchorX:.2,defaultAnchorY:.5,defaultRotation:0};for(const shape of [rot,polygon]){const p=placement(shape,image,{width:30,height:150});assert.ok(p.widthRatio>0);assert.equal(containsPolygon(zonePoints(shape,image),corners(p,image,{width:30,height:150})),true);}
});
