import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';
import {createSchemes,ensureMixedSchemes} from './schemes.mjs';
import {masterTargetsFromTemplate} from './product-master.mjs';

async function fixture(t){
 const folder=await mkdtemp(join(tmpdir(),'mixed-default-layouts-'));
 const base=await sharp({create:{width:80,height:40,channels:4,background:'#ccc'}}).png().toBuffer();
 const mark=await sharp({create:{width:6,height:3,channels:4,background:'#cc2211'}}).png().toBuffer();
 const logo=await sharp({create:{width:8,height:5,channels:4,background:'#00000000'}}).composite([{input:mark,left:1,top:1}]).png().toBuffer();
 const template={id:'master',version:1,zones:[{id:'body',zoneType:'logo',name:'产品',x:.15,y:.4,width:.2,height:.2},{id:'box',zoneType:'logo',name:'彩盒',x:.65,y:.4,width:.2,height:.2}],automation:{carriers:[{id:'b',type:'BODY'},{id:'c',type:'CARTON'}],areas:[{zoneId:'body',carrierId:'b',foilProcesses:['GOLD FOIL']},{zoneId:'box',carrierId:'c',foilProcesses:[]}]}};
 const products=['p','q'].map(id=>({id,sku:id,imageBytes:base,template})),targets=masterTargetsFromTemplate(template);
 const server=createDemoServer({spaceDir:folder,authenticate:async()=>({id:'test'}),productCatalog:async()=>products,mockupRenderer:async input=>input.guides.map(g=>({version:g.version,bytes:Buffer.from(g.dataUrl.split(',')[1],'base64')}))});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(folder,{recursive:true,force:true});});
 const call=(path,input)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:input?'POST':'GET',headers:{'content-type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});
 const task=await(await call('/api/my-space/tasks',{title:'mixed defaults'})).json();
 return {call,targets,template,input:{taskId:task.id,baseImage:base.toString('base64'),logoImage:logo.toString('base64'),selectedVersions:['MIX_ORIGINAL_BLACK'],foilRegions:[],model:'local'},wait:async()=>{for(let i=0;i<200;i++){const job=await(await call(`/api/my-space/tasks/${task.id}/generation`)).json();if(job?.status!=='running')return job;await new Promise(r=>setTimeout(r,10));}assert.fail('generation did not finish');}};
}

for(const background of [false,true])test(`new SKU without a captured layout renders ordinary mixed finishes (${background?'background':'stream'})`,async t=>{
 const f=await fixture(t),schemes=ensureMixedSchemes(createSchemes(f.targets),['MIX_ORIGINAL_BLACK']).schemes;
 const response=await f.call('/api/ai-render-multi',{...f.input,background,productIds:['p','q'],productLayouts:[{productId:'p',targets:f.targets,schemes}]});
 if(background){assert.equal(response.status,202);const job=await f.wait();assert.equal(job.status,'complete');assert.deepEqual(job.outputs.map(o=>[o.productId,o.version]).sort(),[['p','MIX_ORIGINAL_BLACK'],['q','MIX_ORIGINAL_BLACK']]);}
 else{assert.equal(response.status,200);const text=await response.text();assert.doesNotMatch(text,/product-error/);assert.match(text, /"completed":2,"failed":0/);}
});

for(const path of ['/api/render','/api/ai-render'])test(`ordinary mixed schemes are completed for existing single targets at ${path}`,async t=>{
 const f=await fixture(t),response=await f.call(path,{...f.input,targets:f.targets,schemes:createSchemes(f.targets).schemes});
 assert.equal(response.status,200,await response.clone().text());
 const result=await response.json();assert.deepEqual(result.outputs.map(o=>o.version),['MIX_ORIGINAL_BLACK']);
});

test('a newly selected logo with no layout inherits an explicit ordinary mixed scheme',async t=>{
 const f=await fixture(t),response=await f.call('/api/ai-render-logos',{...f.input,productId:'p',logos:['a','b'].map(id=>({id,name:id,logoImage:f.input.logoImage}))});
 assert.equal(response.status,202,await response.clone().text());
 const job=await f.wait();assert.equal(job.status,'complete');assert.equal(job.outputs.length,2);assert.ok(job.outputs.every(o=>o.version==='MIX_ORIGINAL_BLACK'));
});

test('adding a foil combination to an old scheme still checks the actual master permissions',async t=>{
 const f=await fixture(t),response=await f.call('/api/ai-render-multi',{...f.input,background:true,selectedVersions:['MIX_SILVER_ORIGINAL'],productIds:['p','q'],productLayouts:[{productId:'p',targets:f.targets,schemes:createSchemes(f.targets).schemes}]});
 assert.equal(response.status,422);assert.equal((await response.json()).code,'FOIL_BLOCKED');
});
