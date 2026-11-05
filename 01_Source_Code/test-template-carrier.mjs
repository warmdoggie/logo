import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mountTemplateAutomation} from './public/template-automation-ui.js';
import {automationStore} from './template-automation.mjs';

test('new master areas retain explicit carrier types and valid placement frames when serialized',()=>{
 const previous=globalThis.document;
 const element=()=>({append(){},setAttribute(){}});
 globalThis.document={createElement:element,createElementNS:element};
 const db=new DatabaseSync(':memory:');
 try{
  const zones=[
   {id:'body-zone',zoneType:'logo',name:'Logo 区域',x:.1,y:.1,width:.2,height:.5,defaultAnchorX:.2,defaultAnchorY:.35},
   {id:'box-zone',zoneType:'logo',name:'正面',shapeType:'POLYGON',x:.5,y:.1,width:.4,height:.6,defaultAnchorX:.5,defaultAnchorY:.1,points:[{x:.5,y:.1},{x:.9,y:.1},{x:.9,y:.2},{x:.6,y:.2},{x:.6,y:.7},{x:.5,y:.7}]},
   {id:'narrow-zone',zoneType:'logo',name:'U形彩盒',shapeType:'POLYGON',x:.1,y:.1,width:.8,height:.8,defaultAnchorX:.1,defaultAnchorY:.1,points:[{x:.1,y:.1},{x:.12,y:.1},{x:.12,y:.88},{x:.88,y:.88},{x:.88,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}]}
  ];
  const image={width:1000,height:700};
  const ui=mountTemplateAutomation({main:{querySelector:element,addEventListener(){}},canvas:{append(){},addEventListener(){}},zones:()=>zones,selected:()=>null,image:()=>image});
  ui.classifyZone(zones[0],'BODY');
  ui.classifyZone(zones[1],'CARTON');
  assert.doesNotThrow(()=>ui.classifyZone(zones[2],'CARTON'));
  const config=ui.serialize();
  assert.deepEqual(config.areas.map(a=>config.carriers.find(c=>c.id===a.carrierId).type),['BODY','CARTON','CARTON']);
  assert.deepEqual(config.areas.map(a=>a.zoneIndex),[0,1,2]);
  const store=automationStore(db);
  assert.doesNotThrow(()=>store.normalize(config,zones,image));
  const areaId=config.areas[0].id,presetId=config.areas[0].presets[0].id;
  ui.classifyZone(zones[0],'CARTON');
  const updated=ui.serialize();
  assert.equal(updated.areas.length,3);
  assert.equal(updated.areas[0].id,areaId);
  assert.equal(updated.areas[0].presets[0].id,presetId);
  assert.equal(updated.carriers.find(c=>c.id===updated.areas[0].carrierId).type,'CARTON');
 }finally{db.close();globalThis.document=previous;}
});
