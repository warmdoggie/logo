import {readFile,writeFile,rename,open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash,publicEncrypt,constants} from 'node:crypto';
import {uploadArchive,readArchive,createArchivePrefix} from './archive-lib.mjs';
import {createLogoStorageClients} from '/srv/ai-logo/01_Source_Code/logo-oss-client.mjs';

process.umask(0o077);
const root='/var/lib/s7-logo-archive',planFile=root+'/release-plan.json',plan=JSON.parse(await readFile(planFile)),key=await readFile(root+'/encryption.key');
const env=Object.fromEntries((await readFile('/etc/logo-scheduler/app.env','utf8')).split('\n').filter(line=>line.includes('=')&&!line.startsWith('#')).map(line=>{const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1)];}));
const client=await createLogoStorageClients({roleArn:env.LOGO_OSS_STORAGE_ROLE_ARN})(true);
const archivePrefix=createArchivePrefix(plan.stamp);
const recoveryPublicKey=await readFile(root+'/recovery-public.pem'),keyId=createHash('sha256').update(recoveryPublicKey).digest('hex');
const envelope={algorithm:'RSA-OAEP-SHA256',keyId,encryptedKey:publicEncrypt({key:recoveryPublicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key).toString('base64')};
const envelopeBytes=Buffer.from(JSON.stringify(envelope)),envelopeKey=archivePrefix+'key-envelope.json';
await client.put(envelopeKey,envelopeBytes,{timeout:120000});if(!Buffer.from((await client.get(envelopeKey,{timeout:120000})).content).equals(envelopeBytes))throw Error('Key envelope checksum mismatch');
async function exited(child){const [code]=await once(child,'close');if(code!==0)throw Error('Archive subprocess failed: '+code);}
const tar=spawn('tar',['--format=posix','--hard-dereference','--numeric-owner','--one-file-system','-czf','-','-C',plan.root,'--',...plan.names],{stdio:['ignore','pipe','inherit']});
let descriptor;
try{[,descriptor]=await Promise.all([exited(tar),uploadArchive({client,key:archivePrefix+'releases.tar.gz.aes',input:tar.stdout,encryptionKey:key})]);}finally{if(tar.exitCode===null)tar.kill();}
const verifier=spawn('python3',[root+'/verify-tar.py',planFile],{stdio:['pipe','inherit','inherit']});
try{await Promise.all([exited(verifier),readArchive({client,descriptor,encryptionKey:key,output:verifier.stdin})]);}finally{if(verifier.exitCode===null)verifier.kill();}
const manifest={version:1,kind:'release-archive',...plan,archive:descriptor,keyId,envelopeKey,verifiedAt:new Date().toISOString()},bytes=Buffer.from(JSON.stringify(manifest));
const manifestKey=archivePrefix+'release-manifest.json';
await client.put(manifestKey,bytes,{timeout:120000});
if(!Buffer.from((await client.get(manifestKey,{timeout:120000})).content).equals(bytes))throw Error('Manifest checksum mismatch');
const file=root+'/release-verified.json';await writeFile(file+'.tmp',bytes,{mode:0o600});const handle=await open(file+'.tmp','r');await handle.sync();await handle.close();await rename(file+'.tmp',file);const folder=await open(root,'r');await folder.sync();await folder.close();
console.log(JSON.stringify({releaseArchiveVerified:true,folders:plan.names.length,bytes:descriptor.bytes,manifestSha256:createHash('sha256').update(bytes).digest('hex')}));
