import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('workspace exposes cleanup navigation and requires the workspace login for private batch APIs',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cleanup-workspace-'));
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,APP_DATA_DIR:dir,S7_SPACE_DIR:join(dir,'spaces'),APP_NO_SEED:'1',APP_MULTI_USER:'1',PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  try{
    const base=await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(Error('workspace startup timeout')),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timeout);resolve(match[0]);}});child.once('exit',code=>{clearTimeout(timeout);reject(Error('workspace exited '+code));});});
    const page=await(await fetch(base+'/')).text();assert.match(page,/href="#\/modules\/logo-cleanup"/);
    const denied=await fetch(base+'/logo-cleanup/api/batches');assert.equal(denied.status,401);
    const password=(await readFile(join(dir,'workspace-admin.txt'),'utf8')).match(/密码：(\S+)/)?.[1];assert.ok(password);
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password})});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const modulePage=await fetch(base+'/logo-cleanup/',{headers:{cookie}});assert.equal(modulePage.status,200);assert.match(await modulePage.text(),/批量去除 Logo 占位字/);
    const created=await fetch(base+'/logo-cleanup/api/batches',{method:'POST',headers:{cookie}});assert.equal(created.status,201);
    assert.equal((await fetch(base+'/logo-cleanup/client.js',{headers:{cookie}})).status,200);
  }finally{child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));await rm(dir,{recursive:true,force:true});}
});
