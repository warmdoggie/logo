import {readFile,writeFile,rename,unlink,mkdir,open,lstat} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createCipheriv,createDecipheriv,randomBytes,createHash,publicEncrypt,constants} from 'node:crypto';
import {Transform,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {join} from 'node:path';
import {uploadDataSnapshot} from './logo-data-snapshot.mjs';
import {createLogoStorageClients} from './logo-oss-client.mjs';

process.umask(0o077);
const root='/var/lib/s7-logo-archive',stage=process.argv[2],stamp=process.argv[3];
if(stage!==root+'/snapshot-'+stamp||!/^\d{8}T\d{6}Z$/.test(stamp))throw Error('Invalid snapshot path');
if((await lstat(root)).mode&0o077)throw Error('Snapshot registry must be private');
const key=await readFile(root+'/encryption.key'),publicKey=await readFile(root+'/recovery-public.pem');
const config=Object.fromEntries((await readFile('/etc/logo-scheduler/app.env','utf8')).split('\n').filter(line=>line.includes('=')&&!line.startsWith('#')).map(line=>{const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1)];}));
const client=createLogoStorageClients({roleArn:config.LOGO_OSS_STORAGE_ROLE_ARN}),remote=await client(true);
for(const name of ['scheduler.dump','workspace.sqlite']){
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce),file=join(stage,'database',name),encrypted=file+'.aes',plainHash=createHash('sha256'),cipherHash=createHash('sha256');
 await pipeline(createReadStream(file),new Transform({transform(chunk,encoding,done){plainHash.update(chunk);done(null,chunk);}}),cipher,new Transform({transform(chunk,encoding,done){cipherHash.update(chunk);done(null,chunk);}}),createWriteStream(encrypted,{flags:'wx',mode:0o600}));
 const plainSha256=plainHash.digest('hex'),blobKey='s7-logo/scheduler-backups/v1/blobs/'+cipherHash.digest('hex');
 await remote.put(blobKey,encrypted,{timeout:120000});
 const decipher=createDecipheriv('aes-256-gcm',key,nonce),readHash=createHash('sha256');decipher.setAuthTag(cipher.getAuthTag());
 await pipeline((await remote.getStream(blobKey,{timeout:120000})).stream,decipher,new Writable({write(chunk,encoding,done){readHash.update(chunk);done();}}));
 if(readHash.digest('hex')!==plainSha256)throw Error('Cloud database restore checksum mismatch');
 await writeFile(encrypted+'.json',JSON.stringify({algorithm:'aes-256-gcm',plainSha256,cloudDecryptionVerified:true,nonce:nonce.toString('hex'),tag:cipher.getAuthTag().toString('hex'),keyId:createHash('sha256').update(publicKey).digest('hex'),keyEnvelope:{algorithm:'RSA-OAEP-SHA256',encryptedKey:publicEncrypt({key:publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key).toString('base64')}}),{flag:'wx',mode:0o600});
 await unlink(file);
}
const roots=Object.fromEntries(['database','results','archives','workspace','uploads'].map(label=>[label,join(stage,label)]));
const planHashes=(await readFile(stage+'/plan-hashes.txt','utf8')).trim().split('\n').filter(Boolean);
const manifest=await uploadDataSnapshot({roots,stamp,planHashes,client});
const file=root+'/snapshot-'+stamp+'.json';await writeFile(file+'.tmp',JSON.stringify(manifest),{mode:0o600});const handle=await open(file+'.tmp','r+');try{await handle.sync();}finally{await handle.close();}await rename(file+'.tmp',file);
const status={stamp,manifest:file,manifestKey:manifest.manifestKey,files:manifest.files.length,plans:planHashes.length,verified:true,time:new Date().toISOString()};
await writeFile(root+'/snapshot-success.json.tmp',JSON.stringify(status),{mode:0o600});await rename(root+'/snapshot-success.json.tmp',root+'/snapshot-success.json');
await writeFile('/var/backups/logo-scheduler/last-success.json.tmp',JSON.stringify({...status,restoredInIsolatedDatabase:true,immutablePlansVerified:true}),{mode:0o600});await rename('/var/backups/logo-scheduler/last-success.json.tmp','/var/backups/logo-scheduler/last-success.json');
await writeFile('/var/backups/logo-scheduler/last-offsite-success.json.tmp',JSON.stringify(status),{mode:0o600});await rename('/var/backups/logo-scheduler/last-offsite-success.json.tmp','/var/backups/logo-scheduler/last-offsite-success.json');
console.log('CLOUD_SNAPSHOT_VERIFIED '+JSON.stringify(status));
