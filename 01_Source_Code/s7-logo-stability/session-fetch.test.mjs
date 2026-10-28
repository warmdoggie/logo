import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('./demo.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
function client(nativeFetch,selection={}){
 let expired=0;
 const c=vm.createContext({nativeFetch,s7User:{id:'alice'},currentTaskId:'task',s7Path:value=>'/s7'+value,requireLogin:()=>expired++,refreshHistory:async()=>{},taskLogos:[],loadedTaskLogoId:null,multiProductViews:new Map(),loadedMultiProductId:null,...selection});
 vm.runInContext(source.slice(source.indexOf('const fetch=async('),source.indexOf('\n{\n',source.indexOf('const fetch=async(')))+'\nglobalThis.request=fetch;',c);
 return {request:c.request,expired:()=>expired,context:c};
}

test('已携带账号标识的业务响应直接使用，不再串行查询登录状态',async()=>{
 const calls=[],c=client(async url=>{calls.push(url);return new Response('{}',{headers:{'X-Workspace-User':'alice'}});});
 await Promise.all(['/api/product-library','/api/logo-library','/api/my-space/tasks/task'].map(url=>c.request(url)));
 assert.deepEqual(calls,['/s7/api/product-library','/s7/api/logo-library','/s7/api/my-space/tasks/task']);assert.equal(c.expired(),0);
});

for(const status of [200,401])test(`账号变更或失效时拒绝继续使用响应（${status}）`,async()=>{
 const c=client(async()=>new Response('{}',{status,headers:{'X-Workspace-User':'bob'}}));
 await assert.rejects(c.request('/api/product-library'),/登录/);assert.equal(c.expired(),1);
});

test('兼容缺少账号标识的旧接口，仍核实账号后才使用结果',async()=>{
 const calls=[],c=client(async url=>{calls.push(url);return new Response(url.endsWith('/session')?'"bad"':'{}');});
 await assert.rejects(c.request('/api/product-library'),/登录/);assert.equal(c.expired(),1);
 assert.deepEqual(calls,['/s7/api/product-library','/s7/api/session']);
});


test('生成和加工请求只传 Logo 原图引用，不上传选择预览',async()=>{
 const bodies=[],c=client(async(_url,init)=>{bodies.push(JSON.parse(init.body));return new Response('{}',{headers:{'X-Workspace-User':'alice'}});},{loadedTaskLogoId:'one',taskLogos:[{id:'one',logoImage:'small-preview',logoAssetUrl:'/api/my-space/tasks/task/assets/original.png'}]});
 for(const url of ['/api/ai-render','/api/ai-render-multi','/api/ai-process-logo'])await c.request(url,{method:'POST',body:JSON.stringify({logoImage:'small-preview'})});
 for(const body of bodies){assert.equal(body.logoAssetUrl,'/api/my-space/tasks/task/assets/original.png');assert.equal(body.taskId,'task');assert.equal(body.logoImage,undefined);}
});

test('单产品生成捕获原图引用，保存期间切换产品不能换成其他产品的原图',async()=>{
 const bodies=[],c=client(async(_url,init)=>{bodies.push(JSON.parse(init.body));return new Response('{}',{headers:{'X-Workspace-User':'alice'}});},{loadedMultiProductId:'p',multiProductViews:new Map([['p',{baseAssetUrl:'/api/my-space/tasks/task/assets/product.png'}],['other',{baseAssetUrl:'/api/my-space/tasks/task/assets/other.png'}]]),structuredClone,syncSchemeState(){},currentSignatures:()=>({}),mockupModel:{value:'test'},baseData:'small-preview',logoData:'logo',collectTargets:()=>[],schemeState:{schemes:[]},submittedSignatures:{}});
 vm.runInContext(source.slice(source.indexOf('function generationRequest('),source.indexOf('async function submitBackgroundGeneration(')),c.context);
 const request=c.context.generationRequest(['ORIGINAL']);c.context.loadedMultiProductId='other';
 for(const url of ['/api/ai-render','/api/render'])await c.request(url,{method:'POST',body:JSON.stringify(request)});
 for(const body of bodies){assert.equal(body.baseAssetUrl,'/api/my-space/tasks/task/assets/product.png');assert.equal(body.baseImage,undefined);}
});
