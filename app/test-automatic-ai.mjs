import {test} from 'node:test';import assert from 'node:assert/strict';import {sharp} from './logo-pixels.mjs';
import {aiFixture} from './fixture-automatic-ai.mjs';import {automaticAIService} from './automatic-ai.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('S7 20 SKU × 3 方案：队列上限、并发幂等、逐目标 QA 和历史原图不变',async()=>{
 const f=await aiFixture({count:20,schemes:3});try{const original=f.outputs.map(o=>f.storage.get(o.imagePath));const input={outputIds:f.outputs.map(o=>o.id)};
 const [a,b]=await Promise.all([f.service.create('task',input),f.service.create('task',input)]);assert.deepEqual(a.jobIds,b.jobIds);const p=await f.wait();assert.equal(p.jobs.length,60);assert.equal(f.state.calls,60);assert.ok(f.state.peak<=2);assert.ok(p.jobs.every(j=>j.status==='PASS'));assert.equal(p.jobs.flatMap(j=>j.attempts[0].qa.targets).length,80);
 await f.service.create('task',input);await f.wait();assert.equal(f.state.calls,60);for(let i=0;i<original.length;i++)assert.deepEqual(f.storage.get(f.outputs[i].imagePath),original[i]);assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{f.close();}
});
test('S7 质量失败有限重试，局部失败不影响其他方案，费用字段脱敏',async()=>{
 const f=await aiFixture({schemes:2,generate:async(input)=>{let bytes=Buffer.from(input.basisImage,'base64');if(input.targets.length===2)bytes=await sharp(bytes).composite([{input:Buffer.from('<svg width="320" height="240"><rect width="20" height="20" fill="red"/></svg>')}]).png().toBuffer();return {bytes,metadata:{calls:1,cost:.1,apiKey:'MUST_NOT_LEAK',raw:'MUST_NOT_LEAK'}};}});
 try{await f.service.create('task',{outputIds:f.outputs.map(o=>o.id)});const p=await f.wait();assert.equal(p.jobs.filter(j=>j.status==='PASS').length,1);const bad=p.jobs.find(j=>j.status==='DESIGNER_REQUIRED');assert.equal(bad.attemptCount,3);assert.equal(bad.resultPath,null);assert.equal(f.state.calls,4);assert.equal(JSON.stringify(p).includes('MUST_NOT_LEAK'),false);assert.ok(bad.attempts[0].qa.reasons.some(r=>r.startsWith('PRODUCT_CHANGE_FAIL')));}finally{f.close();}
});
test('S7 已提交期间规则、要求或配置变化：拒收过期图片',async()=>{
 for(const change of [f=>f.state.rule='v2',f=>f.state.draft++,f=>f.configure('OFF'),f=>f.db.prepare("INSERT INTO TaskProductLifecycle VALUES ('tp0','REMOVED')").run()]){
  let release,entered;const signal=new Promise(r=>entered=r),hold=new Promise(r=>release=r);const f=await aiFixture({generate:async input=>{entered();await hold;return {bytes:Buffer.from(input.basisImage,'base64'),metadata:{calls:1}};}});
  try{await f.service.create('task',{outputIds:[f.outputs[0].id]});await signal;change(f);release();const p=await f.wait();assert.equal(p.jobs[0].resultPath,null);assert.notEqual(p.jobs[0].status,'PASS');assert.equal(f.state.calls,1);}finally{release();await f.wait();f.close();}
 }
});
test('S7 取消不会释放在途写入保护，重启不重发、重复点击不再次扣费',async()=>{
 let release,entered;const signal=new Promise(r=>entered=r),hold=new Promise(r=>release=r);const f=await aiFixture({generate:async input=>{entered();await hold;return {bytes:Buffer.from(input.basisImage,'base64'),metadata:{calls:1}};}});
 try{const a=await f.service.create('task',{outputIds:[f.outputs[0].id]});await signal;f.service.cancel('task',a.jobIds[0]);assert.equal(f.service.isBusy('task'),true);release();await f.wait();assert.equal(f.service.page('task').jobs[0].status,'CANCELLED');await f.service.create('task',{outputIds:[f.outputs[0].id]});await f.wait();assert.equal(f.state.calls,1);
 f.db.prepare("UPDATE AutomaticAIJob SET status='RENDERING'").run();const restarted=automaticAIService(f.db,f.storage,f.rules,f.automatic,f.dir,{provider:f.provider});assert.equal(restarted.page('task').jobs[0].status,'INTERRUPTED');await restarted.create('task',{outputIds:[f.outputs[0].id]});await sleep(30);assert.equal(f.state.calls,1);
 }finally{release();await f.wait();f.close();}
});
test('S7 未配置继续二维；本地模拟不能标记为真实 AI 通过',async()=>{
 const f=await aiFixture({mode:'OFF'});try{let p=await f.service.create('task',{outputIds:[f.outputs[0].id]});assert.equal(p.mode,'TWO_D_ONLY');assert.equal(f.state.calls,0);f.configure('LOCAL_MOCK');await f.service.create('task',{outputIds:[f.outputs[0].id]});p=await f.wait();assert.equal(p.jobs[0].status,'MOCK_PASS');assert.equal(f.state.calls,0);}finally{f.close();}
});
test('S7 模糊接口失败/坏图不无限重试；错误与费用无密钥泄露',async()=>{
 for(const generate of [async()=>{throw Object.assign(Error('API_KEY_SECRET'),{code:'PROVIDER_ERROR'});},async()=>({bytes:Buffer.from('invalid'),metadata:{}})]){
 const f=await aiFixture({generate});try{await f.service.create('task',{outputIds:[f.outputs[0].id]});const p=await f.wait();assert.equal(p.jobs[0].status,'FAILED');assert.equal(f.state.calls,1);assert.equal(JSON.stringify(p).includes('API_KEY_SECRET'),false);await f.service.create('task',{outputIds:[f.outputs[0].id]});await f.wait();assert.equal(f.state.calls,1);}finally{f.close();}}
});
test('S7 无效来源整批拒绝；规则禁止不调用接口',async()=>{
 const f=await aiFixture();try{await assert.rejects(f.service.create('task',{outputIds:[f.outputs[0].id,'missing']}));assert.equal(f.service.page('task').jobs.length,0);f.state.allowed=false;await assert.rejects(f.service.create('task',{outputIds:[f.outputs[0].id]}));assert.equal(f.state.calls,0);}finally{f.close();}
});
test('S7 接口受理后的轮询失败保留服务商任务号，不重发且不保存密钥',async()=>{
 const f=await aiFixture({generate:async(input,state,progress)=>{progress({providerTaskId:'local_job_123',progress:40,calls:1,apiKey:'NEVER_PERSIST'});throw Object.assign(Error('poll error NEVER_PERSIST'),{code:'PROVIDER_ERROR'});}});
 try{await f.service.create('task',{outputIds:[f.outputs[0].id]});const j=(await f.wait()).jobs[0];assert.equal(j.status,'FAILED');assert.equal(j.attempts[0].metadata.providerTaskId,'local_job_123');assert.equal(j.attempts[0].metadata.calls,1);assert.equal(JSON.stringify(j).includes('NEVER_PERSIST'),false);assert.equal(f.state.calls,1);}finally{f.close();}
});
test('S7 平面、轻透视和圆柱正面先确定几何再增强；复杂曲面转人工',async()=>{
 for(const type of ['PERSPECTIVE_FLAT','CYLINDER_FRONT','UNSUPPORTED_COMPLEX']){
  const f=await aiFixture();try{f.db.prepare('INSERT INTO AISurfaceConfig VALUES (?,?,?,?,?)').run('surface','zone0',1,type,JSON.stringify({perspective:.2,curvature:.5}));await f.service.create('task',{outputIds:[f.outputs[0].id]});const p=await f.wait();if(type==='UNSUPPORTED_COMPLEX'){assert.equal(p.jobs[0].status,'DESIGNER_REQUIRED');assert.equal(f.state.calls,0);}else{assert.equal(p.jobs[0].status,'PASS',JSON.stringify(p));assert.equal(p.jobs[0].attempts[0].qa.targets.length,2);assert.notDeepEqual(f.storage.get(p.jobs[0].resultPath),f.storage.get(f.outputs[0].imagePath));}}finally{f.close();}
 }
});
test('S7 逐目标捕获 Logo 内部损坏；保护区极小偏差在交付前精确复原',async()=>{
 for(const damage of [true,false]){const f=await aiFixture({maxRetries:0,generate:async input=>{const {data,info}=await sharp(Buffer.from(input.basisImage,'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});if(damage){for(let y=109;y<119;y++)for(let x=59;x<65;x++)data[(y*320+x)*4]=255;}else data[0]--;return {bytes:await sharp(data,{raw:info}).png().toBuffer(),metadata:{calls:1}};}});try{await f.service.create('task',{outputIds:[f.outputs[0].id]});const j=(await f.wait()).jobs[0];if(damage){assert.equal(j.status,'DESIGNER_REQUIRED');assert.ok(j.attempts[0].qa.targets.some(t=>t.reasons.some(r=>r.startsWith('LOGO_FIDELITY_FAIL'))));}else{assert.equal(j.status,'PASS');const source=await sharp(f.storage.get(f.outputs[0].imagePath)).raw().toBuffer(),result=await sharp(f.storage.get(j.resultPath)).raw().toBuffer();assert.deepEqual(source,result);}}finally{f.close();}}
});
