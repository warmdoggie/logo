import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import * as schemes from './schemes.mjs';
import {renderLogoSet} from './index.mjs';
import {buildAiMockupPlan} from './ai-mockup-generation.mjs';
import {selectGenerationVersions} from './generation-versions.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createDemoServer} from './demo-server.mjs';
import {copyScopedPreset} from './product-preset.mjs';
import {isCarton} from './target-print.mjs';

const targets=[
  {id:'product',carrierType:'BODY',x:.25,y:.5,widthRatio:.2,color:'#123456',printFinish:'GOLD FOIL',preserveOriginalColor:true,autoContrast:true},
  {id:'front',carrierType:'CARTON_FRONT',x:.6,y:.5,widthRatio:.2,color:'#654321',printFinish:'BLACK'},
  {id:'back',carrierType:'CARTON_BACK',x:.85,y:.5,widthRatio:.2,color:'#654321',printFinish:'INK'}
];

test('fifth custom scheme uses separate ordinary ink colors for products and cartons',()=>{
  const state=schemes.createSchemes(targets),custom=state.schemes.find(scheme=>scheme.version==='CUSTOM');
  assert.ok(custom,'每个 SKU 应有自定义方案');
  assert.deepEqual(custom.targets.map(target=>[target.color,target.printFinish,target.autoContrast,target.preserveOriginalColor]),[
    ['#123456','INK',false,false],['#654321','INK',false,false],['#654321','INK',false,false]
  ]);
  assert.deepEqual(state.sharedTargets,targets);
  assert.deepEqual(selectGenerationVersions({selectedVersions:['CUSTOM']}),['CUSTOM']);
});

test('custom group colors affect every matching region without altering other schemes or geometry',()=>{
  assert.equal(typeof schemes.setCustomColors,'function','应提供分别设置产品和彩盒颜色的功能');
  const state=schemes.createSchemes(targets),before=structuredClone(state);
  const updated=schemes.setCustomColors(state,{product:'#ff0000',carton:'#00ff00'});
  assert.deepEqual(updated.schemes.find(s=>s.version==='CUSTOM').targets.map(t=>[t.id,t.color,t.x]),[
    ['product','#ff0000',.25],['front','#00ff00',.6],['back','#00ff00',.85]
  ]);
  assert.deepEqual(updated.schemes.filter(s=>s.version!=='CUSTOM'),before.schemes.filter(s=>s.version!=='CUSTOM'));
  assert.deepEqual(state,before);
  assert.throws(()=>schemes.setCustomColors(state,{product:'invalid'}),/颜色/);
});

test('custom color sync changes only the destination custom colors, including a different carton face',()=>{
  assert.equal(typeof schemes.copyCustomColors,'function','应提供跨 SKU 同步自定义颜色的功能');
  const source=schemes.createSchemes(targets.slice(0,2));
  const destination=schemes.createSchemes([{...targets[0],id:'other-product',x:.3},{...targets[2],id:'other-back'}]);
  const before=structuredClone(destination);
  const updated=schemes.copyCustomColors(source,destination);
  assert.deepEqual(updated.schemes.find(s=>s.version==='CUSTOM').targets.map(t=>[t.id,t.color,t.x]),[
    ['other-product','#123456',.3],['other-back','#654321',.85]
  ]);
  assert.deepEqual(updated.schemes.filter(s=>s.version!=='CUSTOM'),before.schemes.filter(s=>s.version!=='CUSTOM'));
  assert.deepEqual(updated.sharedTargets,before.sharedTargets);
  assert.deepEqual(destination,before);
});

test('restoring an existing four-scheme task adds custom without changing existing work',()=>{
  assert.equal(typeof schemes.ensureCustomScheme,'function','旧任务应补齐自定义版本');
  const legacy=schemes.createSchemes(targets);legacy.schemes=legacy.schemes.filter(s=>['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL'].includes(s.version));
  legacy.schemes[0].targets[0].x=.35;
  const before=structuredClone(legacy),updated=schemes.ensureCustomScheme(legacy);
  assert.equal(updated.schemes.length,5);
  assert.deepEqual(updated.schemes.slice(0,4),before.schemes);
  assert.deepEqual(schemes.ensureCustomScheme(updated),updated);
  assert.deepEqual(legacy,before);
});

test('new and reclassified regions inherit their custom product or carton group color',()=>{
  let state=schemes.setCustomColors(schemes.createSchemes(targets.slice(0,2)),{product:'#ff0000',carton:'#00ff00'});
  const added=[...state.schemes[0].targets,{...targets[2],color:'#000000'}];
  state=schemes.editScheme(state,'ORIGINAL',added);
  assert.deepEqual(state.schemes.find(s=>s.version==='CUSTOM').targets.map(t=>t.color),['#ff0000','#00ff00','#00ff00']);
  const reclassified=structuredClone(state.schemes[0].targets);reclassified[2].carrierType='BODY';
  state=schemes.editScheme(state,'ORIGINAL',reclassified);
  assert.deepEqual(state.schemes.find(s=>s.version==='CUSTOM').targets.map(t=>t.color),['#ff0000','#00ff00','#ff0000']);
});

test('new and legacy tasks initialize custom with one color per carrier group',()=>{
  const mixed=[...targets,{...targets[0],id:'product-2',color:'#abcdef'},{...targets[2],id:'back-2',color:'#fedcba'}];
  const state=schemes.createSchemes(mixed);
  const legacy=structuredClone(state);legacy.schemes=legacy.schemes.filter(s=>s.version!=='CUSTOM');
  for(const candidate of [state,schemes.ensureCustomScheme(legacy)])assert.deepEqual(candidate.schemes.find(s=>s.version==='CUSTOM').targets.map(t=>t.color),['#123456','#654321','#654321','#123456','#654321']);
  assert.equal(state.schemes[0].targets[3].color,'#abcdef');
  assert.equal(state.schemes[0].targets[4].color,'#fedcba');
});

test('custom generation preserves distinct product and carton colors in pixels and both model requests',async()=>{
  const state=schemes.createSchemes(targets.map(t=>({...t,printFinish:'INK',autoContrast:false,preserveOriginalColor:false})));
  if(!state.schemes.some(s=>s.version==='CUSTOM'))state.schemes.push({version:'CUSTOM',targets:structuredClone(targets)});
  const baseImage=await sharp({create:{width:200,height:100,channels:4,background:'#ffffff'}}).png().toBuffer();
  const logoImage=await sharp({create:{width:20,height:10,channels:4,background:'#000000'}}).png().toBuffer();
  const result=await renderLogoSet({baseImage,logoImage,targets,schemes:state.schemes,selectedVersions:['CUSTOM']});
  assert.equal(result.outputs.length,1);assert.equal(result.outputs[0].version,'CUSTOM');
  const raw=await sharp(result.outputs[0].bytes).ensureAlpha().raw().toBuffer();
  for(const [x,rgb] of [[50,[18,52,86]],[120,[101,67,33]],[170,[101,67,33]]])assert.deepEqual([...raw.subarray((50*200+x)*4,(50*200+x)*4+3)],rgb);
  for(const model of ['flux-3-image','gpt-image-2']){
    const plan=buildAiMockupPlan({model,baseImage:'data:image/png;base64,BASE',logoImage:'data:image/png;base64,LOGO',originalColor:'#000000',targets,schemes:state.schemes,onlyVersion:'CUSTOM',guides:[{version:'CUSTOM',dataUrl:'data:image/png;base64,GUIDE'}]});
    assert.equal(plan.length,1);assert.equal(plan[0].version,'CUSTOM');
    assert.match(plan[0].request.prompt,/Target "product"[^\n]*#123456/);
    assert.match(plan[0].request.prompt,/Target "front"[^\n]*#654321/);
    assert.doesNotMatch(plan[0].request.prompt,/undefined/);
  }
});

test('workspace sync loads unopened SKUs and saves their updated custom scheme for generation',async()=>{
  const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
  const start=source.indexOf('async function applyPresetToOtherProducts(');
  assert.ok(start>=0,'界面应提供同步自定义颜色的操作');
  const destination=schemes.createSchemes([{...targets[0],id:'other-body'},{...targets[2],id:'other-box'}]);
  const before=structuredClone(destination);let saved=0,loaded=0;
  const c=vm.createContext({logoImage:null,structuredClone,copyScopedPreset,isCarton,copyingProductPreset:false,generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,selectedMultiProductId:'a',loadedMultiProductId:'a',activeScheme:'CUSTOM',schemeState:schemes.setCustomColors(schemes.createSchemes(targets),{product:'#ff0000',carton:'#00ff00'}),multiPackageProducts:[{id:'a'},{id:'b'}],multiProductViews:new Map(),saveMultiProductView(){},updateGenerateButton(){},queueSchemeCards(){},renderMultiProductResults(){},loadSchemeTargets(){},setStatus(){},taskDraft:{schedule(){saved++;}},loadMultiProductView:async()=>{loaded++;const view={schemeState:destination,activeScheme:'ORIGINAL',savedSignatures:{CUSTOM:'previous'}};c.multiProductViews.set('b',view);return view;}});
  c.multiProductViews.set('a',{schemeState:c.schemeState,activeScheme:'CUSTOM'});
  vm.runInContext(source.slice(start,source.indexOf('function openProductPresetScope(',start)),c);
  await c.applyPresetToOtherProducts(['product/CUSTOM/color','carton/CUSTOM/color']);
  assert.equal(loaded,1);assert.equal(saved,1);assert.equal(c.copyingProductPreset,false);
  const view=c.multiProductViews.get('b');
  assert.deepEqual(view.schemeState.schemes.find(s=>s.version==='CUSTOM').targets.map(t=>t.color),['#ff0000','#00ff00']);
  assert.deepEqual(view.schemeState.schemes.slice(0,4),before.schemes.slice(0,4));
  assert.deepEqual(view.targets,before.schemes[0].targets);assert.equal(view.savedSignatures.CUSTOM,'previous');
});

test('sync keeps the destination latest geometry when it is edited while loading',async()=>{
  const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
  const destination={schemeState:schemes.createSchemes(targets),activeScheme:'ORIGINAL'};
  let c;
  c=vm.createContext({logoImage:null,structuredClone,copyScopedPreset,isCarton,copyingProductPreset:false,generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,selectedMultiProductId:'a',loadedMultiProductId:'a',activeScheme:'CUSTOM',schemeState:schemes.setCustomColors(schemes.createSchemes(targets),{product:'#ff0000',carton:'#00ff00'}),multiPackageProducts:[{id:'a'},{id:'b'}],multiProductViews:new Map([['b',destination]]),saveMultiProductView(){if(c.loadedMultiProductId==='b'){const latest=structuredClone(destination);latest.schemeState.schemes[0].targets[0].x=.8;c.multiProductViews.set('b',latest);}},updateGenerateButton(){},queueSchemeCards(){},renderMultiProductResults(){},loadSchemeTargets(){},setStatus(){},taskDraft:{schedule(){}},loadMultiProductView:async()=>{c.loadedMultiProductId='b';return destination;}});
  const start=source.indexOf('async function applyPresetToOtherProducts(');
  c.multiProductViews.set('a',{schemeState:c.schemeState,activeScheme:'CUSTOM'});
  vm.runInContext(source.slice(start,source.indexOf('function openProductPresetScope(',start)),c);
  await c.applyPresetToOtherProducts(['product/CUSTOM/color','carton/CUSTOM/color']);
  assert.equal(c.multiProductViews.get('b').schemeState.schemes[0].targets[0].x,.8);
  assert.equal(c.multiProductViews.get('b').schemeState.schemes.find(s=>s.version==='CUSTOM').targets[0].color,'#ff0000');
});

test('local render endpoint honors selecting only the custom version',async()=>{
  const server=createDemoServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const image=await sharp({create:{width:200,height:100,channels:4,background:'#ffffff'}}).png().toBuffer();
    const logo=await sharp({create:{width:20,height:10,channels:4,background:'#000000'}}).png().toBuffer();
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/render`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseImage:image.toString('base64'),logoImage:logo.toString('base64'),targets,schemes:schemes.createSchemes(targets).schemes,selectedVersions:['CUSTOM']})});
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).outputs.map(o=>o.version),['CUSTOM']);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
