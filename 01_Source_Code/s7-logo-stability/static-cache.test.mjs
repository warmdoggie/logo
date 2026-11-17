import test from 'node:test';
import assert from 'node:assert/strict';
import {get} from 'node:http';
import {gunzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {createDemoServer} from './demo-server.mjs';

const request=(url,headers={})=>new Promise((resolve,reject)=>{
 get(url,{headers},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,bytes:Buffer.concat(chunks)}));response.on('error',reject);}).on('error',reject);
});

test('S7 scripts revalidate unchanged content without downloading it again',async()=>{
 const server=createDemoServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const first=await request(base+'/demo.js');
  assert.equal(first.status,200);assert.match(first.headers['cache-control'],/must-revalidate/);assert.ok(first.headers.etag);
  assert.deepEqual(first.bytes,await readFile(new URL('./demo.js',import.meta.url)));
  const unchanged=await request(base+'/demo.js',{'If-None-Match':first.headers.etag});
  assert.equal(unchanged.status,304);assert.equal(unchanged.bytes.length,0);assert.equal(unchanged.headers.etag,first.headers.etag);
  const stale=await request(base+'/demo.js',{'If-None-Match':'W/"previous-release"'});
  assert.equal(stale.status,200);assert.deepEqual(stale.bytes,first.bytes);
  const page=await request(base+'/demo.html');assert.equal(page.headers['cache-control'],'no-store');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('S7 compresses scripts when accepted and preserves the identity response',async()=>{
 const server=createDemoServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const plain=await request(base+'/demo.js',{'Accept-Encoding':'identity'});
  const compressed=await request(base+'/demo.js',{'Accept-Encoding':'gzip'});
  assert.equal(compressed.headers['content-encoding'],'gzip');assert.match(compressed.headers.vary,/Accept-Encoding/i);
  assert.deepEqual(gunzipSync(compressed.bytes),plain.bytes);assert.ok(compressed.bytes.length<plain.bytes.length/2);
  const declined=await request(base+'/demo.js',{'Accept-Encoding':'gzip;q=0, identity'});
  assert.equal(declined.headers['content-encoding'],undefined);assert.deepEqual(declined.bytes,plain.bytes);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
