import {createHash,createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {Transform,PassThrough} from 'node:stream';
import {pipeline} from 'node:stream/promises';

function counter(){
 const hash=createHash('sha256');let bytes=0;
 return {stream:new Transform({transform(chunk,encoding,done){hash.update(chunk);bytes+=chunk.length;done(null,chunk);}}),result:()=>({sha256:hash.digest('hex'),bytes})};
}
export function createArchivePrefix(stamp){
 if(!/^\d{8}T\d{6}Z$/.test(stamp||''))throw Error('Invalid archive timestamp');
 return 's7-logo/scheduler-backups/v1/retention/'+stamp+'/'+randomUUID()+'/';
}
export async function uploadArchive({client,key,input,encryptionKey}){
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey,nonce),count=counter(),output=new PassThrough();
 try{await Promise.all([pipeline(input,cipher,count.stream,output),client.putStream(key,output,{timeout:1200000,headers:{'Content-Type':'application/octet-stream'}})]);}
 catch(error){input.destroy(error);cipher.destroy(error);count.stream.destroy(error);output.destroy(error);throw error;}
 return {key,...count.result(),nonce:nonce.toString('hex'),tag:cipher.getAuthTag().toString('hex'),encoding:'aes-256-gcm+tar.gz'};
}
export async function readArchive({client,descriptor,encryptionKey,output}){
 const decipher=createDecipheriv('aes-256-gcm',encryptionKey,Buffer.from(descriptor.nonce,'hex')),count=counter();
 decipher.setAuthTag(Buffer.from(descriptor.tag,'hex'));
 await pipeline((await client.getStream(descriptor.key,{timeout:1200000})).stream,count.stream,decipher,output);
 const actual=count.result();if(actual.sha256!==descriptor.sha256||actual.bytes!==descriptor.bytes)throw Error('Archive checksum mismatch');
}
