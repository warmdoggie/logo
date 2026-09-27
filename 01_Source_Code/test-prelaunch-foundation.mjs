import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {automationStore} from './template-automation.mjs';import {autoPlace} from './public/auto-placement.js';import {corners} from './public/mockup-geometry.js';import {containsPolygon,zonePoints} from './public/zone-geometry.js';
const image={width:1600,height:1000},zone={id:'zone',shapeType:'RECT',zoneType:'logo',x:.1,y:.1,width:.6,height:.7,maxLogoWidthRatio:.6,maxLogoHeightRatio:.7};
const definition=()=>({carriers:[{id:'body',type:'BODY',name:'产品本体'}],areas:[{id:'area',carrierId:'body',name:'瓶身',zoneIndex:0,autoEligible:true,presets:[{id:'preset',name:'横排',orientation:'horizontal',isDefault:true,box:{centerX:.4,centerY:.45,width:.3,height:.2,rotation:0}}]}],schemes:[{id:'scheme',name:'方案 A',role:'DEFAULT',targets:[{areaId:'area',presetId:'preset'}]}]});
test('安全默认值、语义关联、方案数量和几何拦截',()=>{const db=new DatabaseSync(':memory:'),store=automationStore(db);try{
 assert.equal(store.normalize(null,[zone],image),null);const d=store.normalize(definition(),[zone],image);assert.equal(d.areas[0].id,'area');
 let v=definition();v.areas[0].box={};v.areas[0].presets[0].box.centerX=.9;assert.throws(()=>store.normalize(v,[zone],image),/允许区域/);
 v=definition();v.schemes[0].targets.push({...v.schemes[0].targets[0]});assert.throws(()=>store.normalize(v,[zone],image),/重复/);
 v=definition();v.schemes=Array.from({length:4},(_,n)=>({...v.schemes[0],id:'scheme'+n,role:n?'ALTERNATIVE':'DEFAULT'}));assert.throws(()=>store.normalize(v,[zone],image),/3个方案/);
 v=definition();v.areas[0].autoEligible=false;assert.throws(()=>store.normalize(v,[zone],image),/可自动使用/);
 const forbidden={...zone,id:'no',zoneType:'no-logo',x:.35,y:.4,width:.05,height:.05};assert.throws(()=>store.normalize(definition(),[zone,forbidden],image),/禁止区域/);
 assert.throws(()=>store.normalize({...definition(),carriers:[]},[zone],image),/载体不存在/);
}finally{db.close();}});
test('默认框 contain 等比适配，方向变化重算，宽高比不变',()=>{
 const logo={width:400,height:100},preset=definition().areas[0].presets[0];const a=autoPlace(zone,preset,[zone],image,logo);
 assert.ok(Math.abs(a.widthRatio-.3)<1e-8);assert.equal(a.rotation,0);assert.ok(containsPolygon(zonePoints(zone,image),corners(a,image,logo)));
 const vertical={...preset,orientation:'vertical'};const b=autoPlace(zone,vertical,[zone],image,logo);assert.equal(b.rotation,90);assert.ok(b.widthRatio<a.widthRatio);assert.ok(containsPolygon(zonePoints(zone,image),corners(b,image,logo)));
 assert.throws(()=>autoPlace(zone,preset,[zone,{...zone,zoneType:'no-logo'}],image,logo),/Designer Required/);
});
