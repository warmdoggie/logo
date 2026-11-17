import {testLogin} from './fixture-login.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sharp} from './logo-pixels.mjs';
const root=dirname(fileURLToPath(import.meta.url));
async function fixture(kind){const width=200,height=100,data=Buffer.alloc(width*height*4);const rect=(x,y,w,h,c)=>{for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)data.set(c,(j*width+i)*4);};
 if(kind==='one'){rect(15,15,60,60,[0,0,0,255]);rect(14,15,1,60,[0,0,0,100]);}
 if(kind==='parts'){rect(0,0,width,height,[255,255,255,255]);rect(10,10,30,20,[255,0,0,255]);rect(80,10,60,20,[0,0,255,255]);rect(50,15,10,10,[255,0,255,255]);rect(30,65,120,10,[0,255,0,255]);}
 if(kind==='many')[[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,200,0,255],[170,0,170,255]].forEach((c,i)=>rect(10+i*35,20,25,50,c));
 return {png:await sharp(data,{raw:{width,height,channels:4}}).png().toBuffer(),raw:data,width,height};}
test('Step3 A–F：原始版本、选区位置、单双色轮廓、历史追溯、错误校验、重启',async()=>{
 const data=mkdtempSync(join(tmpdir(),'logo-test-'));let child,base,cookie='';
 async function start(){child=spawn(process.execPath,[join(root,'server.mjs')],{env:{...process.env,PORT:'0',APP_DATA_DIR:data,APP_NO_SEED:'0'},stdio:['ignore','pipe','pipe']});base=await new Promise((yes,no)=>{child.stdout.on('data',b=>{const m=String(b).match(/http:\/\/127\.0\.0\.1:\d+/);if(m)yes(m[0]);});child.stderr.on('data',b=>console.error(String(b)));child.on('error',no);child.on('exit',c=>no(Error('exit '+c)));});}
 async function stop(){const done=once(child,'exit');child.kill();await done;}
 const get=async p=>{const r=await fetch(base+p);assert.equal(r.status,200);return r.json();};
 const post=(p,v)=>fetch(base+p,{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify(v)});
 try{
 await start();cookie=await testLogin(base,data);const tasks=await get('/api/tasks'),id=tasks[0].id,path='/api/logo/'+id;let info=await get(path);assert.equal(info.sources.length,1);const initialBytes=Buffer.from(await(await fetch(base+'/files/'+info.sources[0].filePath)).arrayBuffer());
 const upload=async(bytes,name)=>{const f=new FormData();f.set('file',new Blob([bytes]),name);f.set('baseVersion',info.sources[0].version);const r=await fetch(base+path+'/sources',{method:'POST',body:f});assert.equal(r.status,201);info=await r.json();return info.sources[0];};
 const options=s=>({sourceLogoAssetId:s.id,selectedElementIds:[s.elements.find(e=>e.isFull).id],colorMode:'SINGLE',backgroundRemovalMode:'NONE',tolerance:20,primaryColor:'#000000',secondaryColor:'#d4a052',pantoneNote:'',baseVersion:info.latestProductionVersion});
 const one=await fixture('one');let s=await upload(one.png,'透明黑色测试.png'),o=options(s);let r=await post(path+'/preview',o);assert.equal(r.status,200);let preview=await r.json();assert.equal(preview.analysis.colorLevel,'ONE');r=await post(path+'/productions',o);assert.equal(r.status,201);info=await r.json();const v1=info.productions[0];assert.equal(v1.version,1);const png1=Buffer.from(await(await fetch(base+'/files/'+v1.filePath)).arrayBuffer());const raw1=await sharp(png1).ensureAlpha().raw().toBuffer();assert.deepEqual(raw1,one.raw);
 const parts=await fixture('parts');s=await upload(parts.png,'图形品牌口号测试.png');
 const elem=async(name,type,x,y,width,height)=>{const r=await post(path+'/elements',{sourceLogoAssetId:s.id,name,elementType:type,x,y,width,height});assert.equal(r.status,201);info=await r.json();return info.sources[0].elements.find(e=>e.name===name);};
 const e1=await elem('图形','SYMBOL',.05,.1,.15,.2),e2=await elem('品牌','BRAND_NAME',.4,.1,.3,.2);o={...options(s),selectedElementIds:[e1.id,e2.id],colorMode:'ORIGINAL',backgroundRemovalMode:'WHITE'};r=await post(path+'/productions',o);assert.equal(r.status,201);info=await r.json();const partsVersion=info.productions[0];const combined=await sharp(Buffer.from(await(await fetch(base+'/files/'+partsVersion.filePath)).arrayBuffer())).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(combined.info.width,130);assert.equal(combined.info.height,20);assert.equal(combined.data[(5*130+40)*4+3],0);assert.deepEqual([...combined.data.subarray((5*130+75)*4,(5*130+75)*4+4)],[0,0,255,255]);
 const many=await fixture('many');s=await upload(many.png,'五色测试.png');o={...options(s),primaryColor:'#ffffff'};r=await post(path+'/preview',o);preview=await r.json();assert.equal(preview.analysis.colorLevel,'MORE_THAN_THREE');r=await post(path+'/productions',o);assert.equal(r.status,201);info=await r.json();const white=await sharp(Buffer.from(await(await fetch(base+'/files/'+info.productions[0].filePath)).arrayBuffer())).ensureAlpha().raw().toBuffer();for(let i=0;i<white.length;i+=4){assert.equal(white[i+3],many.raw[i+3]);if(white[i+3])assert.deepEqual([...white.subarray(i,i+3)],[255,255,255]);}
 o={...options(s),colorMode:'DOUBLE',primaryColor:'#123456',secondaryColor:'#abcdef'};r=await post(path+'/productions',o);assert.equal(r.status,201);info=await r.json();const duo=await sharp(Buffer.from(await(await fetch(base+'/files/'+info.productions[0].filePath)).arrayBuffer())).ensureAlpha().raw().toBuffer();const colors=new Set();for(let i=0;i<duo.length;i+=4){assert.equal(duo[i+3],many.raw[i+3]);if(duo[i+3])colors.add(duo.subarray(i,i+3).toString('hex'));}assert.deepEqual([...colors].sort(),['123456','abcdef']);
 r=await fetch(base+path+'/elements/'+e2.id,{method:'DELETE',headers:{cookie}});assert.equal(r.status,200);info=await r.json();assert.equal(info.productions.find(v=>v.id===partsVersion.id).selectedElements.length,2);
 r=await post(path+'/activate',{id:v1.id});assert.equal(r.status,200);info=await r.json();assert.equal(info.task.activeProductionLogoId,v1.id);assert.deepEqual(Buffer.from(await(await fetch(base+'/files/'+v1.filePath)).arrayBuffer()),png1);
 r=await post(path+'/productions',{...options(s),selectedElementIds:[]});assert.equal(r.status,400);
 r=await post(path+'/elements',{sourceLogoAssetId:s.id,name:'越界',elementType:'SYMBOL',x:.9,y:0,width:.3,height:.2});assert.equal(r.status,400);
 r=await post(path+'/productions',{...options(s),selectedElementIds:[e2.id]});assert.equal(r.status,400);
 r=await post(path+'/productions',{...options(s),baseVersion:0});assert.equal(r.status,409);
 const blank=await sharp({create:{width:10,height:10,channels:4,background:{r:255,g:255,b:255,alpha:1}}}).png().toBuffer();s=await upload(blank,'白底.png');r=await post(path+'/productions',{...options(s),backgroundRemovalMode:'WHITE'});assert.equal(r.status,400);
 const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect x="10" y="10" width="40" height="20" fill="black"/></svg>');s=await upload(svg,'原始.svg');assert.equal(s.mimeType,'image/svg+xml');assert.deepEqual(Buffer.from(await(await fetch(base+'/files/'+s.filePath)).arrayBuffer()),svg);
 const expectedSources=info.sources.length,expectedProductions=info.productions.length;
 await stop();await start();info=await get(path);assert.equal(info.sources.length,expectedSources);assert.equal(info.productions.length,expectedProductions);assert.equal(info.task.activeProductionLogoId,v1.id);assert.deepEqual(Buffer.from(await(await fetch(base+'/files/'+info.sources.at(-1).filePath)).arrayBuffer()),initialBytes);
 console.log('PASS A–F：像素与透明度校验、部分元素与相对位置、主色估算、单双色、源文件版本和 SVG 保留、历史与重启');
 }finally{if(child&&child.exitCode===null)await stop();}
});
