import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {createOssPreviews} from './oss-previews.mjs';

test('鉴权后才跳转 OSS；原图、本地回退与未同步图片继续本地读取',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'oss-route-'));
 const preload=join(dir,'sdk-fixture.mjs');
 await writeFile(preload,`import {registerHooks} from 'node:module';
 const sdk='data:text/javascript,'+encodeURIComponent("export {createLogoStorageClients} from '${new URL('./logo-oss-client.mjs',import.meta.url).href}';export function createLogoOssClients(){return async()=>({signatureUrl:key=>'https://heci-002.oss-cn-heyuan.aliyuncs.com/'+key+'?fixture-signature'});}");
 registerHooks({resolve(name,context,next){return name==='./logo-oss-client.mjs'?{url:sdk,shortCircuit:true}:next(name,context);}});`);
 const child=spawn(process.execPath,['--import',pathToFileURL(preload).href,'server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,APP_DATA_DIR:dir,APP_NO_SEED:'1',APP_MULTI_USER:'1',LOGO_OSS_PREVIEWS:'1',PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 try{
  const base=await new Promise((resolve,reject)=>{let output='';child.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});child.on('error',reject);child.on('exit',code=>reject(Error('startup '+code)));setTimeout(()=>reject(Error('startup timeout')),10000).unref();});
  const call=(path,cookie='',body)=>fetch(base+path,{redirect:'manual',method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body&&!(body instanceof FormData)?{'content-type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});
  const login=async(username,password)=>(await call('/api/auth/login','',{username,password})).headers.get('set-cookie').split(';')[0];
  const password=(await readFile(join(dir,'workspace-admin.txt'),'utf8')).match(/密码：([^\r\n]+)/)[1],admin=await login('admin',password);
  await call('/api/auth/users',admin,{username:'bob',password:'Bob-pass-12345'});const bob=await login('bob','Bob-pass-12345');
  const bytes=await sharp({create:{width:2100,height:1400,channels:3,background:'#abc'}}).png().toBuffer();
  const form=new FormData();for(const [key,value]of Object.entries({sku:'OSS01',name:'OSS preview',category:'脸部'}))form.set(key,value);form.set('image',new Blob([bytes]),'photo.png');
  const created=await call('/api/products',admin,form);assert.equal(created.status,201);const {id}=await created.json();
  const {product}=await(await call('/api/templates/'+id,admin)).json(),url='/files/'+product.standardImage;
  assert.equal((await call(url+'?preview=1',admin)).status,200);
  await createOssPreviews({directory:join(dir,'oss-previews'),client:async()=>({put:async()=>{}})}).publish(bytes);
  for(const cookie of [admin,bob]){const remote=await call(url+'?preview=1',cookie);assert.equal(remote.status,302);assert.match(remote.headers.get('location'),/\/s7-logo\/previews\/v1\//);assert.equal(remote.headers.get('cache-control'),'no-store');}
  assert.equal((await call(url+'?preview=1')).status,401);
  for(const suffix of ['', '?download=1', '?download=1&preview=1'])assert.deepEqual(Buffer.from(await(await call(url+suffix,admin)).arrayBuffer()),bytes);
  const fallback=await call(url+'?preview=1&local=1',admin);assert.equal(fallback.status,200);assert.equal(fallback.headers.get('X-Image-Width'),'2100');
  const logoForm=new FormData();logoForm.set('file',new Blob([bytes]),'private.png');const logoResponse=await call('/api/logo-library',admin,logoForm);assert.equal(logoResponse.status,201);const logo=await logoResponse.json();
  const privateBytes=Buffer.from(await(await call(logo.imageUrl,admin)).arrayBuffer());await createOssPreviews({directory:join(dir,'oss-previews'),client:async()=>({put:async()=>{}})}).publish(privateBytes);
  assert.equal((await call(logo.imageUrl+'?thumbnail=1',admin)).status,302);const denied=await call(logo.imageUrl+'?thumbnail=1',bob);assert.equal(denied.status,404);assert.equal(denied.headers.get('location'),null);
 }finally{if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}await rm(dir,{recursive:true,force:true});}
});
