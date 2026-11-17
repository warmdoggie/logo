import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';
import {createSchemes} from './schemes.mjs';
import {userSpace} from './user-space.mjs';

async function workspace(run){
 const dir=await mkdtemp(join(tmpdir(),'s7-task-assets-'));
 let bytes=await sharp({create:{width:400,height:200,channels:4,background:'#c23'}}).png().toBuffer();
 const initial=bytes,calls=[],template={zones:[{id:'body',zoneType:'logo',x:.2,y:.2,width:.2,height:.1}]};
 const server=createDemoServer({spaceDir:dir,authenticate:async req=>({id:req.headers.cookie||'alice'}),productCatalog:async()=>['p','q'].map(id=>({id,sku:id,imageBytes:bytes,template})),productTemplate:async()=>({template,needsTemplateReview:bytes!==initial}),mockupRenderer:async input=>{calls.push(input);return input.selectedVersions.map(version=>({version,bytes:initial}));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,options={})=>fetch(base+path,options);
 try{await run({dir,call,original:bytes,replace:next=>bytes=next,calls});}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));const target=resolve(dir);assert.ok(target.startsWith(resolve(tmpdir())+sep)&&basename(target).startsWith('s7-task-assets-'));await rm(target,{recursive:true,force:true});}
}

test('产品原图就地保存为不可变任务快照，图库更新后引用仍返回原图',()=>workspace(async({dir,call,original,replace})=>{
 const task=await(await call('/api/my-space/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'snapshot'})})).json();
 const headers={'X-S7-Task-Id':task.id},first=await call('/api/product-library/image/p',{headers});
 assert.equal(first.headers.get('X-Workspace-User'),'alice');
 const url=first.headers.get('X-S7-Task-Asset');assert.ok(url?.startsWith(`/api/my-space/tasks/${task.id}/assets/`));
 assert.deepEqual(Buffer.from(await first.arrayBuffer()),original);
 const file=join(dir,'alice','tasks',task.id,'assets',url.split('/').at(-1)),before=await stat(file);
 const again=await call('/api/product-library/image/p',{headers});await again.arrayBuffer();assert.equal(again.headers.get('X-S7-Task-Asset'),url);assert.equal((await stat(file)).mtimeMs,before.mtimeMs);
 replace(await sharp({create:{width:400,height:200,channels:4,background:'#23c'}}).png().toBuffer());
 const snapshot=await call(url);assert.equal(snapshot.status,200);assert.equal(snapshot.headers.get('content-type'),'image/png');assert.match(snapshot.headers.get('cache-control'),/no-store/);
 assert.deepEqual(Buffer.from(await snapshot.arrayBuffer()),original);
 assert.equal((await call(url,{headers:{cookie:'bob'}})).status,404);
 const spaces=userSpace(dir);assert.throws(()=>spaces.taskAssetFromUrl({id:'alice'},'other-task',url),/不属于当前任务/);
 await assert.rejects(spaces.taskAssetFromUrl({id:'bob'},task.id,url),error=>error.status===404);
 await call('/api/my-space/tasks/'+task.id,{method:'DELETE'});assert.equal((await call(url)).status,404);
}));

test('不能把产品快照写入其他用户或不存在的任务',()=>workspace(async({call})=>{
 const task=await(await call('/api/my-space/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'private'})})).json();
 for(const headers of [{cookie:'bob','X-S7-Task-Id':task.id},{'X-S7-Task-Id':'missing'},{'X-S7-Task-Id':'../escape'}])assert.equal((await call('/api/product-library/image/p',{headers})).status,404);
}));

for(const mode of ['background','streaming','multi-logo'])test(`${mode} 生成使用任务快照，不被图库换图影响`,()=>workspace(async({call,original,replace,calls})=>{
 const task=await(await call('/api/my-space/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'render snapshot'})})).json();
 const response=await call('/api/product-library/image/p',{headers:{'X-S7-Task-Id':task.id}}),url=response.headers.get('X-S7-Task-Asset');await response.arrayBuffer();
 const targets=[{id:'saved',x:.5,y:.5,widthRatio:.2,rotation:0}],schemes=createSchemes(targets).schemes;
 replace(await sharp({create:{width:400,height:200,channels:4,background:'#23c'}}).png().toBuffer());
 const pixels=Buffer.alloc(16*16*4);for(let y=4;y<12;y++)for(let x=2;x<14;x++)pixels[(y*16+x)*4+3]=255;
 const logo=await sharp(pixels,{raw:{width:16,height:16,channels:4}}).png().toBuffer();
 const payload=mode==='multi-logo'?{taskId:task.id,productId:'p',baseAssetUrl:url,targets,model:'test',selectedVersions:['ORIGINAL'],logos:['one','two'].map(id=>({id,name:id,logoImage:logo.toString('base64')})),logoLayouts:['one','two'].map(logoId=>({logoId,targets,schemes}))}:{taskId:task.id,background:mode==='background',productIds:['p','q'],model:'test',selectedVersions:['ORIGINAL'],logoImage:logo.toString('base64'),productLayouts:['p','q'].map(productId=>({productId,baseAssetUrl:url,targets,schemes}))};
 const rendered=await call(mode==='multi-logo'?'/api/ai-render-logos':'/api/ai-render-multi',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
 assert.equal(rendered.status,mode==='streaming'?200:202,rendered.ok?'':await rendered.text());await rendered.text();
 if(mode!=='streaming')for(let n=0;n<100;n++){const job=await(await call(`/api/my-space/tasks/${task.id}/generation`)).json();if(job.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.equal(calls.length,2);
 const expected=await sharp(original).raw().toBuffer();for(const input of calls)assert.ok((await sharp(Buffer.from(input.baseImage.split(',')[1],'base64')).raw().toBuffer()).equals(expected),'生成应使用任务快照的原始像素');
}));

for(const moveEnabled of [false,true])test(`多 Logo 快照生成使用各自编辑区域，移动位置${moveEnabled?'解锁':'锁定'}均不要求重复的顶层区域`,()=>workspace(async({call,calls})=>{
 const task=await(await call('/api/my-space/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'edited logo layouts'})})).json();
 const snapshot=await call('/api/product-library/image/p',{headers:{'X-S7-Task-Id':task.id}}),baseAssetUrl=snapshot.headers.get('X-S7-Task-Asset');await snapshot.arrayBuffer();
 const pixels=Buffer.alloc(16*16*4);for(let y=4;y<12;y++)for(let x=2;x<14;x++)pixels[(y*16+x)*4+3]=255;
 const logoImage=(await sharp(pixels,{raw:{width:16,height:16,channels:4}}).png().toBuffer()).toString('base64');
 const logoLayouts=['one','two'].map((logoId,index)=>{
  const targets=[{id:'saved',masterZoneId:'body',masterLocked:true,moveEnabled,x:index===0?.35:.65,y:.5,widthRatio:.2,rotation:0}];
  return {logoId,targets,schemes:createSchemes(targets).schemes};
 });
 const response=await call('/api/ai-render-logos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId:task.id,productId:'p',baseAssetUrl,model:'test',selectedVersions:['BLACK'],logos:['one','two'].map(id=>({id,name:id,logoImage})),logoLayouts})});
 assert.equal(response.status,202,response.ok?'':await response.text());await response.text();
 let job;for(let n=0;n<100;n++){job=await(await call(`/api/my-space/tasks/${task.id}/generation`)).json();if(job.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.equal(job.status,'complete');assert.equal(job.outputs.length,2);
 assert.deepEqual(calls.map(input=>input.targets[0].x).sort((a,b)=>a-b),[.35,.65]);
 assert.ok(calls.every(input=>input.targets[0].moveEnabled===moveEnabled));
}));
