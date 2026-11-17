import test from 'node:test';
import assert from 'node:assert/strict';
import {fitDefaultPlacements,constrainLogoPlacement} from '../public/s7-placement.js';
import {createSchemes} from './schemes.mjs';
import {masterTargetsFromTemplate} from './product-master.mjs';
import {corners} from '../public/mockup-geometry.js';
import {containsPolygon,zonePoints} from '../public/zone-geometry.js';
import {visibleLogoBounds} from './logo-image-transfer.mjs';
import sharp from 'sharp';
import {renderLogoSet} from './index.mjs';

const image={width:1000,height:500};
const template={zones:[{id:'body',zoneType:'logo',x:.1,y:.1,width:.4,height:.8,defaultAnchorX:.3,defaultAnchorY:.5,maxLogoWidthRatio:.1,maxLogoHeightRatio:.1}],automation:{areas:[{zoneId:'body',presets:[{isDefault:true,orientation:'horizontal',box:{centerX:.3,centerY:.5,width:.2,height:.2,rotation:0}}]}]}};

for(const [logo,width] of [[{width:400,height:100},.2],[{width:100,height:400},.025],[{width:200,height:100},.2]])test(`default placement fits ${logo.width}x${logo.height} into the green frame without stretching`,()=>{
  const state=createSchemes(masterTargetsFromTemplate(template));
  const next=fitDefaultPlacements(state,template,image,logo);
  for(const scheme of next.schemes){const target=scheme.targets[0];assert.ok(Math.abs(target.widthRatio-width)<1e-9);assert.equal(target.x,.3);assert.equal(target.y,.5);assert.equal(target.quad,undefined);}
  assert.equal(state.sharedTargets[0].widthRatio,.4,'the original draft must not be mutated');
});

test('rotated green frames and vertical Logos use pixel dimensions on nonsquare product images',()=>{
  const rotated=structuredClone(template);rotated.automation.areas[0].presets[0].box.rotation=90;rotated.automation.areas[0].presets[0].orientation='vertical';
  const next=fitDefaultPlacements(createSchemes(masterTargetsFromTemplate(rotated)),rotated,image,{width:400,height:100});
  assert.ok(Math.abs(next.sharedTargets[0].widthRatio-.2)<1e-9);assert.equal(next.sharedTargets[0].rotation,90);
});

test('processing a Logo refits its default frame when its aspect changes and retains manually moved layouts',()=>{
  const state=fitDefaultPlacements(createSchemes(masterTargetsFromTemplate(template)),template,image,{width:400,height:100});
  state.schemes[1].targets[0].x=.2;
  const next=fitDefaultPlacements(state,template,image,{width:100,height:400});
  assert.ok(Math.abs(next.schemes[0].targets[0].widthRatio-.025)<1e-9);
  assert.equal(next.schemes[1].targets[0].x,.2);
});

test('dragging a Logo stops its whole rectangle at its product boundary, not at the image boundary',()=>{
  const logo={width:400,height:100},previous={id:'a',masterZoneId:'body',x:.3,y:.5,widthRatio:.2,rotation:0};
  const next=constrainLogoPlacement({...previous,x:.95,y:.95},previous,template,image,logo);
  assert.ok(containsPolygon(zonePoints(template.zones[0],image),corners(next,image,logo)));
  assert.ok(Math.abs(next.x-.4)<1e-7);assert.equal(next.widthRatio,.2);
  assert.deepEqual(previous,{id:'a',masterZoneId:'body',x:.3,y:.5,widthRatio:.2,rotation:0});
});

test('carton Logos stay within their own carton region, including rotated and perspective corners',()=>{
  const t=structuredClone(template);t.zones.push({id:'box',zoneType:'logo',name:'彩盒',x:.6,y:.1,width:.3,height:.8});
  const logo={width:200,height:100};
  for(const previous of [
    {id:'box-logo',masterZoneId:'box',carrierType:'CARTON_FRONT',x:.75,y:.5,widthRatio:.1,rotation:35},
    {id:'quad',masterZoneId:'box',carrierType:'CARTON_FRONT',x:.75,y:.5,widthRatio:.1,rotation:0,quad:[{x:.7,y:.4},{x:.8,y:.42},{x:.79,y:.6},{x:.71,y:.58}]}
  ]){
    const candidate={...previous,x:.2,...(previous.quad?{quad:previous.quad.map(p=>({...p,x:p.x-.55}))}:{})};
    const next=constrainLogoPlacement(candidate,previous,t,image,logo);
    assert.ok(containsPolygon(zonePoints(t.zones[1],image),next.quad||corners(next,image,logo)));
    assert.ok(next.x>.6);
  }
});

test('polygon regions use their actual outline rather than their enclosing rectangle',()=>{
  const t=structuredClone(template);Object.assign(t.zones[0],{shapeType:'POLYGON',points:[{x:.1,y:.1},{x:.5,y:.1},{x:.35,y:.9},{x:.1,y:.9}]});
  const logo={width:400,height:100},previous={masterZoneId:'body',x:.25,y:.5,widthRatio:.1,rotation:0};
  const next=constrainLogoPlacement({...previous,x:.46},previous,t,image,logo);
  assert.ok(containsPolygon(zonePoints(t.zones[0],image),corners(next,image,logo)));
  assert.ok(next.x<.4);
});

test('a tall transparent padded Logo fits the same region in the preview and the final render',async()=>{
  const source=await sharp({create:{width:10,height:100,channels:4,background:'#123456'}}).extend({top:3,bottom:3,left:3,right:3,background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
  const decoded=await sharp(source).raw().toBuffer({resolveWithObject:true}),bounds=visibleLogoBounds(decoded.data,decoded.info.width,decoded.info.height);
  assert.deepEqual(bounds,{left:3,top:3,width:10,height:100});
  const t=structuredClone(template);Object.assign(t.zones[0],{x:.1,y:.4,width:.4,height:.2});
  const next=fitDefaultPlacements(createSchemes(masterTargetsFromTemplate(t)),t,image,bounds);
  const base=await sharp({create:{...image,channels:4,background:'#eeeeee'}}).png().toBuffer();
  const result=await renderLogoSet({baseImage:base,logoImage:source,targets:next.sharedTargets});
  for(const output of result.outputs)for(const bounds of output.bounds){assert.ok(bounds.top>=200);assert.ok(bounds.top+bounds.height<=300);}
});
