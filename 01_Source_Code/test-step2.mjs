import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
test('母版发布、数据校验、不可覆盖历史、任务版本绑定、服务重启',async()=>{
 const data=mkdtempSync(join(tmpdir(),'template-test-'));let child,base;
 async function start(){child=spawn(process.execPath,[join(root,'server.mjs')],{env:{...process.env,PORT:'0',APP_DATA_DIR:data,APP_NO_SEED:'0'},stdio:['ignore','pipe','pipe']});base=await new Promise((yes,no)=>{child.stdout.on('data',b=>{const m=String(b).match(/http:\/\/127\.0\.0\.1:\d+/);if(m)yes(m[0]);});child.on('error',no);child.on('exit',c=>no(new Error('exit '+c)));});}
 async function stop(){const done=once(child,'exit');child.kill();await done;}
 const get=async p=>{const r=await fetch(base+p);assert.equal(r.status,200);return r.json();};
 const send=(path,payload)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const logo=(name,x,y,w,h,isDefault=false)=>({zoneType:'logo',name,x,y,width:w,height:h,defaultAnchorX:x+w/2,defaultAnchorY:y+h/2,maxLogoWidthRatio:.7,maxLogoHeightRatio:.3,defaultRotation:90,allowRotation:false,orientation:'vertical',isDefault,note:'验收示例'});
 try{
 await start();const products=await get('/api/products'),p=products.find(p=>p.sku==='L0048'),path='/api/templates/'+p.id;
 assert.equal((await get(path)).template,null);
 const zones=[logo('产品本体 Logo 区',.18,.45,.07,.3,true),logo('彩盒 Logo 区',.43,.3,.08,.4),{zoneType:'no-logo',name:'接缝禁止区域',x:.17,y:.38,width:.10,height:.02,note:'验收示例'}];
 let r=await send(path,{zones,baseVersion:0,changeNote:'首次发布'});assert.equal(r.status,201);const v1=await r.json();assert.equal(v1.currentVersion,1);assert.equal(v1.template.zones.length,3);
 const f=new FormData();f.set('customerName','版本绑定验收');f.set('productIds',JSON.stringify([p.id]));f.set('rawRequirement','单色 Logo');f.set('logo',new Blob([readFileSync(join(root,'seed/rae-logo.png'))],{type:'image/png'}),'Rae.png');r=await fetch(base+'/api/tasks',{method:'POST',body:f});assert.equal(r.status,201);const task=await r.json();
 assert.equal((await get('/api/tasks/'+task.id)).products[0].boundVersion,1);
 const invalid=structuredClone(zones);invalid[1].isDefault=true;r=await send(path,{zones:invalid,baseVersion:1,changeNote:'无效'});assert.equal(r.status,400);
 invalid[1].isDefault=false;invalid[0].width=2;r=await send(path,{zones:invalid,baseVersion:1,changeNote:'无效'});assert.equal(r.status,400);
 r=await send(path,{zones,baseVersion:1,changeNote:''});assert.equal(r.status,400);
 r=await send(path,{zones,baseVersion:0,changeNote:'过时'});assert.equal(r.status,409);
 const v2zones=structuredClone(zones);v2zones[0].x+=.01;v2zones[0].defaultAnchorX+=.01;
 r=await send(path,{zones:v2zones,baseVersion:1,changeNote:'调整本体区域'});assert.equal(r.status,201);const v2=await r.json();assert.equal(v2.currentVersion,2);assert.equal(v2.history.length,2);assert.equal(v2.history.filter(v=>v.isCurrent).length,1);
 const old=await get(path+'?version=1');assert.deepEqual(old.template.zones,v1.template.zones);assert.equal(old.template.isCurrent,0);
 assert.equal((await get('/api/tasks/'+task.id)).products[0].boundVersion,1);
 const demo=(await get('/api/tasks')).find(t=>t.taskCode==='DEMO-RAE-001');assert.ok((await get('/api/tasks/'+demo.id)).products.every(p=>p.boundVersion===null));
 assert.equal((await get('/api/products')).find(r=>r.id===p.id).currentVersion,2);
 await stop();await start();assert.equal((await get(path)).currentVersion,2);assert.deepEqual((await get(path+'?version=1')).template.zones,v1.template.zones);assert.equal((await get('/api/tasks/'+task.id)).products[0].boundVersion,1);
 console.log('PASS V1/V2、重复默认与越界拒绝、冲突保护、历史任务不回填、新任务版本固定、重启恢复');
 }finally{if(child&&child.exitCode===null)await stop();}
});
