import test from 'node:test';
import assert from 'node:assert/strict';
import {createGenerationWatcher} from './generation-client.mjs';

test('离开页面停止查询，重新进入恢复后台的阶段和逐张结果',async()=>{
 let saved={id:'job',status:'running',stages:{ORIGINAL:{stage:'generating'}},outputs:[]},seen=[];
 const create=()=>createGenerationWatcher({request:async()=>structuredClone(saved),onChange:record=>seen.push(record),onError:error=>{throw error;},interval:5});
 const first=create();await first.refresh();first.stop();assert.equal(seen[0].stages.ORIGINAL.stage,'generating');
 saved={...saved,status:'complete',stages:{ORIGINAL:{stage:'complete'}},outputs:[{version:'ORIGINAL',dataUrl:'/saved.png'}]};
 const second=create();await second.refresh();second.stop();assert.equal(seen.at(-1).outputs[0].dataUrl,'/saved.png');
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(seen.length,2);
});
