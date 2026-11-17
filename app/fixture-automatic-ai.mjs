import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {sharp} from './logo-pixels.mjs';import {LocalStorage} from './storage.mjs';import {automaticAIService} from './automatic-ai.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function aiFixture({count=1,schemes=1,maxRetries=2,concurrency=2,mode='PROVIDER',generate}={}){
 const dir=mkdtempSync(join(tmpdir(),'automatic-ai-')),db=new DatabaseSync(join(dir,'assistant.sqlite'));db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE Task(id TEXT PRIMARY KEY,activeProductionLogoId TEXT);
 CREATE TABLE TaskProduct(id TEXT PRIMARY KEY,taskId TEXT REFERENCES Task(id));
 CREATE TABLE TaskProductLifecycle(taskProductId TEXT PRIMARY KEY,lifecycle TEXT);
 CREATE TABLE TaskManagement(taskId TEXT PRIMARY KEY,lifecycle TEXT);
 CREATE TABLE ProductionLogo(id TEXT PRIMARY KEY,filePath TEXT);
 CREATE TABLE ProductTemplate(id TEXT PRIMARY KEY,standardImage TEXT);
 CREATE TABLE TaskProductTemplate(taskProductId TEXT PRIMARY KEY,templateId TEXT);
 CREATE TABLE TemplateAutomation(templateId TEXT PRIMARY KEY,definitionJson TEXT);
 CREATE TABLE TemplateZone(id TEXT PRIMARY KEY,templateId TEXT,zoneType TEXT,shapeType TEXT,x REAL,y REAL,width REAL,height REAL,rotation REAL);
 CREATE TABLE AISurfaceConfig(id TEXT PRIMARY KEY,templateAreaId TEXT,version INTEGER,surfaceType TEXT,parameters TEXT);
 CREATE TABLE AutomaticOutput(id TEXT PRIMARY KEY,taskProductId TEXT REFERENCES TaskProduct(id),schemeId TEXT,imagePath TEXT,snapshotJson TEXT);`);
 const storage=new LocalStorage(join(dir,'uploads')),logo=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><rect x="2" y="2" width="15" height="26" fill="black"/><rect x="22" y="2" width="36" height="10" fill="black"/></svg>')).png().toBuffer(),base=await sharp({create:{width:320,height:240,channels:4,background:'#f4dddd'}}).png().toBuffer();
 const logoPath=storage.put(logo,'png'),basePath=storage.put(base,'png');db.prepare('INSERT INTO Task VALUES (?,?)').run('task','logo');db.prepare('INSERT INTO ProductionLogo VALUES (?,?)').run('logo',logoPath);db.prepare('INSERT INTO TaskManagement VALUES (?,?)').run('task','ACTIVE');db.prepare('INSERT INTO ProductTemplate VALUES (?,?)').run('tpl',basePath);db.prepare('INSERT INTO TemplateAutomation VALUES (?,?)').run('tpl',JSON.stringify({carriers:[]}));
 const targets=[.25,.75].map((x,i)=>({areaId:'area'+i,areaName:'区域'+i,zoneId:'zone'+i,carrierId:'body',processType:'NORMAL_PRINT',logoColor:null,placement:{x,y:.5,widthRatio:.15,rotation:0}}));
 targets.forEach((t,i)=>db.prepare('INSERT INTO TemplateZone VALUES (?,?,?,?,?,?,?,?,?)').run(t.zoneId,'tpl','logo','RECT',i*.5+.05,.2,.4,.6,0));
 const outputs=[];for(let i=0;i<count;i++){const tp='tp'+i;db.prepare('INSERT INTO TaskProduct VALUES (?,?)').run(tp,'task');db.prepare('INSERT INTO TaskProductTemplate VALUES (?,?)').run(tp,'tpl');for(let k=0;k<schemes;k++){
  const selected=k===0?targets:[targets[(k-1)%2]],groups=selected.map(t=>`<g transform="translate(${t.placement.x*320},120)"><image x="-24" y="-12" width="48" height="24" href="data:image/png;base64,${logo.toString('base64')}"/></g>`).join('');
  const image=await sharp(base).composite([{input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">${groups}</svg>`)}]).png().toBuffer(),key=storage.put(image,'png');
  const id=randomUUID(),s={taskId:'task',taskProductId:tp,sku:'SKU'+i,schemeId:'scheme'+k,schemeName:'方案'+k,templateId:'tpl',logoId:'logo',imageSha:sha(base),logoSha:sha(logo),outputSha:sha(image),targets:selected,processType:'NORMAL_PRINT',requirementVersion:1};
  db.prepare('INSERT INTO AutomaticOutput VALUES (?,?,?,?,?)').run(id,tp,s.schemeId,key,JSON.stringify(s));outputs.push({id,taskProductId:tp,currentStatus:'CURRENT',imagePath:key,snapshot:s});
 }}
 const state={rule:'rule-v1',allowed:true,revision:1,draft:1,target:0,calls:0,active:0,peak:0};
 const rules={calculateCarrier:async()=>({overallStatus:state.allowed?'PASS':'BLOCK',testOnly:false,fingerprint:state.rule})};
 const automatic={page:()=>({latestOutputs:outputs,requirements:{current:{version:state.revision}},draft:{revision:state.draft},targetOptions:{version:state.target}})};
 const provider={status:()=>({configured:true,provider:'JSON_IMAGE_EDIT_V1',model:'local-test-only',configVersion:'1',maxRetries,concurrency}),generate:async(input,progress)=>{state.calls++;state.active++;state.peak=Math.max(state.peak,state.active);try{return generate?await generate(input,state,progress):{bytes:Buffer.from(input.basisImage,'base64'),metadata:{calls:1}};}finally{state.active--;}}};
 function configure(m=mode){writeFileSync(join(dir,'automatic-ai.local.json'),JSON.stringify({enabled:m!=='OFF',mode:m,configVersion:'1'}));}configure();
 const service=automaticAIService(db,storage,rules,automatic,dir,{provider});
 async function wait(){const end=Date.now()+30000;while(service.isBusy('task')){if(Date.now()>end)throw Error('queue timeout');await new Promise(r=>setTimeout(r,10));}return service.page('task');}
 return {dir,db,storage,state,service,outputs,rules,automatic,provider,configure,wait,close:()=>db.close()};
}
