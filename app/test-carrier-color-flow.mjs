import {testLogin} from './fixture-login.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtempSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {sharp} from './logo-pixels.mjs';
const root=dirname(fileURLToPath(import.meta.url));
test('载体Logo改色链路：不同颜色真实像素、规则重算、版本保护与恢复',async()=>{
 const data=mkdtempSync(join(tmpdir(),'automatic-test-')),child=spawn(process.execPath,[join(root,'server.mjs')],{env:{...process.env,PORT:'0',APP_DATA_DIR:data,APP_NO_SEED:'0'},stdio:['ignore','pipe','pipe']});let cookie='';child.stderr.on('data',b=>process.stderr.write(b));
 const base=await new Promise((yes,no)=>{child.stdout.on('data',b=>{const m=String(b).match(/http:\/\/127\.0\.0\.1:\d+/);if(m)yes(m[0]);});child.on('error',no);child.on('exit',c=>no(Error('exit '+c)));});
 const get=async p=>{const r=await fetch(base+p,{headers:{cookie}});assert.equal(r.status,200);return r.json();};const post=async(p,v,status=200)=>{const f=v instanceof FormData,r=await fetch(base+p,{method:'POST',headers:f?{cookie}:{cookie,'Content-Type':'application/json'},body:f?v:JSON.stringify(v)}),d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;};
 try{
 const products=await get('/api/products'),product=products.find(p=>p.sku==='L0048'),other=products.find(p=>p.sku==='F0021');
 const zone=(x,name)=>({zoneType:'logo',shapeType:'RECT',name,x,y:.2,width:.25,height:.4,defaultAnchorX:x+.125,defaultAnchorY:.4,maxLogoWidthRatio:.25,maxLogoHeightRatio:.4,defaultRotation:0,allowRotation:true,orientation:'free',isDefault:x===.1,note:''});
 const automation={carriers:[{id:'body',type:'BODY',name:'本体'},{id:'carton',type:'CARTON',name:'彩盒'}],areas:[.1,.6].map((x,i)=>({id:'area'+i,carrierId:i?'carton':'body',name:i?'正面':'瓶身',zoneIndex:i,autoEligible:true,presets:[{id:'preset'+i,name:'横排',orientation:'horizontal',isDefault:true,box:{centerX:x+.125,centerY:.4,width:.15,height:.1,rotation:0}}]})),schemes:[{id:'A',name:'方案A',role:'DEFAULT',targets:[{areaId:'area0',presetId:'preset0'},{areaId:'area1',presetId:'preset1'}]},{id:'B',name:'方案B',role:'ALTERNATIVE',targets:[{areaId:'area1',presetId:'preset1'}]}]};
 cookie=await testLogin(base,data);
 await post('/api/templates/'+product.id,{baseVersion:0,changeNote:'独立验收',zones:[zone(.1,'本体'),zone(.6,'彩盒')],automation},201);
 cookie='';
 const form=new FormData();form.set('customerName','独立自动生成验收');form.set('productIds',JSON.stringify([product.id,other.id]));form.set('logo',new Blob([readFileSync(join(root,'seed/rae-logo.png'))]),'rae.png');const task=await post('/api/tasks',form,201),id=task.id,path='/api/automatic/'+id;
 const l=await get('/api/logo/'+id);await post('/api/logo/'+id+'/productions',{sourceLogoAssetId:l.sources[0].id,selectedElementIds:[l.sources[0].elements[0].id],colorMode:'SINGLE',backgroundRemovalMode:'NONE',tolerance:20,primaryColor:'#000000',secondaryColor:'#c4a052',pantoneNote:'',baseVersion:0},201);
 const initial=await get(path),ids=initial.items.map(i=>i.id);let page=await post(path+'/generate',{taskProductIds:ids,processType:'NORMAL_PRINT'},201);
 assert.equal(page.outputs.length,2);assert.equal(page.runs[0].status,'PARTIAL');assert.equal(page.outputs.find(o=>o.schemeId==='A').snapshot.targets.length,2);assert.equal(page.runs[0].report.filter(r=>r.status==='DESIGNER_REQUIRED').length,1);
 const png=await fetch(base+'/files/'+page.outputs[0].imagePath);assert.equal(png.status,200);assert.equal(Buffer.from(await png.arrayBuffer()).subarray(1,4).toString(),'PNG');


 const item=initial.items.find(i=>i.productId===product.id),original=page.outputs.find(o=>o.schemeId==='A');
 const bytes=async key=>Buffer.from(await(await fetch(base+'/files/'+key)).arrayBuffer());
 const originalBytes=await bytes(original.imagePath),productionPage=await get('/api/logo/'+id),logo=productionPage.productions[0],logoBefore=await bytes(logo.filePath);
 const req={baseVersion:0,requirementText:'本体保留黑色，彩盒Logo改白色',processType:'NORMAL_PRINT',changeNote:'载体改色',structuredConfirmed:true,carrierOverrides:[{taskProductId:item.id,carrierId:'carton',processType:'WHITE_PRINT',logoColor:'#FFFFFF'}]};
 for(const logoColor of ['red','#fff','#ffffff00',7])await post(path+'/requirements',{...req,carrierOverrides:[{...req.carrierOverrides[0],logoColor}]},400);
 const saved=await post(path+'/requirements',req,201);assert.equal(saved.current.carrierOverrides[0].logoColor,'#ffffff');
 page=await post(path+'/generate',{taskProductIds:[item.id],processType:'AUTO',requirementVersion:1},201);
 const output=page.outputs.find(o=>o.schemeId==='A'&&o.snapshot.requirementVersion===1);assert.ok(output);
 assert.equal(output.snapshot.targets[0].logoColor,null);assert.equal(output.snapshot.targets[1].logoColor,'#ffffff');assert.equal(output.snapshot.targets[1].processType,'WHITE_PRINT');
 assert.ok(output.snapshot.targets[1].logoVariant.sourceSha);assert.equal(output.snapshot.targets[1].logoVariant.method,'CARRIER_LOGO_SINGLE_RGB_V1');
 const before=await sharp(originalBytes).ensureAlpha().raw().toBuffer({resolveWithObject:true}),after=await sharp(await bytes(output.imagePath)).ensureAlpha().raw().toBuffer();let changed=0,white=0;
 for(let y=0;y<before.info.height;y++)for(let x=0;x<before.info.width;x++){const offset=(y*before.info.width+x)*4,same=before.data.subarray(offset,offset+4).equals(after.subarray(offset,offset+4));if(x<before.info.width*.5)assert.ok(same,'本体区域不变');if(!same){changed++;assert.ok(x>=before.info.width*.6&&x<=before.info.width*.85&&y>=before.info.height*.2&&y<=before.info.height*.6,'修改像素只能在彩盒Logo区域');if(after[offset]===255&&after[offset+1]===255&&after[offset+2]===255)white++;}}
 assert.ok(changed>20);assert.ok(white>20);assert.deepEqual(await bytes(logo.filePath),logoBefore);assert.deepEqual(await bytes(original.imagePath),originalBytes);
 page=await post(path+'/generate',{taskProductIds:[item.id],processType:'AUTO',requirementVersion:1},201);assert.ok(page.runs[0].report.every(r=>r.status==='UNCHANGED'));
 const password=readFileSync(join(data,'规则管理账号.txt'),'utf8').match(/账号：admin\r?\n密码：([^\r\n]+)/)[1];const login=await fetch(base+'/api/rule-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password})});cookie=login.headers.get('set-cookie').split(';')[0];
 await post('/api/rules',{ruleCode:'WHITE-BLOCK',name:'禁止白色Logo',scopeType:'GLOBAL',resultType:'BLOCK',hardness:'HARD',enabled:true,isExample:false,businessMessage:'该产品禁止白色Logo',internalNote:'独立规则验收',recommendedAction:'',baseVersion:0,conditions:[{field:'visualColorIntent',operator:'EQUALS',value:'WHITE'}]},201);
 page=await post(path+'/generate',{taskProductIds:[item.id],processType:'AUTO',requirementVersion:1},201);assert.equal(page.runs[0].status,'FAILED');assert.ok(page.runs[0].report.every(r=>r.reason.includes('禁止白色Logo')),'规则必须读取改色后的白色，而不是原Logo黑色');
 await post(path+'/requirements',{...req,baseVersion:1,carrierOverrides:[]},201);
 page=await post(path+'/generate',{taskProductIds:[item.id],processType:'AUTO',requirementVersion:2},201);assert.equal(page.runs[0].status,'COMPLETED');
 const restored=page.outputs.find(o=>o.schemeId==='A'&&o.snapshot.requirementVersion===2);assert.deepEqual(await bytes(restored.imagePath),originalBytes);
 const latest=await get(path);assert.equal(latest.requirements.history.find(r=>r.version===1).carrierOverrides[0].logoColor,'#ffffff');
 console.log('PASS 载体Logo独立颜色像素、原图保护、白色规则阻断、恢复原色与历史');
 }finally{const exit=once(child,'exit');child.kill();await exit;}
});
