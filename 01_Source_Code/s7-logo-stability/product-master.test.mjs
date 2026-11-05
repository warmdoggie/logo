import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as master from './product-master.mjs';
import {masterTargetsFromTemplate} from './product-master.mjs';
import {createSchemes,ensureMixedSchemes} from './schemes.mjs';

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

test('explicit master carrier classification wins over the area name',()=>{
  const targets=masterTargetsFromTemplate({
    zones:[
      {id:'body',zoneType:'logo',name:'彩盒旁的产品 Logo',x:.1,y:.2,width:.2,height:.3},
      {id:'box',zoneType:'logo',name:'正面区域',x:.6,y:.2,width:.2,height:.3}
    ],
    automation:{
      carriers:[{id:'product',type:'BODY'},{id:'carton',type:'CARTON'}],
      areas:[{zoneIndex:0,carrierId:'product'},{zoneIndex:1,carrierId:'carton'}]
    }
  });
  assert.equal(targets[0].carrierType,undefined);
  assert.equal(targets[1].carrierType,'CARTON_FRONT');
  assert.equal(targets[1].preserveOriginalColor,true);
});

test('the default placement direction is honored when loading a master into S7',()=>{
 const template={zones:[{id:'zone',zoneType:'logo',x:.4,y:.1,width:.15,height:.6,orientation:'horizontal',defaultRotation:0}],automation:{areas:[{zoneIndex:0,presets:[{isDefault:false,orientation:'horizontal'},{isDefault:true,orientation:'vertical',box:{rotation:0}}]}]}};
 assert.equal(masterTargetsFromTemplate(template)[0].rotation,90);
 template.automation.areas[0].presets[1].orientation='horizontal';
 template.zones[0].orientation='vertical';
 assert.equal(masterTargetsFromTemplate(template)[0].rotation,0);
});

test('母版重新发布更换区域编号时，旧草稿按载体对应新区域并保留独立摆放与工艺',()=>{
 const old=[{id:'old-box',masterZoneId:'box-v1',carrierType:'CARTON_FRONT',x:.7,y:.3,widthRatio:.1},{id:'old-product',masterZoneId:'product-v1',x:.2,y:.6,widthRatio:.2}],state=ensureMixedSchemes(createSchemes(old),['MIX_GOLD_ORIGINAL']);state.schemes.at(-1).targets[1].x=.25;
 const template={zones:[{id:'product-v2',zoneType:'logo',x:.1,y:.1,width:.2,height:.2},{id:'box-v2',zoneType:'logo',name:'彩盒',x:.6,y:.1,width:.2,height:.2}]};
 const updated=master.rebindMasterZones(state,template);assert.equal(updated?.sharedTargets[0].masterZoneId,'box-v2');assert.equal(updated.sharedTargets[1].masterZoneId,'product-v2');
 assert.equal(updated.schemes.at(-1).targets[1].x,.25);assert.equal(updated.schemes.at(-1).targets[1].printFinish,'GOLD FOIL');assert.equal(updated.schemes.at(-1).targets[1].id,'old-product');assert.equal(state.sharedTargets[0].masterZoneId,'box-v1');
 assert.equal(master.rebindMasterZones(updated,template),updated);
});
test('区域数量或载体变更不能自动套用旧草稿，不能把彩盒权限当成产品权限',()=>{
 const state=createSchemes([{id:'p',masterZoneId:'p-v1',x:.3,y:.5,widthRatio:.1}]);
 assert.throws(()=>master.rebindMasterZones(state,{zones:[{id:'p1',zoneType:'logo',x:.1,y:.2,width:.2,height:.2},{id:'p2',zoneType:'logo',x:.4,y:.2,width:.2,height:.2}]}),/母版区域/);
 assert.throws(()=>master.rebindMasterZones(state,{zones:[{id:'box',zoneType:'logo',name:'彩盒',x:.1,y:.2,width:.2,height:.2}]}),/母版区域/);
 const ambiguous=createSchemes([{id:'a',masterZoneId:'old-a',x:.2,y:.5,widthRatio:.1},{id:'b',masterZoneId:'old-b',x:.7,y:.5,widthRatio:.1}]);assert.throws(()=>master.rebindMasterZones(ambiguous,{zones:[{id:'new-a',zoneType:'logo',x:.1,y:.2,width:.2,height:.2},{id:'new-b',zoneType:'logo',x:.4,y:.2,width:.2,height:.2}]}),/母版区域/);
});
