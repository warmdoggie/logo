import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {writeFileSync,existsSync,readFileSync} from 'node:fs';import {join} from 'node:path';
export function ruleAuth(db,dataDir){
 const hash=s=>createHash('sha256').update(s).digest('hex');
 if(!db.prepare('SELECT username FROM RuleUser LIMIT 1').get()){
  const accountFile=join(dataDir,'规则管理账号.txt');
  const old=existsSync(accountFile)?readFileSync(accountFile,'utf8'):'';
  const savedPassword=username=>old.match(new RegExp(`账号：${username}\\r?\\n密码：([^\\r\\n]+)`))?.[1]?.trim();
  const accounts=[['admin','ADMIN'],['designer','DESIGNER']].map(([username,role])=>({username,role,password:savedPassword(username)||randomBytes(12).toString('base64url'),salt:randomBytes(16).toString('hex')}));
  const text='规则管理本机账号\r\n\r\n'+accounts.map(a=>`${a.role==='ADMIN'?'管理员':'设计师'}\r\n账号：${a.username}\r\n密码：${a.password}`).join('\r\n\r\n')+'\r\n\r\n在规则中心点击“登录”。未登录为业务模式，只能预审和确认警告，不能修改规则。\r\n请妥善保管此文件。其他人不应共用管理员账号。\r\n';
  writeFileSync(join(dataDir,'规则管理账号.txt'),'\ufeff'+text,{flag:'wx'});
  db.exec('BEGIN');try{for(const a of accounts)db.prepare('INSERT INTO RuleUser VALUES (?,?,?,?)').run(a.username,a.role,a.salt,scryptSync(a.password,a.salt,64).toString('hex'));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 }
 const failures=new Map();
 function actor(req){const match=(req.headers.cookie||'').match(/(?:^|;\s*)rule_session=([a-f0-9]+)/);if(!match)return {username:'业务工作台',role:'BUSINESS'};const row=db.prepare('SELECT u.username,u.role FROM RuleSession s JOIN RuleUser u ON s.username=u.username WHERE s.tokenHash=? AND s.expiresAt>?').get(hash(match[1]),Date.now());return row||{username:'业务工作台',role:'BUSINESS'};}
 function requireRole(user,roles){if(!roles.includes(user.role))throw Object.assign(new Error('当前角色无权执行此操作，请使用相应账号登录'),{status:403});}
 function login(input,res){const username=String(input?.username||'').slice(0,80),password=String(input?.password||'');const f=failures.get(username);if(f&&f.until>Date.now())throw Object.assign(new Error('登录尝试过多，请 5 分钟后再试'),{status:429});const row=db.prepare('SELECT * FROM RuleUser WHERE username=?').get(username);if(password.length>200||!row||!timingSafeEqual(scryptSync(password,row.salt,64),Buffer.from(row.passwordHash,'hex'))){const n=(f?.n||0)+1;failures.set(username,{n,until:n>=5?Date.now()+300000:0});throw Object.assign(new Error('账号或密码不正确'),{status:401});}failures.delete(username);const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM RuleSession WHERE expiresAt<?').run(Date.now());db.prepare('INSERT INTO RuleSession VALUES (?,?,?)').run(hash(token),username,Date.now()+12*3600000);res.setHeader('Set-Cookie',`rule_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);return {username,role:row.role};}
 function logout(req,res){const match=(req.headers.cookie||'').match(/(?:^|;\s*)rule_session=([a-f0-9]+)/);if(match)db.prepare('DELETE FROM RuleSession WHERE tokenHash=?').run(hash(match[1]));res.setHeader('Set-Cookie','rule_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return {username:'业务工作台',role:'BUSINESS'};}
 return {actor,requireRole,login,logout};
}
