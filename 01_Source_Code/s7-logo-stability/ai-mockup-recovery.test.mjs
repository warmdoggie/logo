import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createAiMockupRenderer} from './ai-mockup-provider.mjs';

const disconnected=()=>Object.assign(new TypeError('fetch failed'),{cause:{code:'UND_ERR_CONNECT_TIMEOUT',message:'proxy tunnel timed out'}});
async function setup(run){
 const dir=await mkdtemp(join(tmpdir(),'s7-provider-recovery-'));
 try{
  const configPath=join(dir,'provider.json');
  await writeFile(configPath,JSON.stringify({provider:'APIMART',model:'flux-3-image',endpoint:'https://api.apimart.ai',apiKey:'test-key',timeoutMs:1000}));
  const image=await sharp({create:{width:8,height:8,channels:3,background:'#ddd'}}).png().toBuffer();
  const input={onlyVersion:'ORIGINAL',baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',guides:[{version:'ORIGINAL',dataUrl:'data:image/png;base64,GUIDE'}],originalColor:'#000000'};
  await run({configPath,image,input});
 }finally{await rm(dir,{recursive:true,force:true});}
}

test('a failed polling retry group keeps the same submitted task and recovers',()=>setup(async({configPath,image,input})=>{
 let submissions=0,queries=0;
 const render=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async url=>{
  if(String(url).endsWith('/v1/images/generations')){submissions++;return Response.json({data:[{task_id:'task_once'}]});}
  if(String(url).includes('/v1/tasks/')){if(++queries<=3)throw disconnected();return Response.json({data:{status:'completed',result:{images:[{url:'https://getapib.org/result.png'}]}}});}
  return new Response(image);
 }});
 const output=await render(input);
 assert.equal(submissions,1);assert.equal(queries,4);assert.equal(output.length,1);
}));

test('submitted task is checkpointed before polling and resumes after a new renderer starts',()=>setup(async({configPath,image,input})=>{
 const resumeTasks={};let submissions=0;
 const checkpoint=(version,value)=>{if(value)resumeTasks[version]=structuredClone(value);else delete resumeTasks[version];};
 const failed=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async url=>{
  if(String(url).endsWith('/v1/images/generations')){submissions++;return Response.json({data:[{task_id:'task_resume'}]});}
  assert.equal(resumeTasks.ORIGINAL?.taskId,'task_resume');throw disconnected();
 }});
 assert.deepEqual(await failed({...input,onCheckpoint:checkpoint,onStage:()=>{}}),[]);
 assert.equal(resumeTasks.ORIGINAL.taskId,'task_resume');
 const recovered=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async url=>{
  assert.ok(!String(url).endsWith('/v1/images/generations'),'resuming must not submit another billable task');
  if(String(url).includes('/v1/tasks/'))return Response.json({data:{status:'completed',result:{images:[{url:'https://getapib.org/result.png'}]}}});
  return new Response(image);
 }});
 assert.equal((await recovered({...input,resumeTasks,onCheckpoint:checkpoint})).length,1);assert.equal(submissions,1);
 let newSubmissions=0;
 const edited=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async url=>{
  if(String(url).endsWith('/v1/images/generations')){newSubmissions++;return Response.json({data:[{url:'https://getapib.org/new.png'}]});}
  return new Response(image);
 }});
 await edited({...input,logoImage:'data:image/png;base64,EDITED',resumeTasks});assert.equal(newSubmissions,1);
}));

test('a failed image download resumes from its checkpoint without submitting or polling',()=>setup(async({configPath,image,input})=>{
 const resumeTasks={};
 const failed=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async url=>{
  if(String(url).endsWith('/v1/images/generations'))return Response.json({data:[{url:'https://getapib.org/download.png'}]});
  throw new Error('simulated disconnected image');
 }});
 await failed({...input,onCheckpoint:(version,value)=>resumeTasks[version]=value,onStage:()=>{}});
 assert.equal(resumeTasks.ORIGINAL?.imageUrl,'https://getapib.org/download.png');
 const recovered=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async url=>{assert.equal(String(url),'https://getapib.org/download.png');return new Response(image);}});
 assert.equal((await recovered({...input,resumeTasks})).length,1);
}));

test('a temporary non-JSON gateway error does not abandon the submitted task',()=>setup(async({configPath,image,input})=>{
 let submissions=0,queries=0;
 const render=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async url=>{
  if(String(url).endsWith('/v1/images/generations')){submissions++;return Response.json({data:[{task_id:'task_gateway'}]});}
  if(String(url).includes('/v1/tasks/'))return ++queries===1?new Response('Bad Gateway',{status:502}):Response.json({data:{status:'completed',result:{images:[{url:'https://getapib.org/recovered.png'}]}}});
  return new Response(image);
 }});
 assert.equal((await render(input)).length,1);assert.equal(submissions,1);assert.equal(queries,2);
}));

test('an image waiting in the download queue gets a fresh timeout after its turn starts',()=>setup(async({configPath,image,input})=>{
 const config=JSON.parse(await readFile(configPath,'utf8'));await writeFile(configPath,JSON.stringify({...config,timeoutMs:3000}));
 let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 const first=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async url=>{
  if(String(url).endsWith('/v1/images/generations'))return Response.json({data:[{url:'https://getapib.org/first.png'}]});
  enter();await gate;return new Response(image);
 }})(input);
 await entered;await writeFile(configPath,JSON.stringify({...config,timeoutMs:1000}));
 const second=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async(url,options)=>{
  if(String(url).endsWith('/v1/images/generations'))return Response.json({data:[{url:'https://getapib.org/second.png'}]});
  assert.equal(options.signal.aborted,false);return new Response(image);
 }})(input);
 try{await new Promise(r=>setTimeout(r,1100));}finally{release();}
 assert.equal((await first).length,1);assert.equal((await second).length,1);
}));
