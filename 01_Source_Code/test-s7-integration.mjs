import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {test} from 'node:test';
import sharp from 'sharp';
import {createSchemes} from './s7-logo-stability/schemes.mjs';
import {copyProductPreset} from './s7-logo-stability/product-preset.mjs';

const root=process.cwd();

test('主工作区同一端口直接提供 S7 页面、静态资源和 API', {timeout:15000}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),'s7-main-integration-'));
  const probe=createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',APP_DATA_DIR:dir,APP_NO_SEED:'1',APP_MULTI_USER:'1',APP_PUBLIC_ORIGIN:'',S7_SPACE_DIR:join(dir,'user-spaces'),S7_AI_CONFIG:join(dir,'ai-provider.json')},stdio:'ignore'});
  const base=`http://127.0.0.1:${port}`;
  try{
    let ready=false;
    for(let attempt=0;attempt<40;attempt++){
      if(child.exitCode!==null)break;
      try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)})).ok){ready=true;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    assert.equal(ready,true,'主工作区应在测试端口启动');
    const previewScript=await fetch(base+'/preview-fetch.js');
    assert.equal(previewScript.status,200,'登录前也应能加载主界面依赖的预览脚本');
    assert.match(previewScript.headers.get('content-type'),/javascript/);
    assert.match(await previewScript.text(),/export function installPreviewImageFallback/);
    const page=await fetch(base+'/s7/');
    assert.equal(page.status,200);
    assert.match(await page.text(),/S7 Logo Stability/);
    assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'self'/);
    const script=await fetch(base+'/s7/demo.js');
    assert.equal(script.status,200);
    assert.match(await script.text(),/beginResultProgress/);
    for(const file of ['multi-logo.html','multi-logo.js','multi-logo.css','image-preview.mjs','target-toolbar.mjs','product-preset.mjs']){
      const asset=await fetch(base+'/s7/'+file);
      assert.equal(asset.status,200,`新增资源应由主工作区提供：${file}`);
      assert.ok((await asset.text()).length>0);
    }
    const anonymous=await fetch(base+'/s7/api/session');
    assert.equal(anonymous.status,401);
    const password=(await readFile(join(dir,'workspace-admin.txt'),'utf8')).match(/密码：(.+)/)?.[1].trim();
    assert.ok(password,'集成测试应创建初始管理员凭据');
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password})});
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const original=await sharp({create:{width:1024,height:512,channels:4,background:{r:40,g:60,b:80,alpha:.5}}}).png().toBuffer();
    const form=new FormData();form.set('file',new Blob([original],{type:'image/png'}),'logo.png');
    const uploaded=await fetch(base+'/api/logo-library',{method:'POST',headers:{cookie},body:form});
    assert.equal(uploaded.status,201);
    const logo=await uploaded.json();
    const thumbnail=await fetch(base+logo.imageUrl+'?thumbnail=1',{headers:{cookie}});
    assert.equal(thumbnail.status,200);assert.equal(thumbnail.headers.get('content-type'),'image/webp');
    assert.match(thumbnail.headers.get('cache-control'),/no-store/);
    const meta=await sharp(Buffer.from(await thumbnail.arrayBuffer())).metadata();
    assert.equal(meta.width,192);assert.equal(meta.height,96);assert.equal(meta.hasAlpha,true);
    const full=await fetch(base+logo.imageUrl,{headers:{cookie}});
    assert.deepEqual(Buffer.from(await full.arrayBuffer()),original);
    assert.equal((await fetch(base+logo.imageUrl+'?thumbnail=1')).status,401);
    const session=await fetch(base+'/s7/api/session',{headers:{cookie}});
    assert.equal(session.status,200);
    const sessionUser=(await session.json()).user;assert.equal(sessionUser.username,'admin');
    assert.equal(session.headers.get('X-Workspace-User'),sessionUser.id);
    assert.equal(full.headers.get('X-Workspace-User'),sessionUser.id);
    const features=await fetch(base+'/s7/api/features',{headers:{cookie}});
    assert.equal(features.status,200);
    assert.equal((await features.json()).multiLogo,true);
    const task=await fetch(base+'/s7/api/my-space/tasks',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({title:'集成测试任务'})});
    assert.equal(task.status,201);
    const createdTask=await task.json();
    assert.equal(createdTask.title,'集成测试任务');
    const source=createSchemes([{id:'a',carrierType:'BODY',x:.2,y:.3,widthRatio:.26,rotation:25,color:'#bc2345',preserveOriginalColor:false}]);
    const master={id:'b',masterZoneId:'b-zone',carrierType:'BODY',x:.65,y:.55,widthRatio:.12,rotation:0};
    const destination=createSchemes([{...master,x:.8,y:.8}]),copied=copyProductPreset(source,destination,[master]);
    const state={multiPackageProducts:[{id:'a',sku:'A'},{id:'b',sku:'B'}],multiProductLayouts:[{productId:'b',masterTargets:[master],schemeState:copied,targets:copied.schemes[0].targets,activeScheme:'ORIGINAL',selectedTargetId:'b'}]};
    const saved=await fetch(base+'/s7/api/my-space/tasks/'+createdTask.id,{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({revision:createdTask.revision,state})});
    assert.equal(saved.status,200);
    const restored=await fetch(base+'/s7/api/my-space/tasks/'+createdTask.id,{headers:{cookie}});
    assert.equal(restored.status,200);const layout=(await restored.json()).state.multiProductLayouts[0];
    assert.equal(layout.targets[0].x,.65);assert.equal(layout.targets[0].y,.55);assert.equal(layout.targets[0].widthRatio,.26);assert.equal(layout.targets[0].rotation,25);assert.equal(layout.targets[0].color,'#bc2345');
    assert.equal(layout.targets[0].id,'b');assert.equal(layout.targets[0].masterZoneId,'b-zone');
    assert.equal(layout.masterTargets[0].x,.65);assert.equal(layout.masterTargets[0].widthRatio,.12);
    assert.equal((await fetch(base+'/s7/api/my-space/tasks/'+createdTask.id)).status,401);
  }finally{
    child.kill();
    await new Promise(resolve=>child.once('exit',resolve));
    await rm(dir,{recursive:true,force:true});
  }
});
