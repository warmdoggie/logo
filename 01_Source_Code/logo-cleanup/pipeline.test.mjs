import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createCleanupHandler} from './server.mjs';
import {createCleanupProvider} from './provider.mjs';

test('one automatic HTTP action runs real OCR, one image generation and local repair before saving the result',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'cleanup-pipeline-'));
  const configPath=join(dataDir,'config.json');
  await writeFile(configPath,JSON.stringify({provider:'APIMART',endpoint:'https://api.apimart.ai',apiKey:'test-only'}));
  const generated=await readFile(new URL('./fixtures/pink-lipsticks-ai.jpg',import.meta.url));
  let generations=0,downloads=0;
  const provider=createCleanupProvider({configPath,pollIntervalMs:0,transport:async(url,options)=>{
    if(String(url)==='https://api.apimart.ai/v1/images/generations'){
      generations++;const input=JSON.parse(options.body);
      assert.equal(input.model,'gpt-image-2.5-flare');assert.equal(input.n,1);assert.equal(input.image_urls.length,1);assert.ok(input.mask_url);
      return Response.json({data:[{task_id:'single-generation'}]});
    }
    if(String(url).includes('/v1/tasks/single-generation'))return Response.json({data:{status:'completed',result:{images:[{url:['https://getapib.org/pink-clean.png']}]}}});
    assert.equal(String(url),'https://getapib.org/pink-clean.png');downloads++;return new Response(generated);
  }});
  const server=createServer(createCleanupHandler({dataDir,provider}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}/api/batches`;
  const created=await fetch(base,{method:'POST'});assert.equal(created.status,201);const batch=await created.json();
  const form=new FormData();form.set('file',new File([await readFile(new URL('./fixtures/pink-lipsticks.png',import.meta.url))],'pink.png',{type:'image/png'}));
  const upload=await fetch(`${base}/${batch.id}/images`,{method:'POST',body:form});assert.equal(upload.status,201);
  const item=(await upload.json()).items[0];assert.deepEqual(item.regions,[]);
  const source=Buffer.from(await(await fetch(`${base}/${batch.id}/images/${item.id}/original`)).arrayBuffer());
  assert.equal((await fetch(`${base}/${batch.id}/auto`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,202);
  let done;
  for(let i=0;i<200;i++){
    done=await(await fetch(`${base}/${batch.id}`)).json();if(!done.busy)break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(done.busy,false);assert.equal(done.items[0].status,'done',done.items[0].error);assert.equal(done.items[0].regions.length,4);
  assert.equal(generations,1);assert.equal(downloads,1);
  const response=await fetch(`${base}/${batch.id}/images/${item.id}/result`);assert.equal(response.status,200);
  const bytes=Buffer.from(await response.arrayBuffer()),{data:original,info}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const pixels=await sharp(bytes).ensureAlpha().raw().toBuffer();
  let originalLetters=0,remainingLetters=0,protectedChanges=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
    const offset=(y*info.width+x)*4;
    const inside=done.items[0].regions.some(r=>x>=Math.floor(r.x*info.width)&&x<Math.ceil((r.x+r.width)*info.width)&&y>=Math.floor(r.y*info.height)&&y<Math.ceil((r.y+r.height)*info.height));
    if(!inside){if(!original.subarray(offset,offset+4).equals(pixels.subarray(offset,offset+4)))protectedChanges++;}
    else if(Math.min(...original.subarray(offset,offset+3))>235){originalLetters++;if(Math.min(...pixels.subarray(offset,offset+3))>210)remainingLetters++;}
  }
  assert.ok(originalLetters>1000);assert.equal(remainingLetters,0);assert.equal(protectedChanges,0);
  for(const region of done.items[0].regions){
    const x=Math.floor(region.x*info.width)+1,y=Math.floor(region.y*info.height)+1,offset=(y*info.width+x)*4;
    assert.deepEqual([...pixels.subarray(offset,offset+4)],[...original.subarray(offset,offset+4)],'clean product pixels inside the text box must survive the normal API pipeline');
  }
  const batches=await(await fetch(base)).json();assert.equal(batches[0].items[0].status,'done');
  assert.equal((await fetch(`${base}/${batch.id}/download`)).status,200);
});
