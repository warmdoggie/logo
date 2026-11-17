const fail=(m,s=400)=>{throw Object.assign(Error(m),{status:s});};
export function taskRetentionService(db,management,isBusy){
 db.exec(`CREATE TABLE IF NOT EXISTS TaskRetentionPolicy(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL,days INTEGER NOT NULL,revision INTEGER NOT NULL,lastRunAt TEXT);`);
 const policy=()=>db.prepare('SELECT * FROM TaskRetentionPolicy WHERE id=1').get()||{id:1,enabled:0,days:90,revision:0,lastRunAt:null};
 const admin=a=>{if(a?.role!=='ADMIN')fail('请管理员登录后设置任务归档',403);};
 function candidates(at=new Date()){
  const p=policy(),cutoff=at.getTime()-p.days*86400000;
  return db.prepare("SELECT t.id,t.taskCode,t.customerName,m.updatedAt FROM Task t JOIN TaskManagement m ON m.taskId=t.id WHERE m.lifecycle='DELIVERED'").all().filter(t=>{
   if(isBusy(t.id))return false;let recent=Date.parse(t.updatedAt);
   for(const [table,column]of [['AutomaticRun','createdAt'],['CustomerRequirementRevision','createdAt'],['CustomerRequirementDraft','updatedAt'],['TaskTargetOverrides','createdAt'],['AutomaticExport','createdAt'],['CustomerDeliveryArchive','createdAt'],['MockupJob','createdAt'],['AIRenderJob','createdAt'],['AutomaticAIJob','createdAt'],['RuleEvaluationRun','createdAt'],['OriginalLogoVersion','createdAt'],['ProductionLogo','createdAt'],['ColorReference','createdAt'],['ColorSample','createdAt'],['TransparentMaster','createdAt'],['BatchJob','createdAt']]){if(!db.prepare('PRAGMA table_info('+table+')').all().some(c=>c.name===column))continue;const row=db.prepare(`SELECT max(${column}) at FROM ${table} WHERE taskId=?`).get(t.id);if(row.at)recent=Math.max(recent,Date.parse(row.at));}
   return Number.isFinite(recent)&&recent<=cutoff;
  });
 }
 function save(v,a){admin(a);const p=policy();if(v.baseRevision!==p.revision)fail('归档设置已变化，请刷新',409);if(typeof v.enabled!=='boolean'||!Number.isInteger(v.days)||v.days<1||v.days>3650)fail('请选择是否启用，并填写 1–3650 天');db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO TaskRetentionPolicy VALUES (1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,days=excluded.days,revision=excluded.revision').run(Number(v.enabled),v.days,p.revision+1,p.lastRunAt);management.audit('TASK_RETENTION_POLICY','1',{enabled:v.enabled,days:v.days},a);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return page();}
 function run(a,{automatic=false,at=new Date()}={}){if(!automatic)admin(a);const p=policy();if(!p.enabled)return {archived:[],disabled:true};const rows=candidates(at),archived=[];for(const t of rows){if(isBusy(t.id))continue;const state=management.lifecycle(t.id);if(state.lifecycle!=='DELIVERED')continue;management.changeLifecycle(t.id,{baseRevision:state.revision,lifecycle:'ARCHIVED'},a);archived.push(t.id);}db.prepare('UPDATE TaskRetentionPolicy SET lastRunAt=? WHERE id=1').run(at.toISOString());return {archived};}
 function tick(){const p=policy();if(p.enabled&&(!p.lastRunAt||Date.now()-Date.parse(p.lastRunAt)>=86400000))run({username:'系统定期归档',role:'SYSTEM'},{automatic:true});}
 function page(){return {policy:policy(),eligible:candidates(),description:'仅归档已交付且达到保留期限、近期无出图或修稿的任务；保留全部资料。服务启动时补查，运行期间每天检查。'};}
 return {page,save,run,tick};
}
