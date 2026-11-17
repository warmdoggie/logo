import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sharp} from './logo-pixels.mjs';
const root=dirname(fileURLToPath(import.meta.url));
test('透明母版：持久化、原色保护、复核权限、生产版本衔接、冲突、重启与清理',async()=>{
 const data=mkdtempSync(join(tmpdir(),'transparent-master-'));let child,base,cookie='';
 async function start(){child=spawn(process.execPath,[join(root,'server.mjs')],{env:{...process.env,PORT:'0',APP_DATA_DIR:data,APP_NO_SEED:'0'},stdio:['ignore','pipe','pipe']});child.stderr.on('data',b=>process.stderr.write(b));base=await new Promise((yes,no)=>{child.stdout.on('data',b=>{const m=String(b).match(/http:\/\/127\.0\.0\.1:\d+/);if(m)yes(m[0]);});child.once('exit',c=>no(Error('startup '+c)));child.once('error',no);});}
 async function stop(){const done=once(child,'exit');child.kill();await done;}
 const get=async p=>{const r=await fetch(base+p,{headers:{cookie}});assert.equal(r.status,200);return r.json();};
 const post=async(p,v,status=200)=>{const form=v instanceof FormData,r=await fetch(base+p,{method:'POST',headers:form?{cookie}:{cookie,'Content-Type':'application/json'},body:form?v:JSON.stringify(v)});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;};
 try{
 await start();const products=await get('/api/products');
 const pixels=Buffer.alloc(100*80*4,255);for(let y=20;y<60;y++)for(let x=20;x<80;x++)pixels.set(x>=60?[210,50,30,255]:[12,40,90,255],(y*100+x)*4);
 // An enclosed white fill is intentionally ambiguous; simple two-colour art
 // now passes automatically and is covered by test-flat-color-background.
 for(let y=35;y<45;y++)for(let x=35;x<45;x++)pixels.set([255,255,255,255],(y*100+x)*4);
 const logo=await sharp(pixels,{raw:{width:100,height:80,channels:4}}).png().toBuffer();
 const f=new FormData();f.set('customerName','透明母版隔离验收');f.set('productIds',JSON.stringify([products[0].id]));f.set('logo',new Blob([logo]),'brand.png');const t=await post('/api/tasks',f,201),path='/api/transparent/'+t.id;
 let page=await get(path),source=page.sources[0];page=await post(path+'/prepare',{sourceId:source.id},201);
 const master=page.masters[0];assert.equal(master.status,'REVIEW_REQUIRED');assert.equal(page.activeProductionLogoId,null);
 assert.deepEqual(readFileSync(join(data,'uploads',(await get('/api/logo/'+t.id)).sources[0].filePath)),logo);
 const raw=await sharp(readFileSync(join(data,'uploads',master.filePath))).ensureAlpha().raw().toBuffer();assert.equal(raw[3],0);assert.deepEqual([...raw.subarray((30*100+30)*4,(30*100+30)*4+4)],[12,40,90,255]);
 page=await post(path+'/prepare',{sourceId:source.id},201);assert.equal(page.masters.length,1);
 await post(path+'/activate',{masterId:master.id,expectedActiveProductionLogoId:null},409);
 await post(path+'/review',{masterId:master.id,baseRevision:0,approved:true,note:'业务员不可复核'},403);
 const password=readFileSync(join(data,'规则管理账号.txt'),'utf8').match(/账号：admin\r?\n密码：([^\r\n]+)/)[1];const r=await fetch(base+'/api/rule-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password})});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];
 page=await post(path+'/review',{masterId:master.id,baseRevision:0,approved:true,note:'图形与颜色保留，边缘去底正确'});assert.equal(page.masters[0].status,'READY');
 await post(path+'/review',{masterId:master.id,baseRevision:0,approved:true,note:'重复旧提交'},409);
 page=await post(path+'/activate',{masterId:master.id,expectedActiveProductionLogoId:null});const pid=page.activeProductionLogoId;assert.ok(pid);
 let logos=await get('/api/logo/'+t.id);assert.equal(logos.productions.length,1);assert.equal(logos.productions[0].colorMode,'ORIGINAL');assert.deepEqual(readFileSync(join(data,'uploads',logos.productions[0].filePath)),readFileSync(join(data,'uploads',master.filePath)));
 await post(path+'/activate',{masterId:master.id,expectedActiveProductionLogoId:null},409);
 await post(path+'/activate',{masterId:master.id,expectedActiveProductionLogoId:pid});assert.equal((await get('/api/logo/'+t.id)).productions.length,1);
 await stop();await start();page=await get(path);assert.equal(page.masters[0].reviewNote,'图形与颜色保留，边缘去底正确');assert.equal(page.activeProductionLogoId,pid);
 // New original versions preserve the existing active production until explicit activation.
 const alpha=Buffer.from(pixels);for(let y=0;y<80;y++)for(let x=0;x<100;x++)if(x<20||x>=80||y<20||y>=60)alpha[(y*100+x)*4+3]=0;
 const transparent=await sharp(alpha,{raw:{width:100,height:80,channels:4}}).png().toBuffer();const upload=new FormData();upload.set('file',new Blob([transparent]),'alpha.png');upload.set('baseVersion','1');logos=await post('/api/logo/'+t.id+'/sources',upload,201);
 page=await post(path+'/prepare',{sourceId:logos.sources[0].id},201);assert.equal(page.masters[0].status,'READY');assert.equal(page.activeProductionLogoId,pid);
 page=await post(path+'/activate',{masterId:page.masters[0].id,expectedActiveProductionLogoId:pid});assert.notEqual(page.activeProductionLogoId,pid);assert.equal((await get('/api/logo/'+t.id)).productions.length,2);
 // A blank transparent source is not a usable ready master.
 const blank=await sharp({create:{width:20,height:20,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();const blankForm=new FormData();blankForm.set('file',new Blob([blank]),'blank.png');blankForm.set('baseVersion','2');logos=await post('/api/logo/'+t.id+'/sources',blankForm,201);
 page=await post(path+'/prepare',{sourceId:logos.sources[0].id},201);assert.equal(page.masters[0].status,'DESIGNER_REQUIRED');assert.equal(page.masters[0].filePath,null);
 const paths=page.masters.filter(m=>m.filePath).map(m=>join(data,'uploads',m.filePath));const preview=await get('/api/manage/tasks/'+t.id+'/delete-preview');assert.equal(preview.counts.TransparentMaster,3);
 await post('/api/manage/tasks/'+t.id+'/delete',{taskCode:t.taskCode,confirm:true,fingerprint:preview.fingerprint});assert.ok(paths.every(p=>!existsSync(p)));assert.equal((await get('/api/products')).length,products.length);
 assert.equal((await fetch(base+'/transparent-ui.js')).status,200);
 }finally{if(child&&child.exitCode===null)await stop();}
});
