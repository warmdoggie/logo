import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import sharp from 'sharp';
import {DatabaseSync} from 'node:sqlite';
import {LocalStorage} from './storage.mjs';
import * as accounts from './workspace-auth.mjs';

test('单用户兼容模式不因数据库残留用户表而阻断生成队列',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE TaskOwner(taskId TEXT,userId TEXT); CREATE TABLE WorkspaceUser(id TEXT,username TEXT,role TEXT,disabled INTEGER);');
 try{assert.equal(accounts.withTaskOwner(db,'legacy-task',()=> 'allowed'),'allowed');}finally{db.close();}
});

test('队列从前一用户回调启动另一用户任务时，生成文件仍归任务所属用户',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'queue-owner-'));const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE Task(id TEXT PRIMARY KEY); INSERT INTO Task VALUES (\'alice-task\'),(\'bob-task\');');
 const storage=new LocalStorage(join(dir,'uploads')),auth=accounts.workspaceAuth(db,dir,storage,{enabled:true});
 const alice=auth.createUser('alice','Alice-pass-123'),bob=auth.createUser('bob','Bob-pass-12345');
 db.prepare('UPDATE TaskOwner SET userId=? WHERE taskId=?').run(alice.id,'alice-task');db.prepare('UPDATE TaskOwner SET userId=? WHERE taskId=?').run(bob.id,'bob-task');
 try{const run=accounts.withTaskOwner||((_db,_task,fn)=>fn());let file;
  await accounts.requestScope.run({user:alice},async()=>{await Promise.resolve();await run(db,'bob-task',async()=>{await Promise.resolve();file=storage.put(Buffer.from('private'),'png');});});
  assert.equal(db.prepare('SELECT userId FROM WorkspaceFileOwner WHERE fileKey=?').get(file).userId,bob.id);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});

test('用户登录、账号管理、任务和文件隔离、共享图库以及重启持久化',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'workspace-users-'));let child,base;
 async function start(){child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:'0',APP_DATA_DIR:dir,APP_NO_SEED:'1',APP_MULTI_USER:'1'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{let text='';child.stdout.on('data',chunk=>{text+=chunk;const m=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});child.once('exit',code=>reject(Error('startup '+code)));child.once('error',reject);setTimeout(()=>reject(Error('startup timeout')),10000).unref();});}
 async function stop(){const ended=once(child,'exit');child.kill();await ended;}
 const call=(path,cookie='',data,method=data===undefined?'GET':'POST')=>fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(data instanceof FormData?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:data instanceof FormData?data:JSON.stringify(data)})});
 async function login(username,password){const r=await call('/api/auth/login','',{username,password});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
 try{
  await start();assert.equal((await call('/api/tasks')).status,401);
  const password=(await readFile(join(dir,'workspace-admin.txt'),'utf8')).match(/密码：([^\r\n]+)/)[1];
  let admin=await login('admin',password);
  assert.equal((await call('/api/auth/users',admin,{username:'alice',password:'Alice-pass-123'})).status,201);
  assert.equal((await call('/api/auth/users',admin,{username:'bob',password:'Bob-pass-12345'})).status,201);
  const alice=await login('alice','Alice-pass-123'),bob=await login('bob','Bob-pass-12345');
  assert.equal((await call('/api/auth/users',alice)).status,403);
  const image=await sharp({create:{width:10,height:10,channels:4,background:'#ff0000'}}).png().toBuffer();
  const form=new FormData();for(const [k,v]of Object.entries({sku:'SHARED',name:'共享产品',category:'测试'}))form.set(k,v);form.set('image',new Blob([image]),'product.png');
  assert.equal((await call('/api/products',alice,form)).status,403);
  const product=await(await call('/api/products',admin,form)).json();assert.ok(product.id);
  const catalog=await(await call('/api/products',bob)).json();assert.equal(catalog.length,1);
  assert.equal((await call('/api/manage/products/'+product.id,bob)).status,403);
  assert.equal((await call('/files/'+catalog[0].standardImage,alice)).status,200);
  assert.equal((await call('/files/'+catalog[0].standardImage+'?preview=1',alice)).status,200);
  const logoForm=new FormData();logoForm.set('file',new Blob([image]),'brand-logo.png');logoForm.set('name','品牌 Logo V1');const savedLogo=await call('/api/logo-library',alice,logoForm);assert.equal(savedLogo.status,201);const logo=await savedLogo.json();assert.equal(logo.name,'品牌 Logo V1');
  assert.equal((await(await call('/api/logo-library',alice)).json()).length,1);assert.deepEqual(await(await call('/api/logo-library',bob)).json(),[]);
  assert.equal((await call(logo.imageUrl,alice)).status,200);assert.equal((await call(logo.imageUrl,bob)).status,404);
  const renamed=await call('/api/logo-library/'+logo.id,alice,{name:'新品牌名称'},'PATCH');assert.equal(renamed.status,200);assert.equal((await renamed.json()).name,'新品牌名称');
  assert.equal((await call('/api/logo-library/'+logo.id,bob,{name:'越权修改'},'PATCH')).status,404);
  assert.equal((await call('/api/logo-library/'+logo.id,bob,undefined,'DELETE')).status,404);
  assert.equal((await call('/api/logo-library/'+logo.id,alice,undefined,'DELETE')).status,200);
  const task=new FormData();task.set('customerName','Alice私有');task.set('productIds',JSON.stringify([product.id]));task.set('logo',new Blob([image]),'private.png');
  const created=await call('/api/tasks',alice,task);assert.equal(created.status,201);const {id}=await created.json();
  const detail=await(await call('/api/tasks/'+id,alice)).json();assert.equal((await(await call('/api/tasks',bob)).json()).length,0);
  for(const path of ['/api/tasks/'+id,'/api/logo/'+id,'/api/batch/'+id,'/api/automatic/'+id,'/api/transparent/'+id,'/api/workspace/'+id,'/api/ai/tasks/'+id,'/api/rule-review/'+id,'/api/manage/tasks/'+id+'/delete-preview','/files/'+detail.logo.filePath])assert.equal((await call(path,bob)).status,404,path);
  assert.equal((await call('/api/render',bob,{taskId:id})).status,404);
  assert.equal((await call('/files/'+detail.logo.filePath,alice)).status,200);
  assert.equal((await call('/files/'+detail.logo.filePath+'?preview=1',alice)).status,200);
  assert.equal((await call('/files/'+detail.logo.filePath+'?preview=1',bob)).status,404);
  assert.equal((await fetch(base+'/files/'+detail.logo.filePath+'?preview=1')).status,401);
  assert.deepEqual(await(await call('/api/batch-summary',bob)).json(),[]);
  assert.equal((await call('/api/manage/storage',bob)).status,403);
  assert.equal((await call('/api/rule-auth',alice,{username:'admin',password})).status,403);
  const accountsBefore=await(await call('/api/auth/users',admin)).json();
  const aliceId=accountsBefore.find(user=>user.username==='alice').id;
  assert.equal((await call('/api/auth/users/'+aliceId,bob,{canEditProducts:true})).status,403);
  assert.equal((await call('/api/auth/users/'+aliceId,admin,{canEditProducts:true})).status,200);
  assert.equal((await call('/api/auth/session',alice)).status,200);
  assert.equal((await(await call('/api/auth/session',alice)).json()).canEditProducts,true);
  assert.equal((await call('/api/auth/users',alice)).status,403);
  assert.equal((await call('/api/manage/storage',alice)).status,403);
  assert.equal((await call('/api/manage/products/'+product.id,alice)).status,200);
  assert.equal((await call('/api/manage/products/'+product.id,bob)).status,403);
  const editable=await(await call('/api/manage/products/'+product.id,alice)).json();
  assert.equal((await call('/api/manage/products/'+product.id,alice,{sku:editable.sku,name:'已修改',category:editable.category,status:'ACTIVE',baseRevision:editable.revision})).status,200);
  const otherProduct=new FormData();for(const [k,v]of Object.entries({sku:'NEWPRODUCT',name:'新产品',category:'测试'}))otherProduct.set(k,v);otherProduct.set('image',new Blob([image]),'product.png');
  assert.equal((await call('/api/products',alice,otherProduct)).status,201);
  const zones=[{zoneType:'logo',name:'Logo 区',x:.1,y:.1,width:.4,height:.4,defaultAnchorX:.3,defaultAnchorY:.3,maxLogoWidthRatio:.7,maxLogoHeightRatio:.3,defaultRotation:0,allowRotation:false,orientation:'horizontal',isDefault:true,note:''}];
  assert.equal((await call('/api/templates/'+product.id,bob,{zones,baseVersion:0,changeNote:'首次发布'})).status,403);
  assert.equal((await call('/api/templates/'+product.id,alice,{zones,baseVersion:0,changeNote:'首次发布'})).status,201);
  const bobTask=new FormData();bobTask.set('customerName','Bob私有');bobTask.set('productIds',JSON.stringify([product.id]));bobTask.set('logo',new Blob([image]),'private.png');
  const bobId=(await(await call('/api/tasks',bob,bobTask)).json()).id;assert.ok(bobId);
  assert.equal((await call('/api/tasks/'+bobId,alice)).status,404);
  assert.equal((await call('/api/rule-policies',alice,{})).status,403);
  assert.equal((await call('/api/products',alice,form)).status,409);
  await stop();await start();admin=await login('admin',password);
  const relogin=await login('alice','Alice-pass-123');assert.equal((await call('/api/tasks/'+id,relogin)).status,200);
  assert.equal((await(await call('/api/auth/session',relogin)).json()).canEditProducts,true);
  assert.equal((await call('/api/auth/users/'+aliceId,admin,{canEditProducts:false})).status,200);
  assert.equal((await call('/api/manage/products/'+product.id,relogin)).status,403);
  const users=await(await call('/api/auth/users',admin)).json();const user=users.find(u=>u.username==='alice');
  assert.equal((await call('/api/auth/users/'+user.id,admin,{disabled:true})).status,200);
  assert.equal((await call('/api/tasks',relogin)).status,401);
 }finally{if(child&&child.exitCode===null)await stop();await rm(dir,{recursive:true,force:true});}
});
