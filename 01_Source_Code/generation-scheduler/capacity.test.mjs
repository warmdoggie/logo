import test from 'node:test';
import assert from 'node:assert/strict';
import {hasDiskSpace} from './capacity.mjs';
test('space guard stops new work below reserve and propagates unavailable disk checks',async()=>{
 assert.equal(await hasDiskSpace('/test',2,async()=>({bavail:1024,bsize:1024*1024})),false);
 assert.equal(await hasDiskSpace('/test',2,async()=>({bavail:4096,bsize:1024*1024})),true);
 await assert.rejects(hasDiskSpace('/missing',2,async()=>{throw Error('missing');}),/missing/);
});
