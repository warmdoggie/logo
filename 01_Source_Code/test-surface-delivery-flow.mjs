import {readSeedLogo} from './seed-logo.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtempSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {sharp} from './logo-pixels.mjs';
const root=dirname(fileURLToPath(import.meta.url));
test('底色改色与标签集成：锁定蒙版、原图保护、独立下载和轮次ZIP',async()=>{
 const data=mkdtempSync(join(tmpdir(),'automatic-test-')),child=spawn(process.execPath,[join(root,'server.mjs')],{env:{...process.env,PORT:'0',APP_DATA_DIR:data,APP_NO_SEED:'0'},stdio:['ignore','pipe','pipe']});let cookie='';child.stderr.on('data',b=>process.stderr.write(b));
 const base=await new Promise((yes,no)=>{child.stdout.on('data',b=>{const m=String(b).match(/http:\/\/127\.0\.0\.1:\d+/);if(m)yes(m[0]);});child.on('error',no);child.on('exit',c=>no(Error('exit '+c)));});
 const get=async p=>{const r=await fetch(base+p,{headers:{cookie}});assert.equal(r.status,200);return r.json();};const post=async(p,v,status=200)=>{const f=v instanceof FormData,r=await fetch(base+p,{method:'POST',headers:f?{cookie}:{cookie,'Content-Type':'application/json'},body:f?v:JSON.stringify(v)}),d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;};
 try{
 const products=await get('/api/products'),product=products.find(p=>p.sku==='L0048'),other=products.find(p=>p.sku==='F0021');
 const zone=(x,name)=>({zoneType:'logo',shapeType:'RECT',name,x,y:.2,width:.25,height:.4,defaultAnchorX:x+.125,defaultAnchorY:.4,maxLogoWidthRatio:.25,maxLogoHeightRatio:.4,defaultRotation:0,allowRotation:true,orientation:'free',isDefault:x===.1,note:''});
 const automation={carriers:[{id:'body',type:'BODY',name:'本体'},{id:'carton',type:'CARTON',name:'彩盒'}],areas:[.1,.6].map((x,i)=>({id:'area'+i,carrierId:i?'carton':'body',name:i?'正面':'瓶身',zoneIndex:i,autoEligible:true,presets:[{id:'preset'+i,name:'横排',orientation:'horizontal',isDefault:true,box:{centerX:x+.125,centerY:.4,width:.15,height:.1,rotation:0}}]})),schemes:[{id:'A',name:'方案A',role:'DEFAULT',targets:[{areaId:'area0',presetId:'preset0'},{areaId:'area1',presetId:'preset1'}]},{id:'B',name:'方案B',role:'ALTERNATIVE',targets:[{areaId:'area1',presetId:'preset1'}]}]};
 const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
 automation.carriers[0].surfaceMask={reviewed:true,reviewNote:'排除中央已有文字',regions:[{mode:'INCLUDE',points:rect(.05,.1,.4,.8)},{mode:'EXCLUDE',points:rect(.2,.3,.1,.1)}]};
 await post('/api/templates/'+product.id,{baseVersion:0,changeNote:'独立验收',zones:[zone(.1,'本体'),zone(.6,'彩盒')],automation},201);
 const form=new FormData();form.set('customerName','独立自动生成验收');form.set('productIds',JSON.stringify([product.id,other.id]));form.set('logo',new Blob([readSeedLogo()]),'rae.png');const task=await post('/api/tasks',form,201),id=task.id,path='/api/automatic/'+id;
 const l=await get('/api/logo/'+id);await post('/api/logo/'+id+'/productions',{sourceLogoAssetId:l.sources[0].id,selectedElementIds:[l.sources[0].elements[0].id],colorMode:'SINGLE',backgroundRemovalMode:'NONE',tolerance:20,primaryColor:'#000000',secondaryColor:'#c4a052',pantoneNote:'',baseVersion:0},201);
 const initial=await get(path),ids=initial.items.map(i=>i.id);let page=await post(path+'/generate',{taskProductIds:ids,processType:'NORMAL_PRINT'},201);
 assert.equal(page.outputs.length,2);assert.equal(page.runs[0].status,'PARTIAL');assert.equal(page.outputs.find(o=>o.schemeId==='A').snapshot.targets.length,2);assert.equal(page.runs[0].report.filter(r=>r.status==='DESIGNER_REQUIRED').length,1);
 const png=await fetch(base+'/files/'+page.outputs[0].imagePath);assert.equal(png.status,200);assert.equal(Buffer.from(await png.arrayBuffer()).subarray(1,4).toString(),'PNG');



 const item=initial.items.find(i=>i.productId===product.id),old=page.outputs.find(o=>o.schemeId==='A'),read=async path=>Buffer.from(await(await fetch(base+path)).arrayBuffer());
 const beforeBytes=await read('/files/'+old.imagePath),sourceBefore=await read('/files/'+product.standardImage);
 const req={baseVersion:0,requirementText:'本体改红色',processType:'NORMAL_PRINT',changeNote:'预览底色',structuredConfirmed:true,carrierOverrides:[{taskProductId:item.id,carrierId:'body',processType:'INHERIT',surfaceColor:'#b04020'}]};
 await post(path+'/requirements',{...req,carrierOverrides:[{...req.carrierOverrides[0],carrierId:'carton'}]},400);
 const saved=await post(path+'/requirements',req,201);assert.equal(saved.current.carrierOverrides[0].surfaceColor,'#b04020');
 page=await post(path+'/generate',{taskProductIds:[item.id],processType:'AUTO',requirementVersion:1},201);
 const output=page.outputs.find(o=>o.schemeId==='A'&&o.snapshot.requirementVersion===1);assert.ok(output);assert.equal(output.snapshot.surfaceChanges.length,1);
 const before=await sharp(beforeBytes).ensureAlpha().raw().toBuffer({resolveWithObject:true}),image=await read('/files/'+output.imagePath),after=await sharp(image).ensureAlpha().raw().toBuffer();let changed=0;
 for(let y=0;y<before.info.height;y++)for(let x=0;x<before.info.width;x++){const i=(y*before.info.width+x)*4,same=before.data.subarray(i,i+4).equals(after.subarray(i,i+4)),nx=(x+.5)/before.info.width,ny=(y+.5)/before.info.height;if(!same){changed++;assert.ok(nx>=.05&&nx<=.45&&ny>=.1&&ny<=.9);assert.ok(!(nx>.201&&nx<.299&&ny>.301&&ny<.399));}}
 assert.ok(changed>100);assert.deepEqual(await read('/files/'+product.standardImage),sourceBefore);assert.deepEqual(await read('/files/'+old.imagePath),beforeBytes);
 const delivery=await fetch(base+path+'/'+output.id+'/delivery');assert.equal(delivery.status,200);assert.match(delivery.headers.get('content-disposition'),/attachment/);const labeled=Buffer.from(await delivery.arrayBuffer()),meta=await sharp(labeled).metadata();assert.ok(meta.height>before.info.height);
 assert.deepEqual(await sharp(labeled).extract({left:0,top:0,width:before.info.width,height:before.info.height}).raw().toBuffer(),after);
 assert.equal((await fetch(base+'/api/automatic/not-this-task/'+output.id+'/delivery')).status,404);
 const zip=await read(path+'/round-export?version=1');assert.equal(zip.readUInt32LE(0),0x04034b50);const start=30+zip.readUInt16LE(26)+zip.readUInt16LE(28),size=zip.readUInt32LE(18),zipMeta=await sharp(zip.subarray(start,start+size)).metadata();assert.ok(zipMeta.height>before.info.height);
 const templateId=output.snapshot.templateId;await post('/api/templates/'+product.id,{baseVersion:1,changeNote:'新版本移除蒙版',zones:[zone(.1,'本体'),zone(.6,'彩盒')],automation:{...automation,carriers:automation.carriers.map(({surfaceMask,...c})=>c)}},201);
 page=await post(path+'/generate',{taskProductIds:[item.id],processType:'AUTO',requirementVersion:1},201);assert.ok(page.runs[0].report.every(r=>r.status==='UNCHANGED'));assert.equal(page.outputs.find(o=>o.id===output.id).snapshot.templateId,templateId);
 await post(path+'/requirements',{...req,baseVersion:1,carrierOverrides:[]},201);page=await post(path+'/generate',{taskProductIds:[item.id],processType:'AUTO',requirementVersion:2},201);assert.deepEqual(await read('/files/'+page.outputs.find(o=>o.schemeId==='A'&&o.snapshot.requirementVersion===2).imagePath),beforeBytes);
 console.log('PASS 底色蒙版、锁定版本、禁止无蒙版改色、原图与历史、带标签PNG/ZIP');
 }finally{const exit=once(child,'exit');child.kill();await exit;}
});
