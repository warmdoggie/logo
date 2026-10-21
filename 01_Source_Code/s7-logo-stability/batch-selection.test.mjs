import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';

for(const background of [true,false])test(`multi-product ${background?'background':'streaming'} generation sends only selected versions to the model`,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-selection-')),requests=[];
 const image=await sharp({create:{width:32,height:32,channels:4,background:'#777'}}).png().toBuffer();
 const products=['a','b'].map(id=>({id,sku:id,name:id,imageBytes:image,template:{zones:[{id:'body',zoneType:'logo',x:.3,y:.3,width:.2,height:.1}]}}));
 const server=createDemoServer({spaceDir:dir,authenticate:async()=>({id:'alice'}),productCatalog:async()=>products,mockupRenderer:async input=>{requests.push(input.selectedVersions);return input.selectedVersions.map(version=>({version,bytes:image}));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const call=(path,data)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:data?'POST':'GET',headers:{'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 try{
  const task=await(await call('/api/my-space/tasks',{title:'selected batch'})).json();
  const response=await call('/api/ai-render-multi',{background,taskId:task.id,productIds:['a','b'],logoImage:image.toString('base64'),model:'test',selectedVersions:['BLACK','SILVER FOIL']});
  assert.equal(response.status,background?202:200);
  if(background){
   let job;for(let i=0;i<200;i++){job=await(await call(`/api/my-space/tasks/${task.id}/generation`)).json();if(job.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
   assert.equal(job.status,'complete');assert.equal(job.outputs.length,4);assert.equal(Object.keys(job.stages).length,4);
  }else{
   const stream=await response.text();assert.equal((stream.match(/"complete":true/g)||[]).length,2);
  }
  assert.deepEqual(requests,[['BLACK','SILVER FOIL'],['BLACK','SILVER FOIL']]);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
