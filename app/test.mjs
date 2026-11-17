import {testLogin} from './fixture-login.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
const root=dirname(fileURLToPath(import.meta.url));
test('真实上传、SKU 唯一与精确批量查找、原文件保存、关系完整性和重启持久化',async()=>{
 const data=mkdtempSync(join(tmpdir(),'render-assistant-test-'));let child,base,cookie='';
 async function start(){child=spawn(process.execPath,[join(root,'server.mjs')],{env:{...process.env,APP_DATA_DIR:data,APP_NO_SEED:'1',PORT:'0'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{let out='';child.stdout.on('data',c=>{out+=c;const m=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});child.once('error',reject);child.once('exit',code=>reject(new Error('Server exited '+code)));setTimeout(()=>reject(new Error('Startup timeout')),10000).unref();});}
 async function stop(){const done=once(child,'exit');child.kill();await done;}
 const file=readFileSync(join(root,'seed','rae-logo.png'));
 const product=(sku,name='测试产品')=>{const f=new FormData();f.set('sku',sku);f.set('name',name);f.set('category','唇蜜');f.set('image',new Blob([file],{type:'image/png'}),'测试产品.png');return f;};
 const post=(p,body)=>fetch(base+p,{method:'POST',headers:{cookie},body});
 try{
 await start();cookie=await testLogin(base,data);
 let r=await post('/api/products',product(' l0048 '));assert.equal(r.status,201);const p1=await r.json();assert.equal(p1.sku,'L0048');
 r=await post('/api/products',product('L0048'));assert.equal(r.status,409);
 r=await post('/api/products',product('L00480'));assert.equal(r.status,201);const p2=await r.json();
 let rows=await (await fetch(base+'/api/products?q=L0048')).json();assert.equal(rows[0].sku,'L0048');assert.equal(rows.length,2);
 r=await fetch(base+'/api/products/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({skus:'l0048，L0048\nL00480, L9999'})});const batch=await r.json();assert.equal(batch.found.length,2);assert.deepEqual(batch.missing,['L9999']);
 const task=(ids)=>{const f=new FormData();f.set('customerName','Rae.（测试）');f.set('rawRequirement','单色 Logo');f.set('productIds',JSON.stringify(ids));f.set('logo',new Blob([file],{type:'image/png'}),'客户 原始 Logo.png');return f;};
 r=await post('/api/tasks',task([p1.id,p2.id,p1.id]));assert.equal(r.status,201);const t=await r.json();
 let d=await (await fetch(base+'/api/tasks/'+t.id)).json();assert.equal(d.products.length,2);assert.equal(d.rawRequirement,'单色 Logo');assert.equal(d.logo.fileName,'客户 原始 Logo.png');
 assert.deepEqual(Buffer.from(await(await fetch(base+'/files/'+d.logo.filePath)).arrayBuffer()),file);
 const before=readdirSync(join(data,'uploads')).length;
 r=await post('/api/tasks',task(['missing-product']));assert.equal(r.status,400);assert.equal(readdirSync(join(data,'uploads')).length,before);
 r=await post('/api/tasks',task([]));assert.equal(r.status,400);
 const wrong=product('BAD');wrong.set('image',new Blob(['not an image'],{type:'image/png'}),'wrong.png');r=await post('/api/products',wrong);assert.equal(r.status,400);
 const large=product('BIG');large.set('image',new Blob([new Uint8Array(12*1024*1024+1)],{type:'image/png'}),'big.png');r=await post('/api/products',large);assert.equal(r.status,400);
 r=await fetch(base+'/api/products',{method:'POST',headers:{Origin:'https://example.com'},body:product('EVIL')});assert.equal(r.status,403);
 r=await fetch(base+'/files/..%2Fschema.sql');assert.equal(r.status,404);
 await stop();await start();
 d=await(await fetch(base+'/api/tasks/'+t.id)).json();assert.equal(d.products.length,2);assert.equal(d.customerName,'Rae.（测试）');assert.deepEqual(Buffer.from(await(await fetch(base+'/files/'+d.logo.filePath)).arrayBuffer()),file);
 rows=await(await fetch(base+'/api/tasks')).json();assert.equal(rows.length,1);assert.equal(rows[0].productCount,2);
 for(const route of ['/','/app.js','/style.css','/favicon.svg'])assert.equal((await fetch(base+route)).status,200);
 console.log('测试数据库：'+data);
 }finally{if(child&&child.exitCode===null)await stop();}
});
