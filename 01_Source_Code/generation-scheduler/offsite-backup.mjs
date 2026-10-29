import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {appModule} from './plans.mjs';

const directory='/var/backups/logo-scheduler';
const config=Object.fromEntries((await readFile('/etc/logo-scheduler/app.env','utf8')).split('\n').filter(line=>line&&!line.startsWith('#')&&line.includes('=')).map(line=>{const index=line.indexOf('=');return [line.slice(0,index),line.slice(index+1)];}));
if(!config.LOGO_OSS_STORAGE_ROLE_ARN){console.log('OFFSITE_BACKUP_NOT_CONFIGURED');process.exit(0);}
process.env.LOGO_OSS_STORAGE_ROLE_ARN=config.LOGO_OSS_STORAGE_ROLE_ARN;
process.env.APP_CODE_DIRECTORY=config.APP_CODE_DIRECTORY;
try{
 const {uploadSchedulerBackup}=await import(appModule('logo-scheduler-backup.mjs'));
 const result=await uploadSchedulerBackup({directory,stamp:process.argv[2]});
 const file=join(directory,'last-offsite-success.json'),pending=file+'.tmp';
 await writeFile(pending,JSON.stringify({...result,time:new Date().toISOString()}),{mode:0o600});await rename(pending,file);
 console.log('SCHEDULER_OFFSITE_BACKUP_READBACK_VERIFIED');
}catch{console.error('SCHEDULER_OFFSITE_BACKUP_FAILED');process.exitCode=1;}
