import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {selectGenerationVersions} from './generation-versions.mjs';
import {resolveTargetPrint} from './target-print.mjs';
import {createSchemes,editScheme,schemeTargets} from './schemes.mjs';
import {renderLogoSet} from './index.mjs';
import {buildAiMockupPlan} from './ai-mockup-generation.mjs';
import {preservePrintSurface,isLocalMockup} from './ai-mockup-provider.mjs';
import {renderTintedLogoLayer} from './preview-logo-layer.mjs';

const finishes=['GOLD FOIL','SILVER FOIL','ROSE GOLD FOIL','LASER FOIL'];
const target={id:'box',x:.5,y:.5,widthRatio:.6,carrierType:'CARTON_FRONT'};
const data=bytes=>'data:image/png;base64,'+bytes.toString('base64');

test('new finishes are opt-in while the historical default remains four outputs',()=>{
 assert.deepEqual(selectGenerationVersions(),['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL']);
 assert.deepEqual(selectGenerationVersions({selectedVersions:['LASER FOIL','ROSE GOLD FOIL']}),['ROSE GOLD FOIL','LASER FOIL']);
});

test('explicit carton finishes resolve independently of output version including CUSTOM',()=>{
 for(const [printFinish,color,finish] of [['ROSE GOLD FOIL','#C58F86','rose'],['LASER FOIL','#BFC3C9','laser'],['GOLD FOIL','#C4A052','gold'],['SILVER FOIL','#BFC3C9','silver']]){
  for(const version of ['BLACK','CUSTOM'])assert.deepEqual(resolveTargetPrint({...target,printFinish},version),{carrierType:'CARTON_FRONT',printFinish,version:printFinish,color,finish});
 }
 assert.equal(resolveTargetPrint(target,'LASER FOIL').finish,'flat');
});

test('schemes keep new carton finishes ordinary by default and preserve explicit carton foil during edits',()=>{
 let state=createSchemes([target]);
 for(const version of finishes)assert.equal(schemeTargets(state,version)[0].printFinish,'INK');
 const edited=structuredClone(schemeTargets(state,'ROSE GOLD FOIL'));edited[0].printFinish='ROSE GOLD FOIL';
 state=editScheme(state,'ROSE GOLD FOIL',edited);
 assert.equal(schemeTargets(state,'ROSE GOLD FOIL')[0].printFinish,'ROSE GOLD FOIL');
 const moved=structuredClone(schemeTargets(state,'ORIGINAL'));moved[0].x=.55;
 state=editScheme(state,'ORIGINAL',moved);
 assert.equal(schemeTargets(state,'ROSE GOLD FOIL')[0].printFinish,'ROSE GOLD FOIL');
});

for(const model of ['gpt-image-2','flux-3-image'])test(`${model} describes requested rose and holographic carton foil without global carton prohibition`,()=>{
 const targets=[{...target,printFinish:'ROSE GOLD FOIL'},{...target,id:'tube',carrierType:'BODY',printFinish:'LASER FOIL'}];
 const [plan]=buildAiMockupPlan({model,originalColor:'#000000',onlyVersion:'LASER FOIL',targets,baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',guides:[{version:'LASER FOIL',dataUrl:'data:image/png;base64,GUIDE'}]});
 assert.match(plan.request.prompt,/box[^\n]*rose.gold/i);
 assert.match(plan.request.prompt,/tube[^\n]*holographic|tube[^\n]*diffraction/i);
 assert.doesNotMatch(plan.request.prompt,/No gold foil, silver foil or metallic reflection on carton/);
});

test('new preview finishes have their own reflective palettes',()=>{
 const palettes=[];
 for(const finish of ['gold','silver','rose','laser']){
  const stops=[];const context={drawImage(){},fillRect(){},createLinearGradient:()=>({addColorStop:(position,color)=>stops.push(color)})};
  renderTintedLogoLayer({createCanvas:(width,height)=>({width,height,getContext:()=>context}),logoImage:{},width:100,height:50,color:'#C58F86',finish});palettes.push(stops);
 }
 assert.ok(palettes.every(p=>p.length>=4));
 assert.equal(new Set(palettes.map(JSON.stringify)).size,4);
});

test('all four local finishes keep one mask and original non-logo pixels, with rose hue and laser chromatic variation',async()=>{
 const width=96,height=48,baseImage=await sharp({create:{width,height,channels:4,background:{r:80,g:100,b:120,alpha:.7}}}).png().toBuffer();
 const logoImage=await sharp(Buffer.from('<svg width="24" height="12"><path fill="black" d="M0 0H24V12H0Z M8 4V8H16V4Z" fill-rule="evenodd"/></svg>')).png().toBuffer();
 const targets=[{...target,carrierType:'BODY'}];
 const guides=await renderLogoSet({baseImage,logoImage,targets,selectedVersions:finishes});
 assert.deepEqual(guides.outputs.map(o=>o.version),finishes);
 const base=await sharp(baseImage).ensureAlpha().raw().toBuffer();let referenceMask;
 for(const guide of guides.outputs){
  const mask=await sharp(guide.mask).greyscale().raw().toBuffer();
  if(referenceMask)assert.deepEqual(mask,referenceMask);else referenceMask=mask;
  const [plan]=buildAiMockupPlan({model:'local',originalColor:'#000000',onlyVersion:guide.version,targets,baseImage:data(baseImage),logoImage:data(logoImage),guides:[{version:guide.version,dataUrl:data(guide.bytes),maskDataUrl:data(guide.mask),foilMaskDataUrl:data(guide.foilMask),goldMaskDataUrl:data(guide.goldMask),roseMaskDataUrl:guide.roseMask&&data(guide.roseMask),laserMaskDataUrl:guide.laserMask&&data(guide.laserMask)}]});
  assert.equal(isLocalMockup(plan),true);
  const raw=await sharp(await preservePrintSurface({...plan,local:true},baseImage)).ensureAlpha().raw().toBuffer();
  const colors=[];
  for(let i=0;i<mask.length;i++){
   assert.equal(raw[i*4+3],base[i*4+3]);
   if(mask[i]===0)assert.deepEqual(raw.subarray(i*4,i*4+4),base.subarray(i*4,i*4+4));
   if(mask[i]===255)colors.push([...raw.subarray(i*4,i*4+3)]);
  }
  assert.ok(colors.length>20);
  if(guide.version==='ROSE GOLD FOIL')assert.ok(colors.some(([r,g,b])=>r>g+15&&r>b+10));
  if(guide.version==='LASER FOIL'){
   assert.ok(colors.some(([r,g,b])=>r>g+15||r>b+15));
   assert.ok(colors.some(([r,g,b])=>b>r+15||g>r+15));
  }
 }
});



test('legacy states gain missing foil schemes without losing their saved custom or independent work',async()=>{
 const {ensureFoilSchemes}=await import('./schemes.mjs');
 assert.equal(typeof ensureFoilSchemes,'function');
 const state=createSchemes([{...target,id:'body',carrierType:'BODY',printFinish:'GOLD FOIL'},target]);
 state.schemes=state.schemes.filter(s=>!['ROSE GOLD FOIL','LASER FOIL'].includes(s.version));
 state.schemes[0].targets[0].x=.4;
 const before=structuredClone(state),upgraded=ensureFoilSchemes(state);
 assert.deepEqual(upgraded.schemes.slice(0,5),before.schemes);
 for(const version of ['ROSE GOLD FOIL','LASER FOIL']){
  const scheme=schemeTargets(upgraded,version);
  assert.equal(scheme[0].printFinish,'VERSION');assert.equal(scheme[1].printFinish,'INK');
  assert.equal(scheme[0].x,.5);
 }
 assert.deepEqual(ensureFoilSchemes(upgraded),upgraded);assert.deepEqual(state,before);
});

test('prepared generation carries rose and laser masks to local final rendering',async()=>{
 const {prepareGenerationImage}=await import('./prepared-generation.mjs');
 const baseImage=await sharp({create:{width:80,height:40,channels:4,background:'#aaaaaa'}}).png().toBuffer();
 const logoImage=await sharp({create:{width:12,height:6,channels:4,background:'#000000'}}).png().toBuffer();
 const {input}=await prepareGenerationImage({baseImage,logoImage,targets:[{...target,carrierType:'BODY'}],selectedVersions:['ROSE GOLD FOIL','LASER FOIL'],model:'local'});
 assert.ok(input.guides[0].roseMaskDataUrl);assert.ok(input.guides[1].laserMaskDataUrl);
});

test('explicit carton foil survives BLACK scheme initialization',()=>{
 const state=createSchemes([{...target,printFinish:'ROSE GOLD FOIL'}]);
 assert.equal(schemeTargets(state,'BLACK')[0].printFinish,'ROSE GOLD FOIL');
});

test('multi-logo rendering still accepts saved five-scheme layouts for existing selected versions',async()=>{
 const {createMultiLogoJobs}=await import('./multi-logo-render.mjs');
 const baseImage=await sharp({create:{width:80,height:40,channels:4,background:'#aaaaaa'}}).png().toBuffer();
 const logoImage=await sharp(Buffer.from('<svg width="12" height="6"><path fill="black" d="M1 1H11V5H1Z"/></svg>')).png().toBuffer();
 const targets=[{...target,id:'body',carrierType:'BODY'}],schemes=createSchemes(targets).schemes.filter(s=>!['ROSE GOLD FOIL','LASER FOIL'].includes(s.version));
 let record;
 const spaces={task:async()=>({state:{}}),generation:async()=>record,updateGeneration:async(user,taskId,update)=>record=update(record),save:async()=>({images:[{url:'/saved.png'}]})};
 const jobs=createMultiLogoJobs(spaces,async input=>input.selectedVersions.map(version=>({version,bytes:baseImage})));
 await jobs.start({id:'user'},'task',{model:'local',product:{id:'p',sku:'p'},baseImage,targets,selectedVersions:['BLACK'],logos:['one','two'].map(id=>({id,name:id,logoImage:logoImage.toString('base64')})),logoLayouts:[{logoId:'one',targets,schemes}]});
 for(let n=0;n<200&&record.status==='running';n++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(record.status,'complete');assert.equal(record.outputs.length,2);
});
