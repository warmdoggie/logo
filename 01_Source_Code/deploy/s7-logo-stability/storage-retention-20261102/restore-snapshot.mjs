import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createDecipheriv,createHash} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {join,dirname,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {restoreDataSnapshot} from './logo-data-snapshot.mjs';
import {createLogoStorageClients} from './logo-oss-client.mjs';
import {createPlanStorage} from './logo-plan-storage.mjs';
import {readPlan} from '/srv/logo-scheduler/plans.mjs';
import {userSpace} from '/srv/ai-logo/01_Source_Code/s7-logo-stability/user-space.mjs';
process.umask(0o077);
const root='/var/lib/s7-logo-archive',status=JSON.parse(await readFile(root+'/snapshot-success.json'));
if(!/^\d{8}T\d{6}Z$/.test(status.stamp)||status.manifest!==root+'/snapshot-'+status.stamp+'.json')throw Error('Invalid snapshot registry');
const manifestBytes=await readFile(status.manifest),manifest=JSON.parse(manifestBytes),key=await readFile(root+'/encryption.key');
const selected=new Map(),add=file=>{if(file)selected.set(file.root+'/'+file.path,file);};
for(const file of manifest.files)if(file.root==='database'||(file.root==='workspace'&&file.path.endsWith('.json')))add(file);
const raw=manifest.files.filter(file=>file.root==='results'&&/^plans\/[a-f0-9]{64}\.json$/.test(file.path)).sort((a,b)=>a.bytes-b.bytes)[0];
const zipped=manifest.files.filter(file=>file.root==='archives'&&/^[a-f0-9]{64}\.json\.gz$/.test(file.path)).sort((a,b)=>a.bytes-b.bytes)[0];add(raw);add(zipped);
const asset=manifest.files.filter(file=>file.root==='workspace'&&/\/tasks\/[^/]+\/assets\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(file.path)).sort((a,b)=>a.bytes-b.bytes)[0];
const image=manifest.files.filter(file=>file.root==='workspace'&&/^[^/]+\/[a-f0-9-]{36}\/image-\d+\.png$/.test(file.path)).sort((a,b)=>b.bytes-a.bytes)[0];add(asset);add(image);
const base=root+'/snapshot-drill-'+status.stamp;await mkdir(base,{mode:0o700});
const roots=Object.fromEntries(['database','workspace','uploads','results','archives'].map(label=>[label,join(base,label)]));
const config=Object.fromEntries((await readFile('/etc/logo-scheduler/app.env','utf8')).split('\n').filter(line=>line.includes('=')&&!line.startsWith('#')).map(line=>{const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1)];}));
const client=createLogoStorageClients({roleArn:config.LOGO_OSS_STORAGE_ROLE_ARN});
const cloudPlan=manifest.remotePlans?.[0]?.hash;
const planHashes=[...new Set([...([raw,zipped].filter(Boolean).map(file=>basename(file.path).split('.')[0])),...(cloudPlan?[cloudPlan]:[])])];
await restoreDataSnapshot({manifest:{...manifest,files:[...selected.values()],planHashes},roots,client});
if(cloudPlan)await readPlan(roots.results,cloudPlan,{storage:createPlanStorage({client})});
for(const name of ['scheduler.dump','workspace.sqlite']){
 const file=join(roots.database,name),metadata=JSON.parse(await readFile(file+'.aes.json')),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(metadata.nonce,'hex')),hash=createHash('sha256');
 decipher.setAuthTag(Buffer.from(metadata.tag,'hex'));
 await pipeline(createReadStream(file+'.aes'),decipher,new Transform({transform(chunk,encoding,done){hash.update(chunk);done(null,chunk);}}),createWriteStream(file,{flags:'wx',mode:0o600}));
 if(hash.digest('hex')!==metadata.plainSha256)throw Error('Restored database plaintext checksum mismatch');
}
const drill='scheduler_cloud_restore_'+process.pid;
execFileSync('docker',['exec','logo-scheduler-postgres','createdb','-U','scheduler',drill]);
let databaseVerified=false;
try{
 execFileSync('docker',['exec','-i','logo-scheduler-postgres','pg_restore','--exit-on-error','-U','scheduler','-d',drill],{input:await readFile(join(roots.database,'scheduler.dump'))});
 const counts=execFileSync('docker',['exec','logo-scheduler-postgres','psql','-v','ON_ERROR_STOP=1','-U','scheduler','-d',drill,'-Atc','SELECT count(*) FROM jobs; SELECT count(*) FROM job_events; SELECT count(*) FROM scheduler_account;'],{encoding:'utf8'});
 if(counts.trim()!==(await readFile(join(roots.database,'restore-counts.txt'),'utf8')).trim())throw Error('Restored scheduler row counts differ');
 const sqlite=execFileSync('python3',['-c','import sqlite3,sys;db=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True);assert db.execute("PRAGMA integrity_check").fetchone()[0]=="ok";print("ok")',join(roots.database,'workspace.sqlite')],{encoding:'utf8'});if(sqlite.trim()!=='ok')throw Error('Restored workspace database failed integrity check');
 databaseVerified=true;
}finally{execFileSync('docker',['exec','logo-scheduler-postgres','dropdb','--if-exists','-U','scheduler',drill]);}
const spaces=userSpace(roots.workspace);let taskAssetVerified=false,resultImageVerified=false;
if(asset){const parts=asset.path.split('/'),bytes=(await spaces.taskAsset({id:parts[0]},parts[2],parts[4])).bytes;if(createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error('Restored task logo differs');taskAssetVerified=true;}
if(image){const parts=image.path.split('/'),record=JSON.parse(await readFile(join(roots.workspace,parts[0],parts[1],'record.json'))),bytes=await spaces.image({id:parts[0]},parts[1],parts[2],record.taskId);if(createHash('sha256').update(bytes).digest('hex')!==image.sha256)throw Error('Restored generated image differs');const history=await spaces.history({id:parts[0]},record.taskId);if(!history.some(item=>item.id===record.id))throw Error('Restored history is missing');resultImageVerified=true;}
if(!asset||!image||(!cloudPlan&&(!raw||!zipped)))throw Error('Restore sample does not cover all required data types');
const report={stamp:status.stamp,manifestSha256:createHash('sha256').update(manifestBytes).digest('hex'),sampleFilesRestored:selected.size,totalFilesBackedUp:manifest.files.length,totalPlanHashesBackedUp:manifest.planHashes.length,samplePlanHashesVerified:planHashes.length,databaseVerified,taskAssetVerified,resultImageVerified,historyVerified:true,rawAndGzipPlansRestored:!!(raw&&zipped),cloudPlanReadVerified:!!cloudPlan,time:new Date().toISOString()};
await writeFile(root+'/snapshot-restore-verified.json.tmp',JSON.stringify(report),{mode:0o600});await rename(root+'/snapshot-restore-verified.json.tmp',root+'/snapshot-restore-verified.json');
if(dirname(base)!==root||!/^snapshot-drill-\d{8}T\d{6}Z$/.test(basename(base)))throw Error('Invalid restore cleanup path');await rm(base,{recursive:true});
console.log('CUSTOMER_AND_SCHEDULER_RESTORE_VERIFIED '+JSON.stringify(report));
