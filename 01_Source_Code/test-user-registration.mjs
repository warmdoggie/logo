import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {scryptSync} from 'node:crypto';
import {workspaceAuth} from './workspace-auth.mjs';
import {LocalStorage} from './storage.mjs';

test('升级旧账号库保留已有账号权限和停用状态',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'registration-migration-')),db=new DatabaseSync(':memory:');
 try{
  db.exec("CREATE TABLE Task(id TEXT PRIMARY KEY); CREATE TABLE WorkspaceUser(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,role TEXT NOT NULL,salt TEXT NOT NULL,passwordHash TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0,createdAt TEXT NOT NULL);");
  const insert=db.prepare('INSERT INTO WorkspaceUser VALUES (?,?,?,?,?,?,?)');
  for(const [id,username,role,disabled]of [['old-admin','admin','ADMIN',0],['old-user','existing','USER',0],['stopped','stopped','USER',1]])insert.run(id,username,role,'test-salt',scryptSync('Existing-pass-123','test-salt',64).toString('hex'),disabled,'2026-10-01T00:00:00Z');
  const auth=workspaceAuth(db,dir,new LocalStorage(join(dir,'uploads')),{enabled:true}),req={headers:{},socket:{remoteAddress:'127.0.0.1'}},res={setHeader(){}};
  assert.equal(auth.login(req,res,{username:'existing',password:'Existing-pass-123'}).role,'USER');
  assert.equal(auth.login(req,res,{username:'admin',password:'Existing-pass-123'}).role,'ADMIN');
  assert.throws(()=>auth.login(req,res,{username:'stopped',password:'Existing-pass-123'}),error=>error.status===401);
  assert.equal(auth.users().every(user=>user.approvalStatus==='APPROVED'),true);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});

test('Nginx 后的注册频率限制按访客区分，不把所有访客当作同一个本机地址',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'registration-rate-')),db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE Task(id TEXT PRIMARY KEY)');const auth=workspaceAuth(db,dir,new LocalStorage(join(dir,'uploads')),{enabled:true});
  const request=ip=>({headers:{'x-real-ip':ip},socket:{remoteAddress:'127.0.0.1'}});
  for(let attempt=0;attempt<10;attempt++)assert.throws(()=>auth.register(request('203.0.113.1'),{username:'invalid',password:'short'}),error=>error.status===400);
  assert.throws(()=>auth.register(request('203.0.113.1'),{username:'visitor',password:'Visitor-pass-123'}),error=>error.status===429);
  assert.equal(auth.register(request('203.0.113.2'),{username:'visitor',password:'Visitor-pass-123'}).approvalStatus,'PENDING');
  const external={headers:{'x-real-ip':'203.0.113.3'},socket:{remoteAddress:'198.51.100.1'}};
  for(let attempt=0;attempt<10;attempt++){external.headers['x-real-ip']='203.0.113.'+attempt;assert.throws(()=>auth.register(external,{username:'invalid',password:'short'}),error=>error.status===400);}
  assert.throws(()=>auth.register(external,{username:'another',password:'Visitor-pass-123'}),error=>error.status===429,'直接访问的来源不能伪造代理头绕过限制');
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});

test('审核通过默认开启图库与母版编辑，拒绝和后续撤权仍受限制',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'registration-permissions-')),db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE Task(id TEXT PRIMARY KEY)');const storage=new LocalStorage(join(dir,'uploads')),auth=workspaceAuth(db,dir,storage,{enabled:true});
  const req={headers:{},socket:{remoteAddress:'127.0.0.1'}},admin=auth.users().find(user=>user.role==='ADMIN');
  const applicant=auth.register(req,{username:'designer',password:'Designer-pass-123',role:'ADMIN',canEditProducts:true});
  const user=()=>auth.users().find(user=>user.id===applicant.id);
  assert.equal(user().canEditProducts,false);assert.equal(user().approvalStatus,'PENDING');
  assert.throws(()=>auth.reviewUser({role:'USER'},applicant.id,'APPROVED'),error=>error.status===403);
  auth.reviewUser(admin,applicant.id,'APPROVED');assert.equal(user().canEditProducts,true);assert.equal(user().role,'USER');
  for(const path of ['/api/products','/api/templates','/api/manage/products/example'])assert.doesNotThrow(()=>auth.guard(user(),path,'POST'));
  assert.throws(()=>auth.guard(user(),'/api/auth/users','POST'),error=>error.status===403);
  assert.throws(()=>auth.guard(user(),'/api/rules','POST'),error=>error.status===403);
  assert.throws(()=>auth.updateUser(user(),applicant.id,{canEditProducts:true}),error=>error.status===403);
  auth.updateUser(admin,applicant.id,{canEditProducts:false});
  assert.throws(()=>auth.reviewUser(admin,applicant.id,'APPROVED'),error=>error.status===409);
  const restarted=workspaceAuth(db,dir,storage,{enabled:true});assert.equal(restarted.users().find(user=>user.id===applicant.id).canEditProducts,false);
  for(const path of ['/api/products','/api/templates','/api/manage/products/example'])assert.throws(()=>restarted.guard(user(),path,'POST'),error=>error.status===403);
  const rejected=auth.register(req,{username:'rejected',password:'Rejected-pass-123'});auth.reviewUser(admin,rejected.id,'REJECTED');
  assert.equal(auth.users().find(user=>user.id===rejected.id).canEditProducts,false);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});

test('注册必须经管理员审核，拒绝和待审核账号不能获取会话或访问个人数据',{timeout:20000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'registration-'));let child,base;
 async function start(){
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',APP_ALLOWED_HOSTS:'127.0.0.1',APP_DATA_DIR:dir,APP_NO_SEED:'1',APP_MULTI_USER:'1',APP_PUBLIC_ORIGIN:''},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{let output='';child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});child.once('error',reject);child.once('exit',code=>reject(Error('startup '+code)));setTimeout(()=>reject(Error('startup timeout')),10000).unref();});
 }
 async function stop(){const done=once(child,'exit');child.kill();await done;}
 const call=(path,data,cookie='')=>fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const credentials={username:'applicant',password:'Applicant-pass-123'};
 try{
  await start();
  const password=(await readFile(join(dir,'workspace-admin.txt'),'utf8')).match(/密码：([^\r\n]+)/)[1];
  const adminLogin=await call('/api/auth/login',{username:'admin',password});assert.equal(adminLogin.status,200);
  const admin=adminLogin.headers.get('set-cookie').split(';')[0];
  const registration=await call('/api/auth/register',{...credentials,role:'ADMIN',approvalStatus:'APPROVED'});
  assert.equal(registration.status,201,'匿名用户应能申请注册');assert.equal(registration.headers.get('set-cookie'),null);
  const applicant=await registration.json();assert.equal(applicant.role,'USER');assert.equal(applicant.approvalStatus,'PENDING');
  assert.equal('passwordHash' in applicant,false);assert.equal('salt' in applicant,false);
  const pendingLogin=await call('/api/auth/login',credentials);assert.equal(pendingLogin.status,403);assert.match((await pendingLogin.json()).error,/审核/);assert.equal(pendingLogin.headers.get('set-cookie'),null);
  for(const path of ['/api/auth/session','/api/tasks','/api/logo-library','/s7/api/session','/s7/api/my-space/tasks','/files/private.png'])assert.equal((await call(path)).status,401,path);
  assert.equal((await call('/api/auth/register',credentials)).status,409);
  assert.equal((await call('/api/auth/register',{username:'bad',password:'short'})).status,400);
  const existing=await call('/api/auth/users',{username:'existing',password:'Existing-pass-123'},admin);assert.equal(existing.status,201);
  const ordinaryLogin=await call('/api/auth/login',{username:'existing',password:'Existing-pass-123'});assert.equal(ordinaryLogin.status,200);
  const ordinary=ordinaryLogin.headers.get('set-cookie').split(';')[0];
  const review='/api/auth/users/'+applicant.id+'/review';
  assert.equal((await call(review,{decision:'APPROVED'})).status,401);
  assert.equal((await call(review,{decision:'APPROVED'},ordinary)).status,403);
  assert.equal((await call(review,{decision:'ADMIN'},admin)).status,400);
  const users=await(await call('/api/auth/users',undefined,admin)).json();assert.equal(users.find(user=>user.id===applicant.id).approvalStatus,'PENDING');
  assert.equal((await call(review,{decision:'APPROVED'},admin)).status,200);
  assert.equal((await call(review,{decision:'REJECTED'},admin)).status,409,'重复审核不得覆盖已有决定');
  const login=await call('/api/auth/login',credentials);assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const session=await(await call('/api/auth/session',undefined,cookie)).json();assert.equal(session.canEditProducts,true);assert.equal(session.role,'USER');
  const s7=await call('/s7/api/session',undefined,cookie);assert.equal(s7.status,200);assert.equal((await s7.json()).user.id,applicant.id);
  assert.equal((await call('/api/auth/users',undefined,cookie)).status,403);
  const rejected=await(await call('/api/auth/register',{username:'rejected',password:'Rejected-pass-123'})).json();
  assert.equal((await call('/api/auth/users/'+rejected.id+'/review',{decision:'REJECTED'},admin)).status,200);
  const rejectedLogin=await call('/api/auth/login',{username:'rejected',password:'Rejected-pass-123'});assert.equal(rejectedLogin.status,403);assert.match((await rejectedLogin.json()).error,/未通过/);
  const waiting=await(await call('/api/auth/register',{username:'waiting',password:'Waiting-pass-123'})).json();
  const db=new DatabaseSync(join(dir,'assistant.sqlite'));
  try{assert.equal(db.prepare('SELECT COUNT(*) AS count FROM WorkspaceSession WHERE userId=?').get(waiting.id).count,0);assert.equal(db.prepare('SELECT COUNT(*) AS count FROM TaskOwner WHERE userId=?').get(waiting.id).count,0);}finally{db.close();}
  await stop();await start();
  assert.equal((await call('/api/auth/login',credentials)).status,200,'审核通过状态需跨重启保留');
  assert.equal((await call('/api/auth/login',{username:'waiting',password:'Waiting-pass-123'})).status,403);
  assert.equal((await call('/api/auth/login',{username:'rejected',password:'Rejected-pass-123'})).status,403);
 }finally{if(child&&child.exitCode===null)await stop();await rm(dir,{recursive:true,force:true});}
});
