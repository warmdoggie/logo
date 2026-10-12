import assert from 'node:assert/strict';
import {test} from 'node:test';
import {masterTargetsFromTemplate} from './product-master.mjs';

test('published logo zones become fixed S7 targets with master geometry',()=>{
  const targets=masterTargetsFromTemplate({
    version:3,
    zones:[
      {id:'zone-product',zoneType:'logo',name:'产品 Logo',x:.2,y:.3,width:.4,height:.2,defaultAnchorX:.4,defaultAnchorY:.4,maxLogoWidthRatio:.7,defaultRotation:18},
      {id:'zone-forbidden',zoneType:'no-logo',name:'原文字',x:.1,y:.1,width:.2,height:.1}
    ]
  });
  assert.deepEqual(targets,[{
    id:'master-zone-product',x:.4,y:.4,widthRatio:.4,rotation:18,curve:0,surface:'free',masterZoneId:'zone-product',masterLocked:true
  }]);
});

test('four-point master zones preserve their normalized perspective corners',()=>{
  const [target]=masterTargetsFromTemplate({zones:[{
    id:'zone-quad',zoneType:'logo',name:'斜面 Logo',shapeType:'POLYGON',x:.2,y:.2,width:.5,height:.3,
    pointsJson:JSON.stringify([{x:.25,y:.25},{x:.7,y:.2},{x:.65,y:.45},{x:.2,y:.5}]),defaultAnchorX:.45,defaultAnchorY:.35,
    maxLogoWidthRatio:.8,defaultRotation:0
  }]});
  assert.deepEqual(target.quad,[{x:.25,y:.25},{x:.7,y:.2},{x:.65,y:.45},{x:.2,y:.5}]);
});

test('vertical master orientation rotates the complete logo instead of stacking letters',()=>{
  const [target]=masterTargetsFromTemplate({zones:[{
    id:'vertical-zone',zoneType:'logo',x:.4,y:.1,width:.15,height:.6,defaultAnchorX:.475,defaultAnchorY:.4,
    maxLogoWidthRatio:.7,defaultRotation:0,orientation:'vertical'
  }]});
  assert.equal(target.rotation,90);
});
