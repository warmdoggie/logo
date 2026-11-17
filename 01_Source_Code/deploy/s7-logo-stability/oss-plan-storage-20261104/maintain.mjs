import {readFile,chown,statfs,stat} from 'node:fs/promises';
import {hostname} from 'node:os';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {migratePlans,restorePlans} from '../../../generation-scheduler/plan-maintenance.mjs';
import {createPlanStorage} from '../../../logo-plan-storage.mjs';
import {createLogoStorageClients} from '../../../logo-oss-client.mjs';

if(process.getuid?.()!==0||hostname()!=='iZf8zjczn9o390i523upydZ')throw Error('Approved LOGO ECS root session required');
process.umask(0o077);
const mode=process.argv[2]||'inventory';
if(!['inventory','publish','evict','verify','restore'].includes(mode))throw Error('Invalid plan storage maintenance mode');
const directory='/var/lib/logo-scheduler/results',archives='/var/lib/logo-scheduler/completed-plan-archives',receiptFile=join(directory,'plan-storage-migration.json');
if(mode==='inventory'){
 console.log(JSON.stringify(await migratePlans({directory,archives})));process.exit(0);
}
const config=Object.fromEntries((await readFile('/etc/logo-scheduler/app.env','utf8')).split('\n').filter(line=>line.includes('=')&&!line.startsWith('#')).map(line=>{const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1)];}));
const storage=createPlanStorage({client:createLogoStorageClients({roleArn:config.LOGO_OSS_STORAGE_ROLE_ARN})});
if(['publish','evict'].includes(mode)){
 console.log(JSON.stringify(await migratePlans({directory,archives,storage,receiptFile,mode})));process.exit(0);
}
const query="SELECT DISTINCT params->>'planHash' FROM jobs WHERE params ? 'planHash' ORDER BY 1";
const hashes=execFileSync('docker',['exec','logo-scheduler-postgres','psql','-v','ON_ERROR_STOP=1','-U','scheduler','-d','scheduler','-Atc',query],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
let required=0;for(const hash of hashes)required+=(await storage.verify(hash)).bytes;
if(mode==='restore'){
 const disk=await statfs(directory);if(disk.bavail*disk.bsize<required+2*1024**3)throw Error('Insufficient space to restore all raw plans with reserve');
 const report=await restorePlans({directory,hashes,storage});
 const {uid,gid}=await stat(join(directory,'plans'));
 for(const hash of hashes)await chown(join(directory,'plans',hash+'.json'),uid,gid);
 console.log(JSON.stringify(report));
}else{
 const {readPlan}=await import('/srv/logo-scheduler/plans.mjs');
 for(const hash of hashes)await readPlan(directory,hash,{storage});
 console.log(JSON.stringify({plans:hashes.length,cloudBytesVerified:required,productionReaderVerified:true}));
}
