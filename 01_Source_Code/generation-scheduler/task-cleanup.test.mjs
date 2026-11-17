import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,mkdir,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {businessApi} from './business-api.mjs';

for(const offline of [false,true])test(`scheduler cleanup removes online objects, private plans and local files (storage offline: ${offline})`,async t=>{
 const directory=await mkdtemp(join(tmpdir(),'scheduler-cleanup-')),id=randomUUID(),other=randomUUID(),lease=randomUUID(),hash='a'.repeat(64),removed=[],plans=[];
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const descriptor={original:'original',preview:'preview'};
 for(const suffix of ['png','original','storage.json',lease+'.png','original.'+lease+'.tmp'])await writeFile(join(directory,id+'.'+suffix),suffix==='storage.json'?JSON.stringify(descriptor):'image');
 await writeFile(join(directory,other+'.png'),'other');await mkdir(join(directory,'plans'));await writeFile(join(directory,'plans',hash+'.json'),'private inputs');
 const store={purgeTasks:async(user,ids,cleanup)=>{assert.equal(user,'alice');assert.deepEqual(ids,['task']);await cleanup({jobs:[{id}],planHashes:[hash]});return {deleted:1};}};
 const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 const generationStorage={remove:async value=>{if(offline)throw Error('OSS unavailable');removed.push(value);}},planStorage={remove:async value=>plans.push(value)};
 const server=createServer(async(req,res)=>{try{await businessApi(req,res,{store,user:'alice',directory,send,generationStorage,planStorage});}catch(error){send(res,error.status||503,{error:error.message});}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/tasks`,{method:'DELETE',body:JSON.stringify({taskIds:['task']})});
 assert.equal(response.status,offline?503:200);
 if(offline){assert.ok((await readdir(directory)).includes(id+'.storage.json'));assert.deepEqual(plans,[]);}
 else{assert.deepEqual(removed,[descriptor]);assert.deepEqual(plans,[hash]);assert.deepEqual((await readdir(directory)).sort(),[other+'.png','plans'].sort());assert.deepEqual(await readdir(join(directory,'plans')),[]);}
});
