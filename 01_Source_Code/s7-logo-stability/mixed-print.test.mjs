import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import * as versions from './generation-versions.mjs';
import * as schemes from './schemes.mjs';
import {resolveTargetPrint} from './target-print.mjs';
import {renderLogoSet} from './index.mjs';
import {buildAiMockupPlan} from './ai-mockup-generation.mjs';
import {isLocalMockup,preservePrintSurface} from './ai-mockup-provider.mjs';
import {createFoilPolicy} from './foil-policy.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {userSpace} from './user-space.mjs';
import {createGenerationJobs} from './generation-jobs.mjs';
import {createMultiProductJobs} from './multi-product-jobs.mjs';
import {createMultiLogoJobs} from './multi-logo-render.mjs';

const targets=[{id:'body',masterZoneId:'body',carrierType:'BODY',x:.25,y:.5,widthRatio:.2},{id:'box',masterZoneId:'box',carrierType:'CARTON_FRONT',x:.75,y:.5,widthRatio:.2}];
const mixed=(version='MIX_ORIGINAL_GOLD')=>schemes.ensureMixedSchemes(schemes.createSchemes(targets),[version]);
const data=bytes=>'data:image/png;base64,'+bytes.toString('base64');

test('finite mixed IDs select independent finishes without changing legacy defaults',()=>{
 assert.equal(typeof versions.mixedVersion,'function');
 assert.equal(versions.mixedGenerationVersions.length,36);
 assert.equal(versions.mixedVersion('ORIGINAL','GOLD FOIL'),'MIX_ORIGINAL_GOLD');
 assert.deepEqual(versions.mixedVersionFinishes('MIX_ROSE_LASER'),{product:'ROSE GOLD FOIL',carton:'LASER FOIL'});
 assert.equal(versions.mixedVersionName('MIX_ORIGINAL_GOLD'),'产品原色 · 彩盒烫金');
 assert.equal(versions.isMixedVersion('MIX_ORIGINAL_GOLD_extra'),false);
 assert.throws(()=>versions.mixedVersion('CUSTOM','BLACK'));
 assert.deepEqual(versions.selectGenerationVersions({selectedVersions:['MIX_ORIGINAL_GOLD','BLACK']}),['BLACK','MIX_ORIGINAL_GOLD']);
 assert.deepEqual(versions.selectGenerationVersions(),['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL']);
 assert.equal(versions.generationVersions.length,7);
});

test('mixed schemes preserve existing edits and require explicit matching finishes',()=>{
 assert.equal(typeof schemes.ensureMixedSchemes,'function');
 const state=mixed(),again=schemes.ensureMixedSchemes(state,['MIX_ORIGINAL_GOLD','MIX_BLACK_SILVER']);
 assert.deepEqual(again.schemes.slice(0,state.schemes.length),state.schemes);
 assert.equal(again.schemes.length,9);
 const chosen=schemes.schemeTargets({targets,schemes:again.schemes},'MIX_ORIGINAL_GOLD');
 assert.deepEqual(chosen.map(t=>[t.printFinish,t.preserveOriginalColor,t.autoContrast]),[['INK',true,false],['GOLD FOIL',false,false]]);
 assert.equal(schemes.schemeTargets({targets,schemes:again.schemes},'MIX_BLACK_SILVER')[0].autoContrast,true);
 const forged=structuredClone(again);forged.schemes.at(-1).targets[0].printFinish='VERSION';
 assert.throws(()=>schemes.schemeTargets({targets,schemes:forged.schemes},'MIX_BLACK_SILVER'),/搭配|工艺/);
 assert.throws(()=>resolveTargetPrint({id:'body'},'MIX_ORIGINAL_GOLD'),/工艺|版本|搭配/);
 assert.throws(()=>resolveTargetPrint({id:'body'},'UNKNOWN'),/工艺|版本/);
});

test('adding a target and changing its carrier keeps mixed finishes explicit and shared geometry editable',()=>{
 const state=mixed(),nextTargets=[...targets,{id:'new',carrierType:'BODY',x:.5,y:.25,widthRatio:.1}];
 const added=schemes.editScheme(state,'MIX_ORIGINAL_GOLD',nextTargets);
 assert.equal(schemes.schemeTargets({targets:nextTargets,schemes:added.schemes},'MIX_ORIGINAL_GOLD').at(-1).printFinish,'INK');
 const moved=nextTargets.map(t=>t.id==='new'?{...t,carrierType:'CARTON_FRONT',x:.55}:t);
 const changed=schemes.editScheme(added,'MIX_ORIGINAL_GOLD',moved);
 const target=schemes.schemeTargets({targets:moved,schemes:changed.schemes},'MIX_ORIGINAL_GOLD').at(-1);
 assert.equal(target.printFinish,'GOLD FOIL');assert.equal(target.x,.55);
});

test('mixed render produces only selected images with carton-only metallic masks and local/AI plans',async()=>{
 const state=mixed();
 const base=await sharp({create:{width:100,height:40,channels:4,background:'#cccccc'}}).png().toBuffer();
 const logo=await sharp({create:{width:12,height:6,channels:4,background:'#dd2211'}}).png().toBuffer();
 const selectedVersions=['MIX_ORIGINAL_GOLD'],set=await renderLogoSet({baseImage:base,logoImage:logo,targets,schemes:state.schemes,selectedVersions,originalColor:'#000000'});
 assert.deepEqual(set.outputs.map(o=>o.version),['MIX_ORIGINAL_GOLD']);
 const output=set.outputs[0],pixels=await sharp(output.bytes).raw().toBuffer(),foil=await sharp(output.foilMask).greyscale().raw().toBuffer();
 assert.deepEqual([...pixels.subarray((20*100+25)*4,(20*100+25)*4+3)],[221,34,17]);
 assert.equal(foil[20*100+25],0);assert.equal(foil[20*100+75],255);
 const guides=[{version:output.version,dataUrl:data(output.bytes),maskDataUrl:data(output.mask),foilMaskDataUrl:data(output.foilMask),goldMaskDataUrl:data(output.goldMask),roseMaskDataUrl:data(output.roseMask),laserMaskDataUrl:data(output.laserMask)}];
 for(const model of ['flux-3-image','gpt-image-2']){
  const [plan]=buildAiMockupPlan({model,baseImage:data(base),logoImage:data(logo),targets,schemes:state.schemes,selectedVersions,originalColor:'#000000',guides});
  assert.equal(plan.version,'MIX_ORIGINAL_GOLD');assert.equal(isLocalMockup(plan),true);
  assert.match(plan.request.prompt,/body.*finish ORIGINAL|body.*print_finish.*ORIGINAL/s);
  assert.match(plan.request.prompt,/box.*finish GOLD FOIL|box.*print_finish.*GOLD FOIL/s);
  const local=await preservePrintSurface({...plan,local:true},base);assert.equal((await sharp(local).metadata()).width,100);
 }
});

test('all 36 combinations produce complete deterministic renders and model plans',async()=>{
 const selectedVersions=versions.mixedGenerationVersions,state=schemes.ensureMixedSchemes(schemes.createSchemes(targets),selectedVersions);
 const base=await sharp({create:{width:60,height:30,channels:4,background:'#ccc'}}).png().toBuffer(),logo=await sharp({create:{width:6,height:3,channels:4,background:'#dd2211'}}).png().toBuffer();
 const rendered=await renderLogoSet({baseImage:base,logoImage:logo,targets,schemes:state.schemes,selectedVersions,originalColor:'#dd2211'});
 assert.equal(rendered.outputs.length,36);
 for(const output of rendered.outputs){
  const foil=await sharp(output.foilMask).greyscale().raw().toBuffer(),tokens=output.version.split('_');
  assert.equal(foil[15*60+15]>0,!['ORIGINAL','BLACK'].includes(tokens[1]));
  assert.equal(foil[15*60+45]>0,!['ORIGINAL','BLACK'].includes(tokens[2]));
 }
 const guides=rendered.outputs.map(o=>({version:o.version,dataUrl:data(o.bytes),maskDataUrl:data(o.mask),foilMaskDataUrl:data(o.foilMask)}));
 for(const model of ['gpt-image-2','flux-3-image']){
  const plans=buildAiMockupPlan({model,targets,schemes:state.schemes,baseImage:data(base),logoImage:data(logo),originalColor:'#dd2211',selectedVersions,guides});
  assert.equal(plans.length,36);assert.deepEqual(plans.map(p=>p.version),selectedVersions);
  assert.ok(plans.every(plan=>isLocalMockup(plan)&&!plan.request.prompt.includes('undefined')));
 }
});

test('mixed foil policy uses authoritative carrier permissions and requires carton acknowledgement',async()=>{
 const template={id:'master',version:1,zones:targets.map(t=>({id:t.masterZoneId,zoneType:'logo',name:t.id})),automation:{carriers:[{id:'b',type:'BODY'},{id:'c',type:'CARTON'}],areas:[{zoneId:'body',carrierId:'b',foilProcesses:['GOLD FOIL']},{zoneId:'box',carrierId:'c',foilProcesses:[]}]}};
 const policy=createFoilPolicy({productCatalog:async()=>[{id:'p',sku:'P'}],productTemplate:async()=>({template})});
 const input={taskId:'t',productId:'p',selectedVersions:['MIX_ORIGINAL_GOLD'],foilRegions:['product'],targets,schemes:mixed().schemes};
 const preview=await policy.prepare(input,{},{});
 assert.equal(preview.report.blocked.length,0);assert.equal(preview.report.warnings.length,1);
 await assert.rejects(()=>policy.prepare(input,{},{requireConfirmation:true}),e=>e.code==='CARTON_FOIL_CONFIRMATION_REQUIRED');
 const approved=await policy.prepare({...input,foilAcknowledgement:preview.report.confirmationToken},{},{requireConfirmation:true});
 assert.deepEqual(approved.input.schemes.at(-1).targets.map(t=>t.printFinish),['INK','GOLD FOIL']);
 const blocked={...input,selectedVersions:['MIX_SILVER_ORIGINAL'],foilRegions:[],schemes:mixed('MIX_SILVER_ORIGINAL').schemes};
 blocked.schemes.at(-1).targets[0].carrierType='CARTON_FRONT';
 await assert.rejects(()=>policy.prepare(blocked,{},{requireConfirmation:true}),e=>e.code==='FOIL_BLOCKED');
});

for(const kind of ['single','multi-product','multi-logo'])test(`${kind} saves selected mixed results and restores them with a new jobs service`,async()=>{
 const folder=await mkdtemp(join(tmpdir(),'s7-mixed-persistence-')),spaces=userSpace(folder),user={id:'mixed-test'};
 try{
  const task=await spaces.createTask(user,{title:'mixed'}),state=mixed('MIX_BLACK_SILVER');
  const base=await sharp({create:{width:100,height:40,channels:4,background:'#ccc'}}).png().toBuffer();
  const mark=await sharp({create:{width:8,height:4,channels:4,background:'#dd2211'}}).png().toBuffer();
  const logo=await sharp({create:{width:10,height:6,channels:4,background:'#00000000'}}).composite([{input:mark,left:1,top:1}]).png().toBuffer();
  const selectedVersions=['MIX_BLACK_SILVER'],input={model:'local',logoImage:logo.toString('base64'),selectedVersions,targets,schemes:state.schemes};
  const renderer=async request=>request.guides.map(g=>({version:g.version,bytes:Buffer.from(g.dataUrl.split(',')[1],'base64')}));
  const options={productTemplate:async()=>assert.fail('explicit layouts must be used'),productImage:async()=>({bytes:base}),mockupRenderer:renderer};
  let jobs;
  if(kind==='single'){
   jobs=createGenerationJobs(spaces);
   await jobs.start(user,task.id,input,async()=>{const result=await renderLogoSet({...input,baseImage:base,logoImage:logo});return result.outputs;});
  }else if(kind==='multi-product'){
   jobs=createMultiProductJobs(spaces,options);
   await jobs.start(user,task.id,{...input,productLayouts:['p','q'].map(productId=>({productId,targets,schemes:state.schemes}))},['p','q'].map(id=>({id,sku:id})),{});
  }else{
   jobs=createMultiLogoJobs(spaces,renderer);
   await jobs.start(user,task.id,{...input,baseImage:base,product:{id:'p',sku:'p'},logos:['a','b'].map(id=>({id,name:id,logoImage:logo.toString('base64')})),logoLayouts:['a','b'].map(logoId=>({logoId,targets,schemes:state.schemes}))});
  }
  let record;
  for(let i=0;i<200;i++){record=await jobs.read(user,task.id);if(record.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(record.status,'complete');assert.equal(record.outputs.length,kind==='single'?1:2);
  assert.ok(record.outputs.every(o=>o.version==='MIX_BLACK_SILVER'));
  const restored=kind==='single'?createGenerationJobs(spaces):kind==='multi-product'?createMultiProductJobs(spaces,options):createMultiLogoJobs(spaces,renderer);
  assert.deepEqual(await restored.read(user,task.id),record);
  const history=await spaces.history(user,task.id);assert.equal(history.flatMap(h=>h.images).length,record.outputs.length);
 }finally{await rm(folder,{recursive:true,force:true});}
});
