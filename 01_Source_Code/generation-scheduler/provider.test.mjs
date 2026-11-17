import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createProvider} from './provider.mjs';

test('persisted business plans submit their original image request once',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'scheduler-provider-'));
 try{
  const path=join(directory,'config.json');await writeFile(path,JSON.stringify({provider:'APIMART',endpoint:'https://api.apimart.ai',apiKey:'test-never-sent'}));
  const request={model:'gpt-image-2',prompt:'print fixture',n:1,images:['data:image/png;base64,AA==']};
  const plan=JSON.stringify({request}),hash=createHash('sha256').update(plan).digest('hex');
  await mkdir(join(directory,'plans'));await writeFile(join(directory,'plans',hash+'.json'),plan);
  let calls=0;const provider=createProvider({directory,configPath:path,transport:async(url,options)=>{
   calls++;assert.equal(String(url),'https://api.apimart.ai/v1/images/generations');assert.deepEqual(JSON.parse(options.body),request);
   return Response.json({data:[{task_id:'remote-1'}]});
  }});
  assert.equal(typeof provider.prepare,'function','the plan must load before recording a paid submission');
  const params={batchId:'batch',planHash:hash},prepared=await provider.prepare(params);assert.equal(calls,0);
  await rm(join(directory,'plans',hash+'.json'));
  assert.deepEqual(await provider.submit(params,prepared),{taskId:'remote-1'});assert.equal(calls,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});
