import {readFile,statfs,writeFile,rename,unlink,open} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {readArchive} from './archive-lib.mjs';
import {createLogoStorageClients} from './logo-oss-client.mjs';
process.umask(0o077);
const root='/var/lib/s7-logo-archive',bytes=await readFile(root+'/image-verified.json'),manifest=JSON.parse(bytes),key=await readFile(root+'/encryption.key');
const space=await statfs(root);if(space.bavail*space.bsize<manifest.archive.bytes+536870912)throw Error('Not enough image recovery space');
const config=Object.fromEntries((await readFile('/etc/logo-scheduler/app.env','utf8')).split('\n').filter(line=>line.includes('=')&&!line.startsWith('#')).map(line=>{const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1)];}));
const remote=await createLogoStorageClients({roleArn:config.LOGO_OSS_STORAGE_ROLE_ARN})(true),file=root+'/images-authenticated.tar.gz';
await readArchive({client:remote,descriptor:manifest.archive,encryptionKey:key,output:createWriteStream(file,{flags:'wx',mode:0o600})});
const handle=await open(file,'r+');try{await handle.sync();}finally{await handle.close();}
const child=spawn('docker',['image','load','--quiet','--input',file],{stdio:['ignore','inherit','inherit']});
try{const [code]=await once(child,'close');if(code!==0)throw Error('Image recovery failed');}finally{if(child.exitCode===null)child.kill();}
for(const selected of manifest.selected)if(JSON.parse(execFileSync('docker',['image','inspect',selected.id],{encoding:'utf8'}))[0].Id!==selected.id)throw Error('Restored image ID mismatch');
const report={manifestSha256:createHash('sha256').update(bytes).digest('hex'),archiveSha256:manifest.archive.sha256,authenticatedBeforeDockerLoad:true,images:manifest.selected.map(image=>image.id),time:new Date().toISOString()};
await writeFile(root+'/image-authenticated-restore.json.tmp',JSON.stringify(report),{mode:0o600});await rename(root+'/image-authenticated-restore.json.tmp',root+'/image-authenticated-restore.json');await unlink(file);
console.log('IMAGE_AUTHENTICATED_RESTORE_VERIFIED');
