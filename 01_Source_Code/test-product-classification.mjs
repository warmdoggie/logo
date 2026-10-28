import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import sharp from 'sharp';

test('产品两级分类、组合检索、旧库迁移和重启保存',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'product-classification-'));
 const oldDb=new DatabaseSync(join(dir,'assistant.sqlite'));
 oldDb.exec("CREATE TABLE Product(id TEXT PRIMARY KEY,sku TEXT NOT NULL UNIQUE COLLATE NOCASE,name TEXT NOT NULL,category TEXT NOT NULL,standardImage TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL); INSERT INTO Product VALUES ('legacy','OLD001','旧产品','唇部','old.png','2026-01-01','2026-01-01');");
 oldDb.close();
 let child,base,cookie='';
 async function start(){
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',APP_DATA_DIR:dir,APP_NO_SEED:'1',APP_MULTI_USER:'0'},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{let output='';child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});child.once('error',reject);child.once('exit',code=>reject(Error('startup '+code)));setTimeout(()=>reject(Error('startup timeout')),10000).unref();});
 }
 async function stop(){const ended=once(child,'exit');child.kill();await ended;}
 async function call(path,data,status=200){const form=data instanceof FormData,response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{cookie,...(form?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:form?data:JSON.stringify(data)})});const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
 const photo=await sharp({create:{width:20,height:20,channels:4,background:'#f8c0c0'}}).png().toBuffer();
 async function create(sku,category,subcategory,name='液体腮红',status=201){const form=new FormData();for(const [key,value]of Object.entries({sku,name,category,subcategory}))form.set(key,value);form.set('image',new Blob([photo]),'product.png');return call('/api/products',form,status);}
 try{
  await start();
  await t.test('旧产品迁移后仍可按原 SKU 搜索',async()=>{const rows=await call('/api/products?q=old001');assert.equal(rows.length,1);assert.equal(rows[0].category,'唇部');assert.equal(rows[0].subcategory,'');});
  const blush=await create('F0066','脸部','腮红');
  const powder=await create('F0002','脸部','散粉','定妆散粉');
  const lip=await create('L0048','唇部','唇釉','持光液体唇釉');
  const custom=await create('F0099','脸部','珠光液','高光珠光液');
  await t.test('大类、细类与原 SKU / 名称搜索取交集',async()=>{
   assert.deepEqual((await call('/api/products?category='+encodeURIComponent('脸部')+'&subcategory='+encodeURIComponent('腮红'))).map(p=>p.id),[blush.id]);
   assert.deepEqual((await call('/api/products?category='+encodeURIComponent('脸部')+'&q=l0048')).map(p=>p.id),[]);
   assert.deepEqual((await call('/api/products?category='+encodeURIComponent('脸部')+'&q='+encodeURIComponent('液体'))).map(p=>p.id),[blush.id]);
   assert.deepEqual((await call('/api/products?q=l0048')).map(p=>p.id),[lip.id]);
   assert.deepEqual((await call('/api/products?category='+encodeURIComponent('脸部')+'&subcategory='+encodeURIComponent('不存在'))).map(p=>p.id),[]);
  });
  await t.test('自定义细类保存并出现在所属大类选项中',async()=>{const categories=await call('/api/products/categories');assert.ok(categories['脸部'].includes('珠光液'));assert.ok(categories['脸部'].includes('腮红'));assert.ok(!categories['唇部'].includes('珠光液'));});
  await t.test('拒绝空白和超长细类',async()=>{await create('INVALID1','脸部','   ','无效',400);await create('INVALID2','脸部','类'.repeat(61),'无效',400);assert.deepEqual(await call('/api/products?q=INVALID'),[]);});
  const password=(await readFile(join(dir,'规则管理账号.txt'),'utf8')).match(/账号：admin\r?\n密码：([^\r\n]+)/)[1];
  const login=await fetch(base+'/api/rule-auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
  await t.test('编辑同时保存大类和细类，搜索立即使用新分类',async()=>{const p=await call('/api/manage/products/'+custom.id);assert.equal(p.subcategory,'珠光液');await call('/api/manage/products/'+custom.id,{sku:p.sku,name:p.name,category:'身体',subcategory:'身体高光',status:'ACTIVE',baseRevision:p.revision});assert.equal((await call('/api/manage/products/'+custom.id)).subcategory,'身体高光');assert.deepEqual((await call('/api/products?category='+encodeURIComponent('身体')+'&subcategory='+encodeURIComponent('身体高光'))).map(p=>p.id),[custom.id]);});
  await t.test('批量 SKU 查找继续跨分类使用',async()=>{const batch=await call('/api/products/batch',{skus:'f0066 l0048 missing'});assert.deepEqual(batch.found.map(p=>p.id),[blush.id,lip.id]);assert.deepEqual(batch.missing,['MISSING']);});
  await stop();await start();
  await t.test('重启后分类与旧产品均保留',async()=>{const rows=await call('/api/products');assert.equal(rows.find(p=>p.id===powder.id).subcategory,'散粉');assert.equal(rows.find(p=>p.id===custom.id).subcategory,'身体高光');assert.equal(rows.find(p=>p.id==='legacy').subcategory,'');});
 }finally{if(child&&child.exitCode===null)await stop();await rm(dir,{recursive:true,force:true});}
});
