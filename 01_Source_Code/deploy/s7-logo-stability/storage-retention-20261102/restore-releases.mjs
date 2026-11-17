import {readFile,writeFile,rename,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readArchive} from './archive-lib.mjs';
import {createLogoStorageClients} from '/srv/ai-logo/01_Source_Code/logo-oss-client.mjs';
const root='/var/lib/s7-logo-archive',manifestFile=root+'/release-verified.json',manifestBytes=await readFile(manifestFile),manifest=JSON.parse(manifestBytes);
const env=Object.fromEntries((await readFile('/etc/logo-scheduler/app.env','utf8')).split('\n').filter(line=>line.includes('=')&&!line.startsWith('#')).map(line=>{const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1)];}));
const remote=await createLogoStorageClients({roleArn:env.LOGO_OSS_STORAGE_ROLE_ARN})(true);
const child=spawn('python3',[root+'/restore-tar.py',manifestFile,process.argv[2],process.argv[3]],{stdio:['pipe','inherit','inherit']});
try{await Promise.all([(async()=>{const [code]=await once(child,'close');if(code!==0)throw Error('Archive restore failed');})(),readArchive({client:remote,descriptor:manifest.archive,encryptionKey:await readFile(root+'/encryption.key'),output:child.stdin})]);}finally{if(child.exitCode===null)child.kill();}
const content=JSON.parse(await readFile(process.argv[3]+'/RESTORE-CONTENT-VERIFIED.json'));
if(content.folder!==process.argv[2]||content.allArchiveEntriesVerified!==Object.keys(manifest.entries).length)throw Error('Restore content report mismatch');
const file=process.argv[3]+'/RESTORE-VERIFIED.json',report={...content,manifestSha256:createHash('sha256').update(manifestBytes).digest('hex'),archiveSha256:manifest.archive.sha256,authenticationVerified:true};
await writeFile(file+'.tmp',JSON.stringify(report),{mode:0o600});const handle=await open(file+'.tmp','r+');try{await handle.sync();}finally{await handle.close();}await rename(file+'.tmp',file);
console.log('RELEASE_RESTORE_AUTHENTICATION_VERIFIED');
