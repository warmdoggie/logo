import {randomBytes,randomUUID,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {writeFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';

export const requestScope=new AsyncLocalStorage();
const isolatedDatabases=new WeakSet();
const fail=(message,status)=>{throw Object.assign(Error(message),{status});};
const hash=value=>createHash('sha256').update(value).digest('hex');
export function withTaskOwner(db,taskId,run){
 if(!isolatedDatabases.has(db))return run();
 const user=db.prepare("SELECT u.id,u.username,u.role FROM TaskOwner o JOIN WorkspaceUser u ON u.id=o.userId WHERE o.taskId=? AND u.disabled=0 AND u.approvalStatus='APPROVED'").get(taskId);
 if(!user)throw Object.assign(Error('任务用户不存在或已停用'),{status:403});
 return requestScope.run({user},run);
}
export function workspaceAuth(db,data,storage,{enabled=process.env.APP_MULTI_USER==='1'}={}){
 if(!enabled)return null;
 isolatedDatabases.add(db);
 db.exec(`CREATE TABLE IF NOT EXISTS WorkspaceUser(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,role TEXT NOT NULL CHECK(role IN ('ADMIN','USER')),salt TEXT NOT NULL,passwordHash TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0,createdAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS WorkspaceSession(tokenHash TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES WorkspaceUser(id),expiresAt INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS TaskOwner(taskId TEXT PRIMARY KEY REFERENCES Task(id) ON DELETE CASCADE,userId TEXT NOT NULL REFERENCES WorkspaceUser(id));
 CREATE TABLE IF NOT EXISTS WorkspaceFileOwner(fileKey TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES WorkspaceUser(id));
 CREATE INDEX IF NOT EXISTS idx_TaskOwner_user ON TaskOwner(userId);`);
 if(!db.prepare('PRAGMA table_info(WorkspaceUser)').all().some(column=>column.name==='approvalStatus'))db.exec("ALTER TABLE WorkspaceUser ADD COLUMN approvalStatus TEXT NOT NULL DEFAULT 'APPROVED' CHECK(approvalStatus IN ('PENDING','APPROVED','REJECTED'))");
 if(!db.prepare('PRAGMA table_info(WorkspaceUser)').all().some(column=>column.name==='canEditProducts'))db.exec('ALTER TABLE WorkspaceUser ADD COLUMN canEditProducts INTEGER NOT NULL DEFAULT 0 CHECK(canEditProducts IN (0,1))');
 function createUser(username,password,role='USER',approvalStatus='APPROVED'){
  if(typeof username!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,39}$/.test(username))fail('账号需为 3–40 位字母、数字、点、横线或下划线',400);
  if(typeof password!=='string'||password.length<12||password.length>200)fail('密码需为 12–200 位',400);
  if(db.prepare('SELECT id FROM WorkspaceUser WHERE username=?').get(username))fail('账号已存在',409);
  const id=randomUUID(),salt=randomBytes(16).toString('hex');
  db.prepare('INSERT INTO WorkspaceUser (id,username,role,salt,passwordHash,disabled,createdAt,approvalStatus) VALUES (?,?,?,?,?,0,?,?)').run(id,username,role,salt,scryptSync(password,salt,64).toString('hex'),new Date().toISOString(),approvalStatus);return {id,username,role,approvalStatus};
 }
 let admin=db.prepare("SELECT id FROM WorkspaceUser WHERE role='ADMIN' ORDER BY createdAt LIMIT 1").get();
 if(!admin){const password=randomBytes(18).toString('base64url');admin=createUser('admin',password,'ADMIN');writeFileSync(join(data,'workspace-admin.txt'),`管理员账号：admin\n密码：${password}\n首次登录后请修改密码并妥善保管。\n`,{flag:'wx',mode:0o600});}
 db.prepare('INSERT OR IGNORE INTO TaskOwner SELECT id,? FROM Task').run(admin.id);
 // Existing private files belong to the administrator. Shared product references are checked separately.
 if(existsSync(storage.root))for(const key of readdirSync(storage.root))db.prepare('INSERT OR IGNORE INTO WorkspaceFileOwner VALUES (?,?)').run(key,admin.id);
 storage.onPut=key=>{const user=requestScope.getStore()?.user;if(!user)fail('缺少文件所属用户',401);db.prepare('INSERT INTO WorkspaceFileOwner VALUES (?,?)').run(key,user.id);};
 const publicUser=row=>({id:row.id,username:row.username,role:row.role,disabled:!!row.disabled,approvalStatus:row.approvalStatus,canEditProducts:!!row.canEditProducts});
 const token=req=>(req.headers.cookie||'').match(/(?:^|;\s*)workspace_session=([a-f0-9]{64})(?:;|$)/)?.[1];
 function actor(req){const value=token(req);if(!value)return null;const row=db.prepare("SELECT u.* FROM WorkspaceSession s JOIN WorkspaceUser u ON u.id=s.userId WHERE s.tokenHash=? AND s.expiresAt>? AND u.disabled=0 AND u.approvalStatus='APPROVED'").get(hash(value),Date.now());return row?publicUser(row):null;}
 function requireUser(req){const user=actor(req);if(!user)fail('请先登录',401);return user;}
 function requireAdmin(user){if(user?.role!=='ADMIN')fail('仅管理员可执行此操作',403);}
 function ownTask(user,id){if(!db.prepare('SELECT taskId FROM TaskOwner WHERE taskId=? AND userId=?').get(id,user.id))fail('任务不存在',404);}
 function ownFile(user,key){
  const shared=db.prepare('SELECT 1 FROM Product WHERE standardImage=? UNION SELECT 1 FROM ProductTemplate WHERE standardImage=? UNION SELECT 1 FROM ProductImageVersion WHERE imagePath=? LIMIT 1').get(key,key,key);
  if(!shared&&!db.prepare('SELECT 1 FROM WorkspaceFileOwner WHERE fileKey=? AND userId=?').get(key,user.id))fail('文件不存在',404);
 }
 const failures=new Map();
 const registrations=new Map();
 function register(req,input){
  const remote=req.socket.remoteAddress,key=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)&&req.headers['x-real-ip']?String(req.headers['x-real-ip']):remote;
  const previous=registrations.get(key),entry=previous?.until>Date.now()?previous:{count:0,until:Date.now()+3600000};
  if(entry.count>=10)fail('注册申请过多，请一小时后再试',429);
  if(registrations.size>10000)registrations.clear();entry.count++;registrations.set(key,entry);
  return createUser(input?.username,input?.password,'USER','PENDING');
 }
 function cookie(res,value,age){res.setHeader('Set-Cookie',`workspace_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.APP_PUBLIC_ORIGIN?.startsWith('https:')?'; Secure':''}`);}
 function login(req,res,input){
  const username=String(input?.username||'').slice(0,80),password=String(input?.password||'');
  const key=req.socket.remoteAddress+'|'+username,f=failures.get(key);if(f?.until>Date.now())fail('登录尝试过多，请 5 分钟后再试',429);
  const row=db.prepare('SELECT * FROM WorkspaceUser WHERE username=?').get(username);
  const digest=scryptSync(password.slice(0,201),row?.salt||'invalid-user',64);
  if(!row||row.disabled||password.length>200||!timingSafeEqual(digest,Buffer.from(row.passwordHash,'hex'))){if(failures.size>10000)failures.clear();const count=(f?.count||0)+1;failures.set(key,{count,until:count>=5?Date.now()+300000:0});fail('账号或密码不正确',401);}
  if(row.approvalStatus==='PENDING')fail('账号正在等待管理员审核，请审核通过后登录',403);
  if(row.approvalStatus==='REJECTED')fail('注册申请未通过审核，请联系管理员',403);
  failures.delete(key);const previous=token(req);if(previous)db.prepare('DELETE FROM WorkspaceSession WHERE tokenHash=?').run(hash(previous));const value=randomBytes(32).toString('hex');db.prepare('DELETE FROM WorkspaceSession WHERE expiresAt<?').run(Date.now());db.prepare('INSERT INTO WorkspaceSession VALUES (?,?,?)').run(hash(value),row.id,Date.now()+12*3600000);cookie(res,value,43200);return publicUser(row);
 }
 function logout(req,res){const value=token(req);if(value)db.prepare('DELETE FROM WorkspaceSession WHERE tokenHash=?').run(hash(value));cookie(res,'',0);return {ok:true};}
 function reviewUser(actor,id,decision){
  requireAdmin(actor);if(!['APPROVED','REJECTED'].includes(decision))fail('审核决定无效',400);
  const row=db.prepare('SELECT role,approvalStatus FROM WorkspaceUser WHERE id=?').get(id);if(!row)fail('账号不存在',404);
  if(row.role!=='USER'||row.approvalStatus!=='PENDING')fail('该账号不处于待审核状态，请刷新列表',409);
  const result=db.prepare("UPDATE WorkspaceUser SET approvalStatus=? WHERE id=? AND approvalStatus='PENDING'").run(decision,id);
  if(!result.changes)fail('该申请已被审核，请刷新列表',409);
  db.prepare('DELETE FROM WorkspaceSession WHERE userId=?').run(id);return {ok:true};
 }
 function updateUser(actor,id,input){
  requireAdmin(actor);const row=db.prepare('SELECT * FROM WorkspaceUser WHERE id=?').get(id);if(!row)fail('账号不存在',404);
  if(row.role==='ADMIN'&&input.disabled===true)fail('不能停用管理员',400);
  if(input.canEditProducts!==undefined&&typeof input.canEditProducts!=='boolean')fail('产品图库权限格式不正确',400);
  if(input.password!==undefined){if(typeof input.password!=='string'||input.password.length<12||input.password.length>200)fail('密码需为 12–200 位',400);const salt=randomBytes(16).toString('hex');db.prepare('UPDATE WorkspaceUser SET salt=?,passwordHash=? WHERE id=?').run(salt,scryptSync(input.password,salt,64).toString('hex'),id);}
  if(input.disabled!==undefined){if(typeof input.disabled!=='boolean')fail('账号状态格式不正确',400);db.prepare('UPDATE WorkspaceUser SET disabled=? WHERE id=?').run(Number(input.disabled),id);}
  if(input.canEditProducts!==undefined)db.prepare('UPDATE WorkspaceUser SET canEditProducts=? WHERE id=?').run(Number(input.canEditProducts),id);
  if(input.password!==undefined||input.disabled!==undefined)db.prepare('DELETE FROM WorkspaceSession WHERE userId=?').run(id);return {ok:true};
 }
 function guard(user,path,method){
  if(path.startsWith('/files/'))return ownFile(user,decodeURIComponent(path.slice(7)));
  if(!path.startsWith('/api/'))return;
  const match=path.match(/^\/api\/(?:tasks|logo|transparent|automatic|batch|workspace|rule-review|task-products)\/([^/]+)/)||path.match(/^\/api\/(?:ai\/tasks|manage\/tasks)\/([^/]+)/);
  if(match)return ownTask(user,decodeURIComponent(match[1]));
  if(path.startsWith('/api/logo-rule-facts/')){const row=db.prepare('SELECT taskId FROM ProductionLogo WHERE id=?').get(decodeURIComponent(path.split('/')[3]));return ownTask(user,row?.taskId||'');}
  if(path==='/api/logo-library'||path.startsWith('/api/logo-library/'))return;
  if(path==='/api/rule-auth'){if(method!=='GET')fail('请使用工作空间账号登录，不能切换规则账号',403);return;}
  if(path.startsWith('/api/manage/products/')){if(!user.canEditProducts)requireAdmin(user);return;}
  if(path==='/api/tasks'||path==='/api/batch-summary'||path==='/api/ai/status'||path==='/api/render')return;
  if(path==='/api/products/batch'||path==='/api/rules/meta')return;
  if(/^\/api\/(?:products|templates)(?:\/|$)/.test(path)){if(method!=='GET'&&!user.canEditProducts)requireAdmin(user);return;}
  if(/^\/api\/(?:rules|rule-policies|product-rule-profile|ai\/surface)(?:\/|$)/.test(path)){if(method!=='GET')requireAdmin(user);return;}
  // Administrative/global APIs are never available to ordinary users.
  requireAdmin(user);
 }
 return {actor,requireUser,requireAdmin,ownTask,ownFile,guard,login,logout,register,reviewUser,createUser,updateUser,
  users:()=>db.prepare('SELECT id,username,role,disabled,approvalStatus,createdAt,canEditProducts FROM WorkspaceUser ORDER BY createdAt').all().map(row=>({...row,canEditProducts:!!row.canEditProducts})),
  claimTask:(id,user)=>db.prepare('INSERT INTO TaskOwner VALUES (?,?)').run(id,user.id),
  visibleTasks:user=>db.prepare('SELECT taskId FROM TaskOwner WHERE userId=?').all(user.id).map(row=>row.taskId)};
}
