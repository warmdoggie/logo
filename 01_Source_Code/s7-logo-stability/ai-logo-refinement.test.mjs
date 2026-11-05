import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';
import {createAiLogoProcessor} from './ai-logo-provider.mjs';
import {saveLogo,loadSavedLogo} from './saved-logo.mjs';
import {DatabaseSync} from 'node:sqlite';
import {logoLibrary} from '../logo-library.mjs';

async function gradient(){
 const width=96,height=40,raw=Buffer.alloc(width*height*4);
 for(let y=8;y<32;y++)for(let x=10;x<86;x++)raw.set([120+x,55+x,20,255],(y*width+x)*4);
 raw.set([255,253,248,180],(9*width+11)*4);
 return sharp(raw,{raw:{width,height,channels:4}}).png().toBuffer();
}
async function serverTest(options,run){
 const server=createDemoServer({authenticate:null,saveLogoToLibrary:async()=>({id:'refined'}),...options});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{await run(base);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
const post=(base,path,input)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});

test('AI fine processing preserves metallic gradients and alpha in its response and library copy',async()=>{
 const png=await gradient();let saved,savedOptions;
 await serverTest({aiProcessor:async()=>({bytes:png,provider:'APIMART',model:'gpt-image-2.5-flare'}),saveLogoToLibrary:async(req,bytes,name,options)=>{saved=bytes;savedOptions=options;return {id:'refined'};}},async base=>{
  const response=await post(base,'/api/ai-process-logo',{logoImage:png.toString('base64'),targetColor:'original',preserveDetails:true});
  assert.equal(response.status,200);const payload=await response.json();
  const output=Buffer.from(payload.dataUrl.split(',')[1],'base64');
  assert.ok((await sharp(output).raw().toBuffer()).equals(await sharp(png).raw().toBuffer()),'AI gradients must not be flattened by local palette cleanup');
  assert.deepEqual(saved,output);assert.equal(savedOptions.aiRefined,true);assert.equal(payload.model,'gpt-image-2.5-flare');
 });
});

test('opaque AI results are rejected before saving a fine-processed Logo',async()=>{
 const png=await sharp({create:{width:96,height:40,channels:4,background:'#ffffff'}}).png().toBuffer();let saved=false;
 await serverTest({aiProcessor:async()=>png,saveLogoToLibrary:async()=>{saved=true;}},async base=>{
  const response=await post(base,'/api/ai-process-logo',{logoImage:png.toString('base64'),targetColor:'original',preserveDetails:true});
  assert.equal(response.status,400);assert.match((await response.json()).error,/透明背景/);assert.equal(saved,false);
 });
});

test('fine-processing uses existing APIMart settings, original colors, transparency and a wide canvas',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-ai-refine-'));
 try{
  const configPath=join(dir,'provider.json'),png=await gradient();let submitted;
  await writeFile(configPath,JSON.stringify({enabled:true,provider:'APIMART',model:'flux-3-image',logoModel:'gpt-image-2.5-flare',apiKey:'test-key',endpoint:'https://api.apimart.ai'}));
  const processor=createAiLogoProcessor({configPath,pollIntervalMs:0,transport:async(url,options)=>{
   if(String(url).endsWith('/v1/images/generations')){submitted=JSON.parse(options.body);return Response.json({data:[{task_id:'refine-1'}]});}
   if(String(url).includes('/v1/tasks/'))return Response.json({data:{status:'completed',result:{images:[{url:['https://upload.apimart.ai/refined.png']}]}}});
   return new Response(png);
  }});
  const output=await processor(png,{targetColor:'original',preserveDetails:true});
  assert.equal(submitted.model,'gpt-image-2.5-flare');assert.equal(submitted.background,'transparent');assert.equal(submitted.output_format,'png');
  assert.equal(submitted.resolution,'2k');assert.equal(submitted.size,'21:9');
  assert.match(submitted.prompt,/metallic/i);assert.match(submitted.prompt,/specular highlights/i);assert.doesNotMatch(submitted.prompt,/solid pure black/i);
  assert.deepEqual(output.bytes,png);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('AI-processed Logos retain gradients during subsequent automatic generation',async()=>{
 const png=await gradient(),baseImage=await sharp({create:{width:120,height:80,channels:3,background:'#eeeeee'}}).png().toBuffer();let rendered;
 await serverTest({mockupRenderer:async input=>{rendered=Buffer.from(input.logoImage.split(',')[1],'base64');return [{version:'ORIGINAL',bytes:baseImage}];}},async base=>{
  const response=await post(base,'/api/ai-render',{processLogo:true,preserveLogoDetails:true,baseImage:baseImage.toString('base64'),logoImage:png.toString('base64'),model:'test',selectedVersions:['ORIGINAL'],targets:[{id:'body',x:.5,y:.5,widthRatio:.4,rotation:0}]});
  assert.equal(response.status,200,await response.clone().text());
  assert.ok((await sharp(rendered).raw().toBuffer()).equals(await sharp(png).raw().toBuffer()),'generation must retain AI pixel colors and alpha');
 });
});

const script=await readFile(new URL('./demo.js',import.meta.url),'utf8');
function client(request){
 const logo={id:'one',name:'Gold.jpg',logoImage:'original',sourceData:'original',logoAssetUrl:'/snapshot/original'},button={},message={},download={hidden:true},calls=[],saved=[];
 const c=vm.createContext({taskLogos:[logo],loadedTaskLogoId:'one',selectedTaskLogoId:'one',logoData:'original',logoSourceData:'original',logoImage:{},logoSelectionBusy:false,logoDecoding:false,logoImportBusy:false,generationBusy:false,generationSubmitting:false,multiPackageBusy:false,copyingProductPreset:false,aiLogoBusy:false,
  aiRefineButton:button,aiRefineStatus:message,aiRefineDownload:download,logoStorage:{},saveLogo:(_storage,value)=>saved.push(value),
  fetch:async(path,options)=>{calls.push({path,input:options?.body&&JSON.parse(options.body)});return request(path,options);},loadImage:async src=>({src}),
  setSelectedLogoPreview(){logo.logoImage=c.logoData;logo.sourceData=c.logoSourceData;delete logo.logoAssetUrl;},drawPreview(){},queueSchemeCards(){},updateGenerateButton(){},renderLogoLibrary(){},renderProductLibrary(){},renderMultiProductResults(){},setStatus(){},taskDraft:{schedule(){},flush:async()=>{}},document:{querySelector:()=>({hidden:true,textContent:'Gold.jpg'})},useSavedLogoButton:{},clearSavedLogoButton:{},
 });
 const start=script.indexOf('async function refineSelectedLogo(){');
 assert.ok(start>=0,'the Logo upload area needs a fine-processing action');
 vm.runInContext(script.slice(start,script.indexOf('async function importLogoFiles(',start)),c);
 return {c,logo,button,message,download,calls,saved};
}

test('fine-processing replaces only the active Logo, retains its source and saves it for reuse',async()=>{
 const {c,logo,calls,saved,download}=client(async path=>Response.json(path.endsWith('/status')?{configured:true}:{dataUrl:'data:image/png;base64,refined',model:'gpt-image-2.5-flare'}));
 await c.refineSelectedLogo();
 const request=calls.find(call=>call.input);assert.equal(request.path,'/api/ai-process-logo');assert.equal(request.input.targetColor,'original');assert.equal(request.input.preserveDetails,true);
 assert.equal(c.logoData,'refined');assert.equal(logo.logoImage,'refined');assert.equal(logo.sourceData,'original');assert.equal(logo.aiRefined,true);
 assert.equal(logo.logoAssetUrl,undefined);assert.equal(saved[0].aiRefined,true);assert.equal(c.logoSelectionBusy,false);
});

test('failed fine-processing retains the current image and releases the controls',async()=>{
 const {c,logo,message}=client(async path=>Response.json(path.endsWith('/status')?{configured:true}:{error:'APIMart 生成失败'},{status:path.endsWith('/status')?200:400}));
 await c.refineSelectedLogo();assert.equal(c.logoData,'original');assert.equal(logo.logoAssetUrl,'/snapshot/original');assert.equal(c.logoSelectionBusy,false);assert.match(message.textContent,/生成失败/);
});

test('fine-processing ignores repeat clicks and does not replace a newly selected Logo',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);
 const {c,logo,calls}=client(async path=>path.endsWith('/status')?Response.json({configured:true}):pending);
 const running=c.refineSelectedLogo();await Promise.resolve();await c.refineSelectedLogo();
 c.loadedTaskLogoId='two';c.selectedTaskLogoId='two';c.logoData='other';
 release(Response.json({dataUrl:'data:image/png;base64,refined'}));await running;
 assert.equal(calls.filter(call=>call.input).length,1);assert.equal(c.logoData,'other');assert.equal(logo.logoImage,'original');assert.equal(c.logoSelectionBusy,false);
});

test('saved Logo metadata prevents a reused AI result from being locally flattened',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 saveLogo(storage,{data:'png',name:'Gold.png',sourceData:'original',aiRefined:true});
 assert.equal(loadSavedLogo(storage).aiRefined,true);
});

test('restoring a cached AI Logo into an empty page retains its refinement metadata',async()=>{
 const c=vm.createContext({taskLogos:[],loadedTaskLogoId:null,selectedTaskLogoId:null,logoData:'',logoSourceData:'',logoImage:null,crypto:{randomUUID:()=> 'restored'},loadImage:async src=>({src}),useSavedLogoButton:{},clearSavedLogoButton:{},setSelectedLogoPreview(){},drawPreview(){},updateGenerateButton(){}});
 vm.runInContext(script.slice(script.indexOf('async function useSavedLogo('),script.indexOf('async function restoreSavedLogo(')),c);
 await c.useSavedLogo({data:'refined',sourceData:'source',name:'Metal.png',aiRefined:true});
 assert.equal(c.taskLogos.length,1);assert.equal(c.taskLogos[0].aiRefined,true);assert.equal(c.loadedTaskLogoId,c.taskLogos[0].id);assert.equal(c.selectedTaskLogoId,c.loadedTaskLogoId);
});

test('Logo library migrates old assets and retains the AI flag through save, list and rename',()=>{
 const db=new DatabaseSync(':memory:'),stored=new Map();
 db.exec('CREATE TABLE LogoLibraryAsset(id TEXT PRIMARY KEY,ownerId TEXT NOT NULL,name TEXT NOT NULL,filePath TEXT NOT NULL,createdAt TEXT NOT NULL)');
 db.prepare('INSERT INTO LogoLibraryAsset VALUES(?,?,?,?,?)').run('old','local','Old.png','old.png','2026-01-01');
 try{
  const assets=logoLibrary(db,{put:bytes=>{stored.set('new.png',bytes);return 'new.png';},remove(){},get:path=>stored.get(path)});
  const saved=assets.add({name:'Metal.png',bytes:Buffer.from('png'),aiRefined:true});
  assert.equal(saved.aiRefined,true);assert.equal(assets.list().find(row=>row.id===saved.id).aiRefined,true);
  assert.equal(assets.rename(saved.id,'Renamed.png').aiRefined,true);assert.notEqual(assets.list().find(row=>row.id==='old').aiRefined,true);
  assert.equal(logoLibrary(db,{get(){}}).list().find(row=>row.id===saved.id).aiRefined,true);
 }finally{db.close();}
});
