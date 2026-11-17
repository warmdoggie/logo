import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {templateService} from './templates.mjs';
import {renderTemplate,leaveTemplate} from './public/template-editor.js';
import {zonePoints} from './public/zone-geometry.js';

async function editor(run,{readonly=false,shapeType='RECT',rotation=0,configure=()=>{}}={}){
 const names=['document','window','location','localStorage','Image','ResizeObserver','requestAnimationFrame','cancelAnimationFrame','confirm'],previous=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
 const elements=new Map(),drafts=new Map(),images=[],frames=new Map();let frameId=0,imageReady;const ready=new Promise(resolve=>imageReady=resolve);
 function element(){return {isConnected:true,dataset:{},classList:{toggle(){}},append(){},replaceChildren(){this.innerHTML='';},setAttribute(){},setPointerCapture(){},focus(){},scrollIntoView(){},getBoundingClientRect:()=>({left:0,top:0,width:1000,height:500}),listeners:[],addEventListener(type,fn,options){this.listeners.push({type,fn,capture:options===true});},querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);},querySelectorAll:()=>[]};}
 const main=element(),canvas=main.querySelector('#template-canvas'),layer=main.querySelector('#zone-layer');
 const zone={id:'zone',shapeType,rotation,zoneType:'logo',name:'产品区域 1',x:.3,y:.2,width:.2,height:.6,defaultAnchorX:.4,defaultAnchorY:.5,maxLogoWidthRatio:.7,maxLogoHeightRatio:.3,defaultRotation:0,allowRotation:false,orientation:'horizontal',isDefault:true,note:''};
 const automation={version:1,carriers:[{id:'body',type:'BODY',name:'产品'}],areas:[{id:'area',zoneRef:'zone',carrierId:'body',name:'区域',autoEligible:false,foilProcesses:['GOLD FOIL'],presets:[{id:'preset',name:'位置',orientation:'custom',isDefault:true,box:{centerX:.4,centerY:.5,width:.08,height:.2,rotation}}]}],schemes:[{id:'scheme',name:'方案',role:'DEFAULT',targets:[{areaId:'area',presetId:'preset'}]}]};
 const payload={currentVersion:1,product:{sku:'TEST',name:'test',standardImage:'test.png'},template:{version:1,standardImage:'test.png',zones:[zone],automation}};
 configure(payload);
 Object.assign(globalThis,{document:{createElement:element,createElementNS:element},window:{addEventListener(){},removeEventListener(){}},location:{hash:'#/templates/test'},localStorage:{getItem:k=>drafts.get(k),setItem:(k,v)=>drafts.set(k,v)},Image:class{constructor(){images.push(this);}set src(value){imageReady();}},ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id),confirm:()=>true});
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response(new Blob(['image']),{headers:{'X-Image-Width':'1000','X-Image-Height':'500'}});
 function dispatch(el,type,event){let stopped=false;const e={type,button:0,pointerId:1,preventDefault(){},stopImmediatePropagation(){stopped=true;},...event};for(const l of [...el.listeners].sort((a,b)=>Number(b.capture)-Number(a.capture)))if(l.type===type&&!stopped)l.fn(e);}
 const target=(id='zone',handle)=>({dataset:{handle},closest:()=>id?{dataset:{zone:id}}:null});
 const pointer=(type,x,y,handle,id='zone',options={})=>{dispatch(canvas,type,{clientX:x,clientY:y,target:target(id,handle),...options});for(const [id,fn]of frames){frames.delete(id);fn();}};
 const key=(key,options={})=>dispatch(main,'keydown',{key,ctrlKey:true,target:canvas,...options});
 const saved=()=>JSON.parse(drafts.get('template-editor-draft:test:1'));
 try{
  await renderTemplate(main,'test',{api:async()=>payload,esc:String,toast(){},isCurrent:()=>true,readOnly:readonly});
  await ready;images[0].onload();
  await run({pointer,key,saved,html:()=>layer.innerHTML,main,canvas,drafts});
 }finally{leaveTemplate();globalThis.fetch=originalFetch;for(const [name,value]of previous)if(value===undefined)delete globalThis[name];else Object.defineProperty(globalThis,name,value);}
}

for(const shapeType of ['RECT',undefined,'ROTATED_RECT'])test('region rotation is available for '+(shapeType||'legacy rectangles')+' and persists with its placements',()=>editor(({pointer,saved,html})=>{
 assert.match(html(),/data-handle="rotate"/);
 pointer('pointerdown',400,72,'rotate');pointer('pointermove',578,250);pointer('pointerup',578,250);
 const draft=saved(),z=draft.zones[0],box=draft.automation.areas[0].presets[0].box;
 assert.equal(z.shapeType,'ROTATED_RECT');assert.equal(z.rotation,90);
 assert.equal(z.x,.3);assert.equal(z.y,.2);assert.equal(box.rotation,90);
 assert.equal(box.centerX,.4);assert.equal(box.centerY,.5);
},{shapeType,configure:p=>{if(shapeType===undefined)delete p.template.zones[0].shapeType;}}));

test('copy and repeated paste retain rotation, carrier and settings with independent IDs',()=>editor(({pointer,key,saved})=>{
 pointer('pointerdown',400,250);pointer('pointerup',400,250);key('c');
 key('v');const first=structuredClone(saved());key('v');const draft=saved();
 assert.equal(draft.zones.length,3);const [original,a,b]=draft.zones;
 assert.equal(a.rotation,30);assert.equal(b.rotation,30);assert.equal(a.width,.2);assert.equal(a.height,.6);
 for(const copy of [a,b])for(const k of ['x','y','width','height','rotation','defaultAnchorX','defaultAnchorY'])assert.equal(copy[k],original[k],k);
 assert.equal(a.isDefault,false);
 assert.equal(new Set(draft.zones.map(z=>z.id)).size,3);
 assert.equal(new Set(draft.automation.areas.map(a=>a.id)).size,3);
 assert.equal(new Set(draft.automation.areas.flatMap(a=>a.presets.map(p=>p.id))).size,3);
 assert.deepEqual(draft.automation.areas[1].foilProcesses,['GOLD FOIL']);
 assert.equal(draft.automation.carriers.find(c=>c.id===draft.automation.areas[1].carrierId).type,'CARTON');
 assert.equal(draft.automation.areas[1].presets[0].box.rotation,30);
 assert.deepEqual(draft.automation.areas[1].presets[0].box,draft.automation.areas[0].presets[0].box);
 assert.ok(Math.abs(draft.automation.areas[1].presets[0].box.centerX-a.x-a.width/2)<1e-10);
 assert.deepEqual(draft.automation.schemes,first.automation.schemes);
 pointer('pointerdown',(b.x+.1)*1000,(b.y+.3)*500,undefined,b.id);pointer('pointermove',(b.x+.12)*1000,(b.y+.3)*500,undefined,b.id);pointer('pointerup',0,0);
 assert.deepEqual(saved().zones[0],original);assert.deepEqual(saved().automation.areas[0],draft.automation.areas[0]);
},{shapeType:'ROTATED_RECT',rotation:30,configure:p=>{p.template.automation.carriers[0].type='CARTON';}}));

for(const shapeType of ['RECT','ROTATED_RECT','POLYGON'])for(const [axis,first,last,want]of [
 ['horizontal',[450,255],[460,330],{x:.36,y:.2}],
 ['vertical',[405,300],[490,320],{x:.3,y:.34}],
 ['horizontal in display pixels',[430,270],[440,310],{x:.34,y:.2}],
 ['vertical after initial pointer jitter',[402,251],[401,275],{x:.3,y:.25}]
])test('Ctrl drag locks '+shapeType+' to '+axis+' without axis switching',()=>editor(({pointer,saved})=>{
 pointer('pointerdown',400,250,undefined,'zone',{ctrlKey:true});
 pointer('pointermove',...first,undefined,'zone',{ctrlKey:true});
 pointer('pointermove',...last,undefined,'zone',{ctrlKey:true});
 pointer('pointerup',...last);
 const draft=saved(),z=draft.zones[0],box=draft.automation.areas[0].presets[0].box;
 assert.ok(Math.abs(z.x-want.x)<1e-10);assert.ok(Math.abs(z.y-want.y)<1e-10);
 assert.ok(Math.abs(box.centerX-want.x-.1)<1e-10);assert.ok(Math.abs(box.centerY-want.y-.3)<1e-10);
 assert.equal(z.width,.2);assert.equal(z.height,.6);assert.equal(z.rotation,shapeType==='ROTATED_RECT'?30:0);
 if(shapeType==='POLYGON'){
  assert.ok(Math.abs(z.points[0].x-want.x)<1e-10);assert.ok(Math.abs(z.points[0].y-want.y)<1e-10);
 }
},{shapeType,rotation:shapeType==='ROTATED_RECT'?30:0,configure:p=>{
 if(shapeType==='POLYGON')p.template.zones[0].points=[{x:.3,y:.2},{x:.5,y:.2},{x:.5,y:.8},{x:.3,y:.8}];
}}));

test('Ctrl dragging the pasted region moves only that copy horizontally',()=>editor(({pointer,key,saved})=>{
 key('c');key('v');const before=structuredClone(saved()),copy=before.zones[1];
 pointer('pointerdown',400,250,undefined,copy.id,{ctrlKey:true});
 pointer('pointermove',500,270,undefined,copy.id,{ctrlKey:true});pointer('pointerup',500,270,undefined,copy.id);
 const draft=saved();assert.ok(Math.abs(draft.zones[1].x-.4)<1e-10);assert.equal(draft.zones[1].y,.2);
 assert.deepEqual(draft.zones[0],before.zones[0]);assert.deepEqual(draft.automation.areas[0],before.automation.areas[0]);
 assert.equal(draft.automation.areas[1].presets[0].box.centerX,.5);assert.equal(draft.automation.areas[1].presets[0].box.centerY,.5);
}));

test('releasing Ctrl restores free dragging and each new gesture chooses its own axis',()=>editor(({pointer,saved})=>{
 pointer('pointerdown',400,250);pointer('pointermove',450,255,undefined,'zone',{ctrlKey:true});
 pointer('pointermove',460,280);pointer('pointerup',460,280);
 assert.ok(Math.abs(saved().zones[0].x-.36)<1e-10);assert.ok(Math.abs(saved().zones[0].y-.26)<1e-10);
 pointer('pointerdown',460,280,undefined,'zone',{ctrlKey:true});
 pointer('pointermove',465,300,undefined,'zone',{ctrlKey:true});pointer('pointerup',465,300);
 assert.ok(Math.abs(saved().zones[0].x-.36)<1e-10);assert.ok(Math.abs(saved().zones[0].y-.3)<1e-10);
}));

test('unmodified dragging remains free and Ctrl movement clamps at the image edge',()=>editor(({pointer,saved})=>{
 pointer('pointerdown',400,250);pointer('pointermove',450,275);pointer('pointerup',450,275);
 assert.ok(Math.abs(saved().zones[0].x-.35)<1e-10);assert.ok(Math.abs(saved().zones[0].y-.25)<1e-10);
 pointer('pointerdown',450,275,undefined,'zone',{ctrlKey:true});
 pointer('pointermove',1000,280,undefined,'zone',{ctrlKey:true});pointer('pointerup',1000,280);
 assert.ok(Math.abs(saved().zones[0].x-.8)<1e-10);assert.ok(Math.abs(saved().zones[0].y-.25)<1e-10);
}));

test('paste uses the copied snapshot even after the source is deleted',()=>editor(({pointer,key,saved})=>{
 pointer('pointerdown',400,250);pointer('pointerup',400,250);key('c');key('Backspace',{ctrlKey:false});key('v');
 assert.equal(saved().zones.length,1);assert.equal(saved().automation.areas.length,1);
 assert.equal(saved().zones[0].isDefault,true);assert.notEqual(saved().zones[0].id,'zone');
 assert.deepEqual(saved().automation.areas[0].foilProcesses,['GOLD FOIL']);
}));

test('paste keeps rotated corners within the image near its edges',()=>editor(({pointer,key,saved})=>{
 pointer('pointerdown',835,250);pointer('pointerup',835,250);key('c');key('v');
 assert.equal(saved().zones.length,2);for(const p of zonePoints(saved().zones[1],{width:1000,height:500}))assert.ok(p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1);
 assert.equal(saved().zones[1].x,.735);assert.equal(saved().zones[1].y,.2);
},{shapeType:'ROTATED_RECT',rotation:30,configure:p=>{p.template.zones[0].x=.735;p.template.zones[0].defaultAnchorX=.835;p.template.automation.areas[0].presets[0].box.centerX=.835;}}));

test('rotation cancellation restores both the region and its placement',()=>editor(({pointer,key,saved})=>{
 pointer('pointerdown',400,72,'rotate');pointer('pointermove',578,250);pointer('pointercancel',578,250);key('c');key('v');
 assert.equal(saved().zones[0].shapeType,'RECT');assert.equal(saved().zones[0].rotation,0);assert.equal(saved().automation.areas[0].presets[0].box.rotation,0);
}));

test('shortcuts ignore controls, repeated keys, unfinished gestures and read-only views',async()=>{
 for(const readonly of [false,true])await editor(({pointer,key,drafts,html})=>{
  if(readonly)assert.doesNotMatch(html(),/data-handle="rotate"/);
  key('v');key('c',{target:{tagName:'INPUT'}});key('v');
  key('c');key('v',{target:{tagName:'TEXTAREA'}});key('v',{repeat:true});key('v',{isComposing:true});
  pointer('pointerdown',400,250);key('v');pointer('pointercancel',400,250);
  if(readonly)key('v');assert.equal(drafts.size,0);
 },{readonly});
});

test('rotated and pasted regions survive publishing and reading from the template store',()=>editor(async({pointer,key,saved})=>{
 pointer('pointerdown',400,72,'rotate');pointer('pointermove',578,250);pointer('pointerup',578,250);key('c');key('v');
 const draft=saved(),db=new DatabaseSync(':memory:');
 try{
  db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  db.exec("ALTER TABLE TemplateZone ADD COLUMN shapeType TEXT DEFAULT 'RECT'; ALTER TABLE TemplateZone ADD COLUMN rotation REAL DEFAULT 0; ALTER TABLE TemplateZone ADD COLUMN pointsJson TEXT; INSERT INTO Product VALUES ('test','TEST','test','脸部','test.png','','','');");
  const png=await sharp({create:{width:1000,height:500,channels:3,background:'#fff'}}).png().toBuffer(),service=templateService(db,{get:()=>png});
  await service.publish('test',{zones:draft.zones,automation:draft.automation,baseVersion:0,changeNote:'旋转与复制验证'});
  const result=service.get('test').template;
  assert.equal(result.zones.length,2);assert.ok(result.zones.every(z=>z.shapeType==='ROTATED_RECT'&&z.rotation===90));
  assert.equal(result.automation.areas.length,2);assert.ok(result.automation.areas.every(a=>a.presets[0].box.rotation===90));
  assert.deepEqual(result.automation.areas[1].foilProcesses,['GOLD FOIL']);
  assert.equal(result.automation.schemes[0].targets.length,1);
 }finally{db.close();}
},{configure:p=>{p.template.automation.areas[0].autoEligible=true;}}));
