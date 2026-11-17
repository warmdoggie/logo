import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {Readable} from 'node:stream';

const bytes=Buffer.from('{"request":{"prompt":"原图与遮罩","image_urls":["data:image/png;base64,AAAA"]}}');
const hash=createHash('sha256').update(bytes).digest('hex');
const key='s7-logo/scheduler-backups/v1/plans/'+hash+'.json.gz';
async function factory(){
 const module=await import('./logo-plan-storage.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
 assert.equal(typeof module.createPlanStorage,'function','durable plans need a verified OSS store');return module.createPlanStorage;
}
function cloud(objects=new Map()){
 return {objects,async put(key,value){objects.set(key,Buffer.from(value));},async getStream(key){
  if(!objects.has(key))throw Object.assign(Error('missing cloud plan'),{status:404});
  return {stream:Readable.from([objects.get(key)])};
 }};
}
test('cloud plans preserve exact request bytes under their existing fingerprint',async()=>{
 const createPlanStorage=await factory(),remote=cloud(),storage=createPlanStorage({client:async()=>remote});
 await storage.publish(hash,bytes);
 assert.deepEqual(gunzipSync(remote.objects.get(key)),bytes);
 assert.deepEqual(await storage.read(hash),bytes);
});
test('cloud readback corruption rejects publication before it can be acknowledged',async()=>{
 const createPlanStorage=await factory(),remote=cloud();remote.put=async()=>remote.objects.set(key,gzipSync(Buffer.from('{}')));
 await assert.rejects(createPlanStorage({client:async()=>remote}).publish(hash,bytes),/checksum/i);
});
test('invalid plan fingerprints never reach OSS',async()=>{
 const createPlanStorage=await factory();let calls=0;
 const storage=createPlanStorage({client:async()=>{calls++;return cloud();}});
 await assert.rejects(storage.read('../escape'),/hash/i);
 await assert.rejects(storage.publish('0'.repeat(64),bytes),/checksum/i);
 assert.equal(calls,0);
});


test('plan cleanup deletes only a validated content-addressed plan',async()=>{
 const {createPlanStorage}=await import('./logo-plan-storage.mjs');
 const deleted=[],storage=createPlanStorage({client:async()=>({delete:async key=>deleted.push(key)})});
 assert.equal(typeof storage.remove,'function');await storage.remove('a'.repeat(64));
 assert.deepEqual(deleted,['s7-logo/scheduler-backups/v1/plans/'+'a'.repeat(64)+'.json.gz']);
 await assert.rejects(storage.remove('../other'),/Invalid/);assert.equal(deleted.length,1);
});
