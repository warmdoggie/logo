import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable,Writable} from 'node:stream';
import {randomBytes} from 'node:crypto';

test('private archives round trip through authenticated streaming encryption and reject corruption',async()=>{
 const {uploadArchive,readArchive}=await import('./archive-lib.mjs');
 const objects=new Map(),client={async putStream(key,input){const chunks=[];for await(const chunk of input)chunks.push(chunk);objects.set(key,Buffer.concat(chunks));},async getStream(key){return {stream:Readable.from([objects.get(key)])};}};
 const key=randomBytes(32),input=Buffer.from('recovery image and private configuration\n'.repeat(1000));
 const descriptor=await uploadArchive({client,key:'test/archive',input:Readable.from([input]),encryptionKey:key});
 assert.equal(objects.get(descriptor.key).includes(Buffer.from('private configuration')),false);
 const chunks=[];await readArchive({client,descriptor,encryptionKey:key,output:new Writable({write(chunk,encoding,done){chunks.push(chunk);done();}})});
 assert.deepEqual(Buffer.concat(chunks),input);
 objects.get(descriptor.key)[5]^=1;
 await assert.rejects(readArchive({client,descriptor,encryptionKey:key,output:new Writable({write(chunk,encoding,done){done();}})}));
});

test('failed streaming PUTs and failed input streams reject without a success descriptor',async()=>{
 const {uploadArchive}=await import('./archive-lib.mjs'),encryptionKey=randomBytes(32);
 await assert.rejects(uploadArchive({client:{async putStream(key,input){for await(const chunk of input)throw Error('network interrupted');}},key:'test/fail',input:Readable.from([Buffer.alloc(1024)]),encryptionKey}),/network interrupted/);
 await assert.rejects(uploadArchive({client:{async putStream(key,input){for await(const chunk of input){}}},key:'test/fail',input:Readable.from((async function*(){yield Buffer.alloc(1024);throw Error('tar failed');})()),encryptionKey}),/tar failed/);
});

test('repeated maintenance runs allocate distinct object prefixes and preserve earlier recovery archives',async()=>{
 const {createArchivePrefix,uploadArchive,readArchive}=await import('./archive-lib.mjs');
 assert.equal(typeof createArchivePrefix,'function');
 const objects=new Map(),client={async putStream(key,input){const chunks=[];for await(const chunk of input)chunks.push(chunk);objects.set(key,Buffer.concat(chunks));},async getStream(key){return {stream:Readable.from([objects.get(key)])};}},encryptionKey=randomBytes(32);
 const first=await uploadArchive({client,key:createArchivePrefix('20261102T020000Z')+'releases.tar.gz.aes',input:Readable.from(['first verified archive']),encryptionKey});
 const second=await uploadArchive({client,key:createArchivePrefix('20261102T020000Z')+'releases.tar.gz.aes',input:Readable.from(['retry archive']),encryptionKey});
 assert.notEqual(first.key,second.key);const chunks=[];
 await readArchive({client,descriptor:first,encryptionKey,output:new Writable({write(chunk,encoding,done){chunks.push(chunk);done();}})});
 assert.equal(Buffer.concat(chunks).toString(),'first verified archive');
 assert.throws(()=>createArchivePrefix('../invalid'),/timestamp/);
});
