import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {preparePlacementLogo} from './placement-logo.mjs';
import {saveLogo,loadSavedLogo} from './saved-logo.mjs';

const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
function workspace(request){
 const logo={id:'one',name:'Logo.jpg',logoImage:'preview',sourceData:'original',logoAssetUrl:'/snapshot/original'},calls=[],saved=[],statuses=[];
 const c=vm.createContext({schemeState:null,taskLogos:[logo],loadedTaskLogoId:'one',logoData:'preview',logoSourceData:'original',logoImage:{},logoSelectionBusy:false,logoDecoding:false,logoImportBusy:false,generationBusy:false,generationSubmitting:false,multiPackageBusy:false,copyingProductPreset:false,localLogoBusy:false,
  processButton:{},logoStorage:{},saveLogo:(_storage,value)=>saved.push(value),
  fetch:async(path,options)=>{calls.push({path,input:JSON.parse(options.body)});return request(path,options);},loadImage:async src=>({src}),
  setSelectedLogoPreview(){logo.logoImage=c.logoData;logo.sourceData=c.logoSourceData;delete logo.logoAssetUrl;},drawPreview(){},queueSchemeCards(){},updateGenerateButton(){},renderLogoLibrary(){},renderProductLibrary(){},renderMultiProductResults(){},setStatus:(text,type)=>statuses.push({text,type}),taskDraft:{schedule(){},flush:async()=>{}},
  useSavedLogoButton:{},clearSavedLogoButton:{},
 });
 const start=source.indexOf('async function processSelectedLogo(){');
 assert.ok(start>=0,'local Logo processing needs its own action');
 vm.runInContext(source.slice(start,source.indexOf('async function refineSelectedLogo(){',start)),c);
 return {c,logo,calls,saved,statuses};
}

test('local processing replaces the active Logo and retains the original for later editing',async()=>{
 const {c,logo,calls,saved}=workspace(async()=>Response.json({dataUrl:'data:image/png;base64,transparent'}));
 await c.processButton.onclick();
 assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/process-logo');
 assert.equal(calls[0].input.logoImage,'original');assert.equal(calls[0].input.targetColor,'original');
 assert.equal(c.logoData,'transparent');assert.equal(logo.logoImage,'transparent');assert.equal(logo.sourceData,'original');
 assert.equal(logo.logoAssetUrl,undefined);assert.equal(logo.localProcessed,true);assert.equal(saved[0].data,'transparent');assert.equal(saved[0].localProcessed,true);
 assert.equal(c.logoSelectionBusy,false);assert.equal(c.localLogoBusy,false);
});

test('processing failures keep the original image and allow retry',async()=>{
 const {c,logo,statuses}=workspace(async()=>Response.json({error:'加工失败'},{status:400}));
 await c.processButton.onclick();
 assert.equal(c.logoData,'preview');assert.equal(logo.logoAssetUrl,'/snapshot/original');
 assert.equal(c.logoSelectionBusy,false);assert.equal(c.localLogoBusy,false);assert.equal(statuses.at(-1).type,'error');
});

test('processing ignores duplicate clicks and a result for a different selected Logo',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);
 const {c,logo,calls}=workspace(()=>pending);
 const running=c.processButton.onclick();await c.processButton.onclick();
 c.loadedTaskLogoId='two';c.logoData='other';
 release(Response.json({dataUrl:'data:image/png;base64,transparent'}));await running;
 assert.equal(calls.length,1);assert.equal(c.logoData,'other');assert.equal(logo.logoImage,'preview');assert.equal(c.logoSelectionBusy,false);
});

test('reusing a locally processed Logo keeps the transparent result rather than restoring its background',async()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 saveLogo(storage,{data:'transparent',sourceData:'original',name:'Logo.png',localProcessed:true});
 const saved=loadSavedLogo(storage);assert.equal(saved.localProcessed,true);
 const logo={logoImage:saved.data,sourceData:saved.sourceData,localProcessed:saved.localProcessed};let input;
 await preparePlacementLogo(logo,async(_path,options)=>{input=JSON.parse(options.body);return Response.json({dataUrl:'data:image/png;base64,transparent-cropped'});});
 assert.equal(input.logoImage,'transparent');assert.equal(logo.sourceData,'original');assert.equal(logo.logoImage,'transparent-cropped');
});
