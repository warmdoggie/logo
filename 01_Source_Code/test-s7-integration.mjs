import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {test} from 'node:test';

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
    const page=await fetch(base+'/s7/');
    assert.equal(page.status,200);
    assert.match(await page.text(),/S7 Logo Stability/);
    assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'self'/);
    const script=await fetch(base+'/s7/demo.js');
    assert.equal(script.status,200);
    assert.match(await script.text(),/beginResultProgress/);
    for(const file of ['multi-logo.html','multi-logo.js','multi-logo.css','image-preview.mjs']){
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
    const session=await fetch(base+'/s7/api/session',{headers:{cookie}});
    assert.equal(session.status,200);
    assert.equal((await session.json()).user.username,'admin');
    const features=await fetch(base+'/s7/api/features',{headers:{cookie}});
    assert.equal(features.status,200);
    assert.equal((await features.json()).multiLogo,true);
    const task=await fetch(base+'/s7/api/my-space/tasks',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({title:'集成测试任务'})});
    assert.equal(task.status,201);
    assert.equal((await task.json()).title,'集成测试任务');
  }finally{
    child.kill();
    await new Promise(resolve=>child.once('exit',resolve));
    await rm(dir,{recursive:true,force:true});
  }
});
