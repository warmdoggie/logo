import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtempSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {sharp} from './logo-pixels.mjs';
const root=dirname(fileURLToPath(import.meta.url));
test('载体工艺：独立选择、继承、非法覆盖、版本与整方案失败隔离',async()=>{
 const data=mkdtempSync(join(tmpdir(),'automatic-test-')),child=spawn(process.execPath,[join(root,'server.mjs')],{env:{...process.env,PORT:'0',APP_DATA_DIR:data,APP_NO_SEED:'0'},stdio:['ignore','pipe','pipe']});let cookie='';child.stderr.on('data',b=>process.stderr.write(b));
 const base=await new Promise((yes,no)=>{child.stdout.on('data',b=>{const m=String(b).match(/http:\/\/127\.0\.0\.1:\d+/);if(m)yes(m[0]);});child.on('error',no);child.on('exit',c=>no(Error('exit '+c)));});
 const get=async p=>{const r=await fetch(base+p,{headers:{cookie}});assert.equal(r.status,200);return r.json();};const post=async(p,v,status=200)=>{const f=v instanceof FormData,r=await fetch(base+p,{method:'POST',headers:f?{cookie}:{cookie,'Content-Type':'application/json'},body:f?v:JSON.stringify(v)}),d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;};
 try{
 const products=await get('/api/products'),product=products.find(p=>p.sku==='L0048'),other=products.find(p=>p.sku==='F0021');
 const zone=(x,name)=>({zoneType:'logo',shapeType:'RECT',name,x,y:.2,width:.25,height:.4,defaultAnchorX:x+.125,defaultAnchorY:.4,maxLogoWidthRatio:.25,maxLogoHeightRatio:.4,defaultRotation:0,allowRotation:true,orientation:'free',isDefault:x===.1,note:''});
 const automation={carriers:[{id:'body',type:'BODY',name:'本体'},{id:'carton',type:'CARTON',name:'彩盒'}],areas:[.1,.6].map((x,i)=>({id:'area'+i,carrierId:i?'carton':'body',name:i?'正面':'瓶身',zoneIndex:i,autoEligible:true,presets:[{id:'preset'+i,name:'横排',orientation:'horizontal',isDefault:true,box:{centerX:x+.125,centerY:.4,width:.15,height:.1,rotation:0}}]})),schemes:[{id:'A',name:'方案A',role:'DEFAULT',targets:[{areaId:'area0',presetId:'preset0'},{areaId:'area1',presetId:'preset1'}]},{id:'B',name:'方案B',role:'ALTERNATIVE',targets:[{areaId:'area1',presetId:'preset1'}]}]};
 await post('/api/templates/'+product.id,{baseVersion:0,changeNote:'独立验收',zones:[zone(.1,'本体'),zone(.6,'彩盒')],automation},201);
 const form=new FormData();form.set('customerName','独立自动生成验收');form.set('productIds',JSON.stringify([product.id,other.id]));form.set('logo',new Blob([readFileSync(join(root,'seed/rae-logo.png'))]),'rae.png');const task=await post('/api/tasks',form,201),id=task.id,path='/api/automatic/'+id;
 const l=await get('/api/logo/'+id);await post('/api/logo/'+id+'/productions',{sourceLogoAssetId:l.sources[0].id,selectedElementIds:[l.sources[0].elements[0].id],colorMode:'SINGLE',backgroundRemovalMode:'NONE',tolerance:20,primaryColor:'#000000',secondaryColor:'#c4a052',pantoneNote:'',baseVersion:0},201);
 const initial=await get(path),ids=initial.items.map(i=>i.id);let page=await post(path+'/generate',{taskProductIds:ids,processType:'NORMAL_PRINT'},201);
 assert.equal(page.outputs.length,2);assert.equal(page.runs[0].status,'PARTIAL');assert.equal(page.outputs.find(o=>o.schemeId==='A').snapshot.targets.length,2);assert.equal(page.runs[0].report.filter(r=>r.status==='DESIGNER_REQUIRED').length,1);
 const png=await fetch(base+'/files/'+page.outputs[0].imagePath);assert.equal(png.status,200);assert.equal(Buffer.from(await png.arrayBuffer()).subarray(1,4).toString(),'PNG');

 const item=initial.items.find(i=>i.productId===product.id);
 const overrides=[{taskProductId:item.id,carrierId:'body',processType:'BLACK_PRINT'},{taskProductId:item.id,carrierId:'carton',processType:'NORMAL_PRINT'}];
 const req={baseVersion:0,requirementText:'本体黑色印刷，彩盒普通印刷',processType:'AUTO',changeNote:'按载体执行',structuredConfirmed:true,carrierOverrides:overrides};
 for(const carrierOverrides of [[overrides[0],overrides[0]],[{...overrides[0],carrierId:'unknown'}],[{...overrides[0],taskProductId:'other-task'}],[{...overrides[0],processType:'toString'}],[{...overrides[0],color:'#ffffff'}]])await post(path+'/requirements',{...req,carrierOverrides},400);
 assert.equal((await get(path)).requirements.current,null);
 let saved=await post(path+'/requirements',req,201);assert.equal(saved.current.carrierOverrides.length,2);
 page=await post(path+'/generate',{taskProductIds:[item.id],processType:'AUTO',requirementVersion:1},201);
 const mixed=page.outputs.find(o=>o.snapshot.requirementVersion===1&&o.schemeId==='A');assert.ok(mixed);
 assert.equal(mixed.snapshot.processType,'MIXED');assert.deepEqual(mixed.snapshot.targets.map(t=>t.processType),['BLACK_PRINT','NORMAL_PRINT']);
 assert.equal(mixed.snapshot.carrierProcesses.length,2);
 const old=Buffer.from(await(await fetch(base+'/files/'+mixed.imagePath)).arrayBuffer());
 page=await post(path+'/generate',{taskProductIds:[item.id],processType:'AUTO',requirementVersion:1},201);assert.ok(page.runs[0].report.every(r=>r.status==='UNCHANGED'));
 saved=await post(path+'/requirements',{...req,baseVersion:1,carrierOverrides:[{...overrides[0],processType:'HOT_STAMP_GOLD'}]},201);
 page=await post(path+'/generate',{taskProductIds:[item.id],processType:'AUTO',requirementVersion:2},201);
 assert.equal(page.runs[0].status,'PARTIAL');assert.ok(page.runs[0].report.find(r=>r.schemeId==='A'&&r.status==='DESIGNER_REQUIRED'));assert.ok(page.outputs.find(o=>o.schemeId==='B'&&o.snapshot.requirementVersion===2));
 assert.deepEqual(Buffer.from(await(await fetch(base+'/files/'+mixed.imagePath)).arrayBuffer()),old);
 saved=await post(path+'/requirements',{...req,baseVersion:2,processType:'BLACK_PRINT',carrierOverrides:[{...overrides[1],processType:'AUTO'}]},201);
 page=await post(path+'/generate',{taskProductIds:[item.id],processType:'AUTO',requirementVersion:3},201);
 assert.deepEqual(page.outputs.find(o=>o.schemeId==='A'&&o.snapshot.requirementVersion===3).snapshot.targets.map(t=>t.processType),['BLACK_PRINT','NORMAL_PRINT']);
 saved=await post(path+'/requirements',{...req,baseVersion:3,carrierOverrides:[]},201);
 assert.equal(saved.history.find(r=>r.version===1).carrierOverrides.length,2);
 page=await post(path+'/generate',{taskProductIds:[item.id],processType:'AUTO',requirementVersion:4},201);
 assert.equal(page.outputs.find(o=>o.schemeId==='A'&&o.snapshot.requirementVersion===4).snapshot.processType,'NORMAL_PRINT');
 const missingOverrides={...req,baseVersion:4};delete missingOverrides.carrierOverrides;
 await post(path+'/requirements',{...req,baseVersion:4},201);
 await post(path+'/requirements',{...missingOverrides,baseVersion:5},201);
 assert.equal((await get(path)).requirements.current.carrierOverrides.length,2);
 const zip=await fetch(base+path+'/round-export?version=1');assert.equal(zip.status,200);
 console.log('PASS 载体独立工艺、颜色不匹配拦截、全局继承与显式AUTO、非法输入、历史和ZIP');
 }finally{const exit=once(child,'exit');child.kill();await exit;}
});

test('载体设置迁移：旧轮次默认无覆盖，重复初始化保留原记录',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {customerRevisionService}=await import('./customer-revisions.mjs');const db=new DatabaseSync(':memory:');
 try{db.exec(`CREATE TABLE Task(id TEXT PRIMARY KEY);INSERT INTO Task VALUES ('t');CREATE TABLE CustomerRequirementRevision(id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES Task(id),version INTEGER NOT NULL,requirementText TEXT NOT NULL,processType TEXT NOT NULL,changeNote TEXT NOT NULL,createdBy TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(taskId,version));INSERT INTO CustomerRequirementRevision VALUES ('r','t',1,'原文','AUTO','首稿','tester','2026-09-16');`);
 for(let i=0;i<2;i++){const service=customerRevisionService(db,()=>false),r=service.current('t');assert.equal(r.requirementText,'原文');assert.equal(r.version,1);assert.deepEqual(r.carrierOverrides,[]);}
 }finally{db.close();}
});
