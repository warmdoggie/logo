import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {editorHistory} from './public/editor-history.js';
import {axisAngle,axisEndpoints,carrierRemovalReason} from './public/template-edit-helpers.js';
import {containsPolygon,zonePoints} from './public/zone-geometry.js';
import {autoPlace} from './public/auto-placement.js';
import {testLogin} from './fixture-login.mjs';

test('母版整份撤销：区域、方向、蒙版、方案一起恢复，重做分支和快照隔离',()=>{
 const initial={zones:[{x:.1}],automation:{presets:[{axisRotation:0}],schemes:[{targets:['A']}],surface:{drawing:'INCLUDE',points:[]}}};
 const h=editorHistory(initial),next=structuredClone(initial);next.zones[0].x=.3;next.automation.presets[0].axisRotation=45;next.automation.schemes[0].targets.push('B');next.automation.surface.points.push({x:.2,y:.3});h.push(next);
 next.zones[0].x=.9;assert.deepEqual(h.undo(),initial);const redo=h.redo();assert.equal(redo.zones[0].x,.3);assert.equal(redo.automation.presets[0].axisRotation,45);assert.equal(redo.automation.surface.points.length,1);
 redo.automation.schemes[0].targets=[];h.undo();assert.equal(h.redo().automation.schemes[0].targets.length,2);
 h.undo();h.push({...initial,changeNote:'另一分支'});assert.equal(h.canRedo,false);h.reset(initial);assert.equal(h.canUndo,false);
});
test('独立长轴在非方图中保持真实角度，端点在默认框内，自动摆放继承设计师角度',()=>{
 const image={width:1600,height:900},zone={zoneType:'logo',shapeType:'RECT',x:0,y:0,width:1,height:1,maxLogoWidthRatio:1,maxLogoHeightRatio:1};
 for(const angle of [-180,-135,-90,-45,0,28,45,90,135,180]){
  const preset={orientation:'long-axis',axisRotation:angle,box:{centerX:.5,centerY:.5,width:.25,height:.32,rotation:35}},before=JSON.stringify(preset.box);
  const [a,b]=axisEndpoints(preset,image),actual=Math.atan2((b.y-a.y)*image.height,(b.x-a.x)*image.width)*180/Math.PI;
  assert.ok(Math.abs(Math.sin((actual-angle)*Math.PI/180))<1e-10);
  const box=zonePoints({shapeType:'ROTATED_RECT',x:.375,y:.34,width:.25,height:.32,rotation:35},image);
  assert.ok(containsPolygon(box,[a,b]));assert.equal(autoPlace(zone,preset,[zone],image,{width:200,height:60}).rotation,axisAngle(preset,image));assert.equal(JSON.stringify(preset.box),before);
 }
 const config={areas:[{carrierId:'body',name:'瓶身正面'}]};assert.match(carrierRemovalReason(config,'body'),/瓶身正面/);assert.equal(carrierRemovalReason(config,'unused'),null);
});
test('母版角色权限：业务直接发布被拒绝，设计师/管理员可发布，历史与重启保真',async()=>{
 const data=mkdtempSync(join(tmpdir(),'editor-permission-'));let child,base;
 const start=async()=>{child=spawn(process.execPath,[fileURLToPath(new URL('./server.mjs',import.meta.url))],{env:{...process.env,PORT:'0',APP_DATA_DIR:data,APP_NO_SEED:'0'},stdio:['ignore','pipe','pipe']});child.stderr.on('data',b=>process.stderr.write(b));base=await new Promise((resolve,reject)=>{child.stdout.on('data',b=>{const match=String(b).match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});child.once('error',reject);child.once('exit',c=>reject(Error('exit '+c)));});};
 const stop=async()=>{const exit=once(child,'exit');child.kill();await exit;};
 try{
  await start();for(const asset of ['/editor-history.js','/template-edit-helpers.js']){const r=await fetch(base+asset);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/javascript/);assert.match(await r.text(),/export function/);}
  const products=await(await fetch(base+'/api/products')).json(),url=base+'/api/templates/'+products[0].id;
  const zones=[{zoneType:'logo',shapeType:'ROTATED_RECT',rotation:20,name:'权限验收区域',x:.15,y:.2,width:.5,height:.5,defaultAnchorX:.4,defaultAnchorY:.45,maxLogoWidthRatio:.2,maxLogoHeightRatio:.2,defaultRotation:0,allowRotation:true,orientation:'free',isDefault:true,note:''}];
  const automation={carriers:[{id:'body',type:'BODY',name:'本体'}],areas:[{id:'a',zoneIndex:0,carrierId:'body',name:'正面',autoEligible:true,presets:[{id:'p',name:'设计师长轴',orientation:'long-axis',axisRotation:75.1366114721238,isDefault:true,box:{centerX:.4,centerY:.45,width:.175708343311874,height:.109218580990425,rotation:30.1366114721238}}]}],schemes:[{id:'A',name:'方案 A',role:'DEFAULT',targets:[{areaId:'a',presetId:'p'}]}]};
  const body={zones,automation,baseVersion:0,changeNote:'测试母版'},post=cookie=>fetch(url,{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await(await fetch(url)).json()).canEdit,false);assert.equal((await post('')).status,403);assert.equal((await(await fetch(url)).json()).currentVersion,0);
  const designer=await testLogin(base,data);assert.equal((await(await fetch(url,{headers:{cookie:designer}})).json()).canEdit,true);assert.equal((await post(designer)).status,201);
  const published=(await(await fetch(url)).json()).template;body.baseVersion=1;body.changeNote='管理员复核';const admin=await testLogin(base,data,'admin');assert.equal((await post(admin)).status,201);
  await fetch(base+'/api/rule-auth',{method:'DELETE',headers:{cookie:designer}});assert.equal((await post(designer)).status,403);
  await stop();await start();const historic=await(await fetch(base+'/api/templates/'+products[0].id+'?version=1')).json();assert.deepEqual(historic.template.zones,published.zones);assert.deepEqual(historic.template.automation,published.automation);assert.deepEqual(historic.template.automation.areas[0].presets[0].box,automation.areas[0].presets[0].box);assert.equal(historic.template.automation.areas[0].presets[0].axisRotation,75.1366114721238);assert.equal(historic.currentVersion,2);
 }finally{if(child?.exitCode===null)await stop();}
});
