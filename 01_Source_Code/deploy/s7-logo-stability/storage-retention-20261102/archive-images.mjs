import {readFile,writeFile,rename,statfs,unlink,open} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createGzip} from 'node:zlib';
import {PassThrough} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {uploadArchive,readArchive,createArchivePrefix} from './archive-lib.mjs';
import {createLogoStorageClients} from './logo-oss-client.mjs';
process.umask(0o077);
const root='/var/lib/s7-logo-archive',release=JSON.parse(await readFile(root+'/release-verified.json')),key=await readFile(root+'/encryption.key');
const inspect=(...args)=>JSON.parse(execFileSync('docker',args,{encoding:'utf8'}));
const containers=inspect('inspect',...execFileSync('docker',['ps','-aq'],{encoding:'utf8'}).trim().split('\n'));
const images=inspect('image','inspect',...new Set(execFileSync('docker',['image','ls','--no-trunc','--format','{{.ID}}'],{encoding:'utf8'}).trim().split('\n')));
const state=await readFile('/srv/frame/releases/state'),stateHash=createHash('sha256').update(state).digest('hex');
if(!state.includes('9a5c85a3f404d65b3770f6b20119a060f056929c')||!state.includes('1a825d2bb9b6896fe940c35fb8ebde0af1cac60b'))throw Error('FRAME release state changed');
const previous=images.find(image=>(image.RepoTags||[]).includes('frame-app:9a5c85a3f404d65b3770f6b20119a060f056929c'));
if(!previous)throw Error('Previous image missing');
const preserved=[...new Set([...containers.map(container=>container.Image),previous.Id])];
const selected=['85822a90d503','a17d50af2800'].map(id=>{const found=images.filter(image=>image.Id.startsWith('sha256:'+id));if(found.length!==1||preserved.includes(found[0].Id))throw Error('Image selection changed');return found[0];});
const env=Object.fromEntries((await readFile('/etc/logo-scheduler/app.env','utf8')).split('\n').filter(line=>line.includes('=')&&!line.startsWith('#')).map(line=>{const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1)];}));
const client=await createLogoStorageClients({roleArn:env.LOGO_OSS_STORAGE_ROLE_ARN})(true);
const archivePrefix=createArchivePrefix(release.stamp);
async function exited(child){const [code]=await once(child,'close');if(code!==0)throw Error('Container archive subprocess failed');}
const save=spawn('docker',['image','save',...selected.map(image=>image.Id)],{stdio:['ignore','pipe','inherit']}),compressed=new PassThrough();
let archive;
try{[,archive]=await Promise.all([exited(save),uploadArchive({client,key:archivePrefix+'old-images.tar.gz.aes',input:compressed,encryptionKey:key}),pipeline(save.stdout,createGzip({level:1}),compressed)]);}finally{if(save.exitCode===null)save.kill();}
const space=await statfs(root);if(space.bavail*space.bsize<archive.bytes+536870912)throw Error('Not enough space to authenticate image recovery');
const authenticated=root+'/images-authenticated.tar.gz';
await readArchive({client,descriptor:archive,encryptionKey:key,output:createWriteStream(authenticated,{flags:'wx',mode:0o600})});
const handle=await open(authenticated,'r+');try{await handle.sync();}finally{await handle.close();}
const load=spawn('docker',['image','load','--quiet','--input',authenticated],{stdio:['ignore','inherit','inherit']});
try{await exited(load);}finally{if(load.exitCode===null)load.kill();}
for(const image of selected)if(inspect('image','inspect',image.Id)[0].Id!==image.Id)throw Error('Container restore mismatch');
const manifest={version:1,kind:'container-image-archive',archive,keyId:release.keyId,envelopeKey:release.envelopeKey,frameStateSha256:stateHash,preserved,selected:selected.map(image=>({id:image.Id,tags:image.RepoTags,digests:image.RepoDigests,bytes:image.Size})),protectedContainers:release.protected.containers,verifiedAt:new Date().toISOString(),dockerLoadVerified:true};
const bytes=Buffer.from(JSON.stringify(manifest)),manifestKey=archivePrefix+'image-manifest.json';
await client.put(manifestKey,bytes,{timeout:120000});if(!Buffer.from((await client.get(manifestKey,{timeout:120000})).content).equals(bytes))throw Error('Image archive manifest checksum mismatch');
await writeFile(root+'/image-verified.json.tmp',bytes,{mode:0o600});await rename(root+'/image-verified.json.tmp',root+'/image-verified.json');
await unlink(authenticated);
console.log(JSON.stringify({imageArchiveVerified:true,dockerLoadVerified:true,images:selected.length,bytes:archive.bytes}));
