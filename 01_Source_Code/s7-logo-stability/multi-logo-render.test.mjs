import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';
import {buildAiMockupPlan} from './ai-mockup-generation.mjs';
import {userSpace} from './user-space.mjs';
import {createSchemes} from './schemes.mjs';

const versions=['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL'];
async function fixture(t,renderer,options={}){
 const dir=await mkdtemp(join(tmpdir(),'s7-multi-logo-'));
 const base=await sharp({create:{width:80,height:80,channels:4,background:'#eee'}}).png().toBuffer();
 const mark=await sharp({create:{width:6,height:3,channels:4,background:'#c03020'}}).png().toBuffer();
 const logo=await sharp({create:{width:8,height:5,channels:4,background:'#00000000'}}).composite([{input:mark,left:1,top:1}]).png().toBuffer();
 const product={id:'bottle',sku:'P01',name:'测试产品',imageBytes:base,template:{id:'bottle-master',version:1,zones:[{id:'body',zoneType:'logo',x:.3,y:.3,width:.2,height:.2},{id:'box',zoneType:'logo',name:'彩盒正面',x:.6,y:.3,width:.2,height:.2}],automation:{carriers:[{id:'product',type:'BODY'},{id:'carton',type:'CARTON'}],areas:[{id:'body-area',zoneId:'body',carrierId:'product',foilProcesses:['GOLD FOIL','SILVER FOIL']},{id:'carton-area',zoneId:'box',carrierId:'carton',foilProcesses:[]}],schemes:[]}}};
 const serverOptions={spaceDir:dir,authenticate:async req=>({id:req.headers.cookie||'alice'}),productCatalog:async()=>[product],productTemplate:async product=>({template:product.template}),mockupRenderer:renderer,...options};
 let server=createDemoServer(serverOptions);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const call=(path,data,method=data?'POST':'GET',user='alice')=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{cookie:user,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 const task=await(await call('/api/my-space/tasks',{title:'多 Logo 测试'})).json();
 await call(`/api/my-space/tasks/${task.id}`,{revision:0,state:{mode:'multi-logo'}},'PUT');
 const input={taskId:task.id,productId:'bottle',model:'flux-3-image',logos:[{id:'red',name:'红标',logoImage:logo.toString('base64')},{id:'other',name:'另一标',logoImage:await sharp(logo).modulate({hue:120}).png().toBuffer().then(b=>b.toString('base64'))}]};
 async function wait(){for(let i=0;i<200;i++){const r=await call(`/api/my-space/tasks/${task.id}/generation`);assert.equal(r.status,200);const job=await r.json();if(job?.status!=='running')return job;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('多 Logo 任务未结束');}
 async function restart(mockupRenderer){await new Promise(resolve=>server.close(resolve));server=createDemoServer({...serverOptions,mockupRenderer});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));}
 return {call,input,wait,base,product,restart,spaces:userSpace(dir)};
}

test('one product with two logos saves eight separately attributed images using existing print plans',async t=>{
 const inputs=[];
 const f=await fixture(t,async input=>{inputs.push(input);const outputs=input.guides.map(guide=>({version:guide.version,bytes:Buffer.from(guide.dataUrl.split(',')[1],'base64')}));for(const output of outputs)await input.onOutput(output);return outputs;});
 const response=await f.call('/api/ai-render-logos',f.input);
 assert.equal(response.status,202);
 const job=await f.wait();assert.equal(job.status,'complete');assert.equal(job.outputs.length,8);
 for(const id of ['red','other'])assert.deepEqual(job.outputs.filter(output=>output.logoId===id).map(output=>output.version),versions);
 for(const input of inputs){assert.equal(buildAiMockupPlan(input).length,4);assert.equal(input.baseImage,`data:image/png;base64,${f.base.toString('base64')}`);assert.equal(input.targets.length,2);assert.equal(input.schemes[2].targets[1].printFinish,'INK');}
 const history=await(await f.call(`/api/my-space/history?taskId=${f.input.taskId}`)).json();assert.equal(history.reduce((n,r)=>n+r.images.length,0),8);
 const image=await f.call(job.outputs[0].dataUrl);assert.equal(image.status,200);
 assert.equal((await f.call(job.outputs[0].dataUrl,null,'GET','bob')).status,404);
});

test('unchecked versions never reach the model or become failed stages in a multi-logo batch',async t=>{
 const requests=[];
 const f=await fixture(t,async input=>{requests.push(input.selectedVersions);return input.selectedVersions.map(version=>({version,bytes:f.base}));});
 assert.equal((await f.call('/api/ai-render-logos',{...f.input,selectedVersions:['ORIGINAL','BLACK']})).status,202);
 const job=await f.wait();assert.equal(job.status,'complete');assert.equal(job.outputs.length,4);assert.equal(Object.keys(job.stages).length,4);
 assert.deepEqual(requests,[['ORIGINAL','BLACK'],['ORIGINAL','BLACK']]);
 assert.ok(job.outputs.every(output=>['ORIGINAL','BLACK'].includes(output.version)));
});

test('retrying a selected multi-logo batch does not generate versions that were never selected',async t=>{
 const requests=[];let retry=false;
 const f=await fixture(t,async input=>{requests.push(input.selectedVersions);if(!retry)await input.onStage('SILVER FOIL','failed',Error('temporary'));return input.selectedVersions.filter(version=>retry||version!=='SILVER FOIL').map(version=>({version,bytes:f.base}));});
 await f.call('/api/ai-render-logos',{...f.input,selectedVersions:['BLACK','SILVER FOIL']});assert.equal((await f.wait()).status,'partial');
 retry=true;await f.call('/api/ai-render-logos',{...f.input,retryFailed:true});const job=await f.wait();
 assert.deepEqual(requests.slice(2),[['SILVER FOIL'],['SILVER FOIL']]);assert.equal(job.status,'complete');assert.equal(job.outputs.length,4);
});

test('removing a failed logo before a single-image regeneration removes its stages from progress',async t=>{
 const f=await fixture(t,async input=>input.selectedVersions.map(version=>({version,bytes:f.base})));
 const input={...f.input,logos:[...f.input.logos,{...f.input.logos[0],id:'removed',name:'移除的Logo'}],selectedVersions:['BLACK']};
 await f.call('/api/ai-render-logos',input);await f.wait();
 await f.spaces.updateGeneration({id:'alice'},f.input.taskId,current=>({...current,status:'partial',stages:{...current.stages,'removed:BLACK':{stage:'failed',error:'temporary'}}}));
 await f.call('/api/ai-render-logos',{...input,logos:f.input.logos,onlyLogoId:'red'});const job=await f.wait();
 assert.equal(job.status,'complete');assert.deepEqual(Object.keys(job.stages).sort(),['other:BLACK','red:BLACK']);assert.equal(job.outputs.length,2);
});

test('ordinary tasks generate multiple logos with independent layouts and preserve other results on regeneration',async t=>{
 const inputs=[];
 const f=await fixture(t,async input=>{inputs.push(input);return input.selectedVersions.map(version=>({version,bytes:f.base}));});
 const task=await(await f.call('/api/my-space/tasks',{title:'普通任务'})).json();
 const targets=[{id:'body',masterZoneId:'body',x:.6,y:.5,widthRatio:.25,rotation:15}];
 const schemes=createSchemes(targets).schemes;schemes[2].targets[0].rotation=40;
 const input={...f.input,taskId:task.id,logoLayouts:[{logoId:'red',targets,schemes,schemeSignatures:{ORIGINAL:'red-original'}}]};
 assert.equal((await f.call('/api/ai-render-logos',input)).status,202);
 const wait=async()=>{for(let i=0;i<200;i++){const job=await(await f.call(`/api/my-space/tasks/${task.id}/generation`)).json();if(job.status!=='running')return job;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('任务未结束');};
 const before=await wait();assert.equal(before.outputs.length,8);
 const geometry=targets=>targets.map(({carrierType,printFinish,preserveOriginalColor,...target})=>target);
 const edited=inputs.find(input=>input.targets[0].id==='body');assert.ok(edited);
 assert.deepEqual(geometry(edited.targets),targets);assert.deepEqual(edited.schemes.map(scheme=>({...scheme,targets:geometry(scheme.targets)})),schemes.map(scheme=>({...scheme,targets:geometry(scheme.targets)})));
 assert.equal(edited.targets[0].carrierType,'BODY');assert.equal(edited.schemes.find(scheme=>scheme.version==='GOLD FOIL').targets[0].printFinish,'GOLD FOIL');
 assert.equal(before.outputs.find(output=>output.logoId==='red'&&output.version==='ORIGINAL').schemeSignature,'red-original');
 assert.equal((await f.call('/api/ai-render-logos',{...input,onlyLogoId:'red',selectedVersions:['BLACK']})).status,202);
 const after=await wait();assert.equal(after.status,'complete');assert.equal(after.outputs.length,8);
 assert.equal(inputs.length,3);assert.deepEqual(inputs[2].selectedVersions,['BLACK']);
 for(const output of before.outputs.filter(output=>output.logoId!=='red'||output.version!=='BLACK'))assert.equal(after.outputs.find(item=>item.logoId===output.logoId&&item.version===output.version).dataUrl,output.dataUrl);
});

test('ordinary tasks reject multi-product logo batches and mismatched layouts before rendering',async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return [];});
 const task=await(await f.call('/api/my-space/tasks',{title:'普通任务'})).json();
 await f.call(`/api/my-space/tasks/${task.id}`,{revision:0,state:{multiPackageProducts:[{id:'bottle'},{id:'other'}]}},'PUT');
 assert.equal((await f.call('/api/ai-render-logos',{...f.input,taskId:task.id})).status,400);
 for(const logoLayouts of [[{logoId:'missing'}],[{logoId:'red'},{logoId:'red'}],[{logoId:'red',targets:[],schemes:[]}]])assert.equal((await f.call('/api/ai-render-logos',{...f.input,logoLayouts})).status,400);
 assert.equal(calls,0);
});

test('an unedited logo keeps the product master when only another logo has a custom non-foil layout',async t=>{
 const inputs=[];
 const f=await fixture(t,async input=>{inputs.push(input);return input.selectedVersions.map(version=>({version,bytes:f.base}));});
 const targets=[{id:'edited',masterZoneId:'body',x:.6,y:.5,widthRatio:.25,rotation:15}];
 const response=await f.call('/api/ai-render-logos',{...f.input,selectedVersions:['BLACK'],logoLayouts:[{logoId:'red',targets,schemes:createSchemes(targets).schemes}]});
 assert.equal(response.status,202);assert.equal((await f.wait()).status,'complete');
 const unedited=inputs.find(input=>input.targets[0].id==='master-body');assert.ok(unedited);
 assert.deepEqual(unedited.targets.map(target=>target.x),[.4,.7]);
});

test('partial failure keeps other logo results and retries only missing versions without duplicating successes',async t=>{
 let fail=true;const selections=[];
 const f=await fixture(t,async input=>{const first=selections.length===0;selections.push(input.selectedVersions);const outputs=[];for(const version of input.selectedVersions){if(fail&&first&&version==='BLACK'){await input.onStage(version,'failed',Error('测试上游失败'));continue;}const output={version,bytes:Buffer.from(input.guides.find(g=>g.version===version).dataUrl.split(',')[1],'base64')};await input.onOutput(output);outputs.push(output);}return outputs;});
 assert.equal((await f.call('/api/ai-render-logos',f.input)).status,202);const before=await f.wait();
 assert.equal(before.outputs.length,7);assert.equal(before.status,'partial');assert.match(Object.values(before.stages).find(stage=>stage.stage==='failed').error,/测试上游失败/);
 fail=false;assert.equal((await f.call('/api/ai-render-logos',{...f.input,retryFailed:true})).status,202);const after=await f.wait();
 assert.equal(after.outputs.length,8);assert.equal(after.status,'complete');assert.deepEqual(selections,[versions,versions,['BLACK']]);
 for(const output of before.outputs)assert.equal(after.outputs.find(x=>x.logoId===output.logoId&&x.version===output.version).dataUrl,output.dataUrl);
});

test('invalid, duplicate or opaque logos and unavailable products fail before image generation',async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return [];});
 for(const change of [{logos:[]},{logos:[f.input.logos[0],f.input.logos[0]]},{logos:[f.input.logos[0],{id:'bad',name:'坏图',logoImage:'garbage'}]},{logos:[f.input.logos[0],{id:'opaque',name:'不透明',logoImage:f.base.toString('base64')}]},{productId:'missing'}])assert.equal((await f.call('/api/ai-render-logos',{...f.input,...change})).status,400);
 assert.equal(calls,0);assert.equal((await f.call('/api/ai-render-logos',f.input,'POST','bob')).status,404);
});

test('multi-logo can be disabled while original rendering and saved tasks stay accessible',async t=>{
 const f=await fixture(t,async()=>[],{multiLogoEnabled:false});
 assert.equal((await f.call('/api/ai-render-logos',f.input)).status,404);
 assert.equal((await f.call('/multi-logo.html')).status,200);
 const response=await f.call('/api/render',{productId:'bottle',baseImage:f.base.toString('base64'),logoImage:f.input.logos[0].logoImage,targets:[{id:'one',masterZoneId:'body',x:.5,y:.5,widthRatio:.2}]});
 assert.equal(response.status,200);assert.equal((await response.json()).outputs.length,4);
});

test('a running multi-logo job survives page requests, blocks duplicate start and deletion, and isolates users',async t=>{
 let entered,release;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 t.after(()=>release());
 const f=await fixture(t,async input=>{entered();await gate;return input.guides.map(g=>({version:g.version,bytes:Buffer.from(g.dataUrl.split(',')[1],'base64')}));});
 try{
  assert.equal((await f.call('/api/ai-render-logos',f.input)).status,202);await started;
  const job=await(await f.call(`/api/my-space/tasks/${f.input.taskId}/generation`)).json();assert.equal(job.status,'running');
  const tasks=await(await f.call('/api/my-space/tasks')).json();assert.equal(tasks[0].generation.status,'running');
  assert.equal((await f.call('/api/ai-render-logos',f.input)).status,409);
  assert.equal((await f.call(`/api/my-space/tasks/${f.input.taskId}`,null,'DELETE')).status,409);
  assert.equal((await f.call(`/api/my-space/tasks/${f.input.taskId}/generation`,null,'GET','bob')).status,404);
 }finally{release();await f.wait();}
});

test('service restart preserves successful images and resumes only missing remote work',async t=>{
 const f=await fixture(t,async input=>{await input.onCheckpoint('BLACK',{taskId:'remote-black',requestHash:'test-hash'});await input.onStage('BLACK','failed',Error('查询暂时中断'));return input.guides.filter(g=>g.version!=='BLACK').map(g=>({version:g.version,bytes:Buffer.from(g.dataUrl.split(',')[1],'base64')}));});
 assert.equal((await f.call('/api/ai-render-logos',f.input)).status,202);const before=await f.wait();assert.equal(before.outputs.length,6);
 await f.spaces.updateGeneration({id:'alice'},f.input.taskId,current=>({...current,status:'running'}));
 const resumes=[];
 await f.restart(async input=>{resumes.push(input.resumeTasks.BLACK);return [{version:'BLACK',bytes:f.base}];});
 const interrupted=await(await f.call(`/api/my-space/tasks/${f.input.taskId}/generation`)).json();
 assert.equal(interrupted.status,'interrupted');assert.equal(interrupted.outputs.length,6);
 assert.equal((await f.call('/api/ai-render-logos',{...f.input,retryFailed:true})).status,202);
 const after=await f.wait();assert.equal(after.status,'complete');assert.equal(after.outputs.length,8);
 assert.deepEqual(resumes,[{taskId:'remote-black',requestHash:'test-hash'},{taskId:'remote-black',requestHash:'test-hash'}]);
 for(const output of before.outputs)assert.equal(after.outputs.find(x=>x.logoId===output.logoId&&x.version===output.version).dataUrl,output.dataUrl);
});

test('retry refuses changed assets and products requiring master review never submit generation',async t=>{
 let calls=0;const f=await fixture(t,async input=>{calls++;return [input.guides[0]].map(g=>({version:g.version,bytes:Buffer.from(g.dataUrl.split(',')[1],'base64')}));});
 assert.equal((await f.call('/api/ai-render-logos',f.input)).status,202);await f.wait();assert.equal(calls,2);
 const changed={...f.input,retryFailed:true,logos:f.input.logos.map(logo=>({...logo,logoImage:f.input.logos[1].logoImage}))};
 assert.equal((await f.call('/api/ai-render-logos',changed)).status,409);assert.equal(calls,2);
 const reviewed=await fixture(t,async()=>{assert.fail('stale master submitted');},{productTemplate:async()=>({needsTemplateReview:true,template:f.product.template})});
 assert.equal((await reviewed.call('/api/ai-render-logos',reviewed.input)).status,400);
});

test('new batch preserves source logo colors and uses white ink on dark product surfaces',async t=>{
 const f=await fixture(t,async input=>input.guides.map(g=>({version:g.version,bytes:Buffer.from(g.dataUrl.split(',')[1],'base64')})));
 f.product.imageBytes=await sharp(f.base).negate({alpha:false}).png().toBuffer();
 assert.equal((await f.call('/api/ai-render-logos',f.input)).status,202);const job=await f.wait();assert.equal(job.outputs.length,8,JSON.stringify(job.stages));
 const pixel=async version=>{const image=await f.call(job.outputs.find(output=>output.logoId==='red'&&output.version===version).dataUrl);const bytes=Buffer.from(await image.arrayBuffer());return Array.from(await sharp(bytes).extract({left:32,top:32,width:1,height:1}).removeAlpha().raw().toBuffer());};
 assert.deepEqual(await pixel('ORIGINAL'),[192,48,32]);assert.deepEqual(await pixel('BLACK'),[255,255,255]);
});

test('concurrent progress reads cannot let the legacy queue interrupt an active multi-logo job',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 const f=await fixture(t,async input=>{await gate;return input.guides.map(g=>({version:g.version,bytes:Buffer.from(g.dataUrl.split(',')[1],'base64')}));});
 let reading=true;
 const readers=Array.from({length:5},async()=>{while(reading){const response=await f.call(`/api/my-space/tasks/${f.input.taskId}/generation`);assert.equal(response.status,200);await response.json();}});
 try{
  assert.equal((await f.call('/api/ai-render-logos',f.input)).status,202);
  reading=false;await Promise.all(readers);
  const during=await(await f.call(`/api/my-space/tasks/${f.input.taskId}/generation`)).json();assert.equal(during.status,'running');
  assert.equal((await f.call('/api/ai-render-logos',f.input)).status,409);
  assert.equal((await f.call(`/api/my-space/tasks/${f.input.taskId}`,null,'DELETE')).status,409);
 }finally{reading=false;await Promise.all(readers);release();await f.wait();}
});
