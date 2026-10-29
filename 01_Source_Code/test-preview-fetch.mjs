import test from 'node:test';
import assert from 'node:assert/strict';

test('OSS 预览读取原图尺寸元数据，跨域失败时自动重新读取本地预览',async()=>{
 const {fetchPreview}=await import('./public/preview-fetch.js');
 const realFetch=globalThis.fetch,calls=[];
 try{
  globalThis.fetch=async(url)=>{calls.push(String(url));if(calls.length===1)throw TypeError('CORS unavailable');return new Response('local',{headers:{'X-Image-Width':'2400','X-Image-Height':'1200'}});};
  const response=await fetchPreview('/files/photo.png?preview=1');assert.equal(await response.text(),'local');assert.deepEqual(calls,['/files/photo.png?preview=1','/files/photo.png?preview=1&local=1']);
  globalThis.fetch=async()=>new Response('oss',{headers:{'x-oss-meta-image-width':'3201','x-oss-meta-image-height':'1601'}});
  const remote=await fetchPreview('/files/photo.png?preview=1');assert.equal(remote.headers.get('X-Image-Width'),'3201');assert.equal(remote.headers.get('X-Image-Height'),'1601');
 }finally{globalThis.fetch=realFetch;}
});

test('退出编辑时取消请求，不会触发第二次本地加载',async()=>{
 const {fetchPreview}=await import('./public/preview-fetch.js');
 const realFetch=globalThis.fetch,controller=new AbortController();let calls=0;controller.abort();
 try{globalThis.fetch=async()=>{calls++;throw controller.signal.reason;};await assert.rejects(fetchPreview('/files/photo.png?preview=1',{signal:controller.signal}),{name:'AbortError'});assert.equal(calls,1);}
 finally{globalThis.fetch=realFetch;}
});

test('OSS 响应开始后传输失败也能回退本地',async()=>{
 const {fetchPreview}=await import('./public/preview-fetch.js');const realFetch=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async()=>++calls===1?new Response(new ReadableStream({start(controller){controller.error(TypeError('connection lost'));}})):new Response('local-after-body-error');
  assert.equal(await(await fetchPreview('/files/photo.png?preview=1')).text(),'local-after-body-error');assert.equal(calls,2);
 }finally{globalThis.fetch=realFetch;}
});

test('OSS 跨域未暴露原图尺寸时回退本地，避免模板无法编辑',async()=>{
 const {fetchPreview}=await import('./public/preview-fetch.js');const realFetch=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async()=>{calls++;const response=new Response('image',{headers:calls===1?{}:{'X-Image-Width':'2400','X-Image-Height':'1200'}});if(calls===1)Object.defineProperty(response,'redirected',{value:true});return response;};
  const response=await fetchPreview('/files/photo.png?preview=1');assert.equal(response.headers.get('X-Image-Width'),'2400');assert.equal(calls,2);
 }finally{globalThis.fetch=realFetch;}
});
