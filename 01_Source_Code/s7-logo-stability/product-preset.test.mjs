import test from 'node:test';
import assert from 'node:assert/strict';
import {createSchemes,setCustomColors} from './schemes.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {copyScopedPreset} from './product-preset.mjs';

async function copyPreset(){
  const module=await import('./product-preset.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
  assert.equal(typeof module.copyProductPreset,'function','应提供跨产品复制预设的功能');
  return module.copyProductPreset;
}
const target=(id,carrierType='BODY')=>({id,carrierType,x:.5,y:.5,widthRatio:.15,rotation:0,curve:0,surface:'free',color:'#000000',preserveOriginalColor:true,autoContrast:true,masterZoneId:id,masterLocked:true});

test('自定义版本的颜色按产品和彩盒分组同步，跨正反面及多个区域且不改其他版本',async()=>{
  const copy=await copyPreset();
  const source=setCustomColors(createSchemes([target('body'),target('front','CARTON_FRONT')]),{product:'#123456',carton:'#FF0000'});
  const destination=createSchemes([{...target('b-body'),x:.2},target('b-back','CARTON_BACK'),target('b-front','CARTON_FRONT'),target('b-front-2','CARTON_FRONT')]);
  const before=structuredClone(destination),copied=copy(source,destination,[],{size:false,rotation:false,color:true,printFinish:false,version:'CUSTOM'});
  assert.deepEqual(copied.schemes.find(s=>s.version==='CUSTOM').targets.map(t=>t.color),['#123456','#FF0000','#FF0000','#FF0000']);
  assert.deepEqual(copied.schemes.slice(0,4),before.schemes.slice(0,4));assert.deepEqual(copied.sharedTargets,before.sharedTargets);
  assert.equal(copied.schemes.find(s=>s.version==='CUSTOM').targets[0].x,.2);
  assert.deepEqual(destination,before);
});

test('自定义版本勾选大小角度时只改第五版布局，取消颜色时保留原自定义颜色',async()=>{
  const copy=await copyPreset(),source=createSchemes([{...target('a'),widthRatio:.3,rotation:45,color:'#FF0000'}]),destination=createSchemes([{...target('b'),x:.2,widthRatio:.1,color:'#0000FF'}]);
  const before=structuredClone(destination),copied=copy(source,destination,[{...target('b'),x:.7}],{version:'CUSTOM',size:true,rotation:true,color:false,printFinish:false});
  const custom=copied.schemes.find(s=>s.version==='CUSTOM');
  assert.equal(custom.targets[0].widthRatio,.3);assert.equal(custom.targets[0].rotation,45);assert.equal(custom.targets[0].x,.7);assert.equal(custom.targets[0].color,'#0000FF');
  assert.equal(custom.independentGeometry,true,'自定义摆放不能被其他版本的公共摆放覆盖');
  assert.deepEqual(copied.schemes.slice(0,4),before.schemes.slice(0,4));assert.deepEqual(copied.sharedTargets,before.sharedTargets);
});

test('工具栏在自定义版同步颜色时支持仅有不同彩盒面的其他 SKU，并保存结果',async()=>{
  const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
  const sourceState=setCustomColors(createSchemes([target('a-front','CARTON_FRONT')]),{carton:'#FF0000'});
  const recipient={schemeState:createSchemes([target('b-back','CARTON_BACK')]),activeScheme:'CUSTOM',placementScope:'current'},before=structuredClone(recipient);
  let saved=0;
  const c=vm.createContext({selectedGenerationVersions:()=>['ORIGINAL','BLACK'],logoImage:null,structuredClone,copyScopedPreset,isCarton:t=>['CARTON_FRONT','CARTON_BACK'].includes(t.carrierType),copyingProductPreset:false,generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,activeScheme:'CUSTOM',selectedMultiProductId:'a',loadedMultiProductId:'a',multiPackageProducts:[{id:'a'},{id:'b'}],multiProductViews:new Map([['b',recipient]]),schemeState:sourceState,saveMultiProductView(){},updateGenerateButton(){},queueSchemeCards(){},renderMultiProductResults(){},loadSchemeTargets(){},setStatus(){},taskDraft:{schedule(){saved++;}},loadMultiProductView:async()=>recipient});
  vm.runInContext(source.slice(source.indexOf('async function applyPresetToOtherProducts('),source.indexOf('function openProductPresetScope(')),c);
  await c.applyPresetToOtherProducts(['carton/CUSTOM/color']);
  const result=c.multiProductViews.get('b');
  assert.equal(result.schemeState.schemes.find(s=>s.version==='CUSTOM').targets[0].color,'#FF0000');
  assert.deepEqual(result.schemeState.schemes.slice(0,4),before.schemeState.schemes.slice(0,4));
  assert.equal(result.targets[0].color,'#FF0000');assert.equal(saved,1);
});

for(let mask=0;mask<16;mask++)test(`四维同步组合 ${mask} 只改变勾选的大小、颜色、工艺和角度`,async()=>{
  const copy=await copyPreset(),names=['size','color','printFinish','rotation'];
  const options=Object.fromEntries(names.map((name,index)=>[name,Boolean(mask&(1<<index))]));
  const source=createSchemes([{...target('a'),widthRatio:.28,rotation:35,color:'#bc2345',printFinish:'INK',autoContrast:false,preserveOriginalColor:false}]);
  const destination=createSchemes([{...target('b'),widthRatio:.18,rotation:-20,color:'#123456',printFinish:'GOLD FOIL'}]);
  destination.schemes[1].independentGeometry=true;destination.schemes[1].targets[0].rotation=-45;
  const before=structuredClone(destination),copied=copy(source,destination,destination.sharedTargets,options);
  for(const [result,previous,preset] of [[copied.sharedTargets[0],before.sharedTargets[0],source.sharedTargets[0]],...copied.schemes.map((scheme,i)=>[scheme.targets[0],before.schemes[i].targets[0],source.schemes[i].targets[0]])]){
    for(const [key,selected]of [['widthRatio',options.size],['rotation',options.rotation],['color',options.color],['autoContrast',options.color],['preserveOriginalColor',options.color],['printFinish',options.printFinish]])assert.deepEqual(result[key],(selected?preset:previous)[key],`${mask}: ${key}`);
  }
  assert.deepEqual(destination,before);
  if(options.size!==options.rotation)assert.equal(copied.schemes[1].independentGeometry,true,'单项几何同步不能清除接收方案原有的独立布局');
});

for(const dimension of ['size','rotation'])test(`仅同步${dimension==='size'?'大小':'角度'}时，四点区域保留当前位置和另一项几何设置`,async()=>{
  const copy=await copyPreset(),source=createSchemes([{...target('a'),widthRatio:.4,rotation:90}]);
  const destination=createSchemes([{...target('b'),x:.6,y:.5,widthRatio:.2,quad:[{x:.5,y:.45},{x:.7,y:.45},{x:.7,y:.55},{x:.5,y:.55}]}]);
  const options={size:false,color:false,printFinish:false,rotation:false,[dimension]:true};
  const copied=copy(source,destination,[{...target('b'),x:.9}],options),result=copied.schemes[0].targets[0];
  assert.equal(result.x,.6);assert.equal(result.y,.5);
  assert.deepEqual(result.quad,dimension==='size'?[{x:.4,y:.4},{x:.8,y:.4},{x:.8,y:.6},{x:.4,y:.6}]:[{x:.65,y:.4},{x:.65,y:.6},{x:.55,y:.6},{x:.55,y:.4}]);
  assert.equal(result.widthRatio,dimension==='size'?.4:.2);assert.equal(result.rotation,dimension==='rotation'?90:0);
});

for(const dimension of ['size','rotation'])test(`四点中心偏离锚点时，仅同步相同${dimension==='size'?'大小':'角度'}不能导致区域跳位`,async()=>{
  const copy=await copyPreset(),source=createSchemes([{...target('a'),widthRatio:.2}]);
  const quad=[{x:.5,y:.5},{x:.7,y:.5},{x:.7,y:.6},{x:.5,y:.6}];
  const destination=createSchemes([{...target('b'),widthRatio:.2,quad}]);
  const options={size:false,color:false,printFinish:false,rotation:false,[dimension]:true};
  const copied=copy(source,destination,[],options);
  assert.deepEqual(copied.schemes[0].targets[0].quad,quad);
  assert.deepEqual(copied.sharedTargets[0].quad,quad);
});

test('按载体及出现顺序复制各方案的大小、角度和颜色，保留接收产品的区域标识',async()=>{
  const copy=await copyPreset();
  const source=createSchemes([target('source-body'),target('source-box','CARTON_FRONT'),target('source-body-2')]);
  source.schemes[0].targets[0]={...source.schemes[0].targets[0],widthRatio:.27,rotation:-25,color:'#bc2345',preserveOriginalColor:false,autoContrast:false,printFinish:'INK'};
  source.schemes[0].targets[2].widthRatio=.09;
  source.schemes[2].targets[0].color='#aa9900';
  source.schemes[2].independentGeometry=true;
  const destination=createSchemes([target('destination-box','CARTON_FRONT'),target('destination-body'),target('destination-body-2'),target('destination-back','CARTON_BACK')]);
  const original=structuredClone(destination),copied=copy(source,destination,destination.sharedTargets);
  const body=copied.schemes[0].targets[1];
  assert.equal(body.widthRatio,.27);assert.equal(body.rotation,-25);assert.equal(body.color,'#bc2345');assert.equal(body.preserveOriginalColor,false);assert.equal(body.autoContrast,false);assert.equal(body.printFinish,'INK');
  assert.equal(body.id,'destination-body');assert.equal(body.masterZoneId,'destination-body');assert.equal(body.masterLocked,true);
  assert.equal(copied.schemes[0].targets[2].widthRatio,.09);
  assert.equal(copied.schemes[2].targets[1].color,'#aa9900');assert.equal(copied.schemes[2].independentGeometry,true);
  assert.deepEqual(copied.schemes[0].targets[3],destination.schemes[0].targets[3]);
  assert.deepEqual(destination,original,'原接收布局不能被就地修改');
  copied.schemes[0].targets[1].color='#ffffff';assert.equal(source.schemes[0].targets[0].color,'#bc2345','后续编辑不能串改来源产品');
});

test('复制预设后回到接收产品母版的位置，已拖动过的接收区域也会归位',async()=>{
  const copy=await copyPreset();
  const source=createSchemes([{...target('source'),x:.31,y:.42,widthRatio:.24,quad:[{x:.2,y:.3},{x:.4,y:.3},{x:.4,y:.5},{x:.2,y:.5}]}]);
  const destination=createSchemes([{...target('destination'),x:.7,y:.8}]);
  const masters=[{...target('destination'),x:.6,y:.55}];
  const copied=copy(source,destination,masters);
  assert.equal(copied.sharedTargets[0].x,.6);assert.equal(copied.sharedTargets[0].y,.55);
  for(const scheme of copied.schemes){assert.equal(scheme.targets[0].x,.6);assert.equal(scheme.targets[0].y,.55);assert.equal(scheme.targets[0].widthRatio,.24);assert.equal(scheme.targets[0].quad,undefined);}
  assert.equal(destination.schemes[0].targets[0].x,.7);
});

test('四点母版保留自身透视，按复制的尺寸和角度缩放旋转，并以母版位置为中心',async()=>{
  const copy=await copyPreset(),source=createSchemes([{...target('source'),widthRatio:.4,rotation:90}]);
  const masters=[{...target('destination'),x:.6,y:.5,widthRatio:.2,quad:[{x:.5,y:.45},{x:.7,y:.45},{x:.7,y:.55},{x:.5,y:.55}]}];
  const copied=copy(source,createSchemes([{...target('destination'),x:.8,y:.8}]),masters);
  assert.deepEqual(copied.schemes[0].targets[0].quad,[{x:.7,y:.3},{x:.7,y:.7},{x:.5,y:.7},{x:.5,y:.3}]);
  assert.equal(copied.schemes[0].targets[0].rotation,90);assert.equal(copied.schemes[0].targets[0].x,.6);
});

test('复制的尺寸在母版位置放不下时明确失败，不压缩四点形状或移动中心',async()=>{
  const copy=await copyPreset(),source=createSchemes([{...target('source'),widthRatio:.4}]);
  const masters=[{...target('destination'),x:.9,y:.5,widthRatio:.2,quad:[{x:.8,y:.45},{x:1,y:.45},{x:1,y:.55},{x:.8,y:.55}]}];
  const destination=createSchemes(masters),before=structuredClone(destination);
  assert.throws(()=>copy(source,destination,masters),/超出|容纳/);
  assert.deepEqual(destination,before);
});

test('只同步颜色时保留每个方案的位置、大小、角度、透视和独立编辑状态',async()=>{
  const copy=await copyPreset(),source=createSchemes([{...target('source'),widthRatio:.9,rotation:90,color:'#bc2345',printFinish:'INK',preserveOriginalColor:false,autoContrast:true}]);
  const destination=createSchemes([{...target('recipient'),x:.7,y:.6,widthRatio:.18,rotation:15,quad:[{x:.6,y:.5},{x:.8,y:.5},{x:.79,y:.7},{x:.61,y:.7}],color:'#112233',printFinish:'GOLD FOIL'}]);
  destination.schemes[1].independentGeometry=true;destination.schemes[1].targets[0].rotation=-30;
  const before=structuredClone(destination),copied=copy(source,destination,[],{size:false,rotation:false,color:true,printFinish:false});
  for(let i=0;i<copied.schemes.length;i++){
    const result=copied.schemes[i].targets[0],previous=before.schemes[i].targets[0];
    for(const key of ['x','y','widthRatio','rotation','quad'])assert.deepEqual(result[key],previous[key],key);
    assert.equal(copied.schemes[i].independentGeometry,before.schemes[i].independentGeometry);assert.equal(result.color,'#bc2345');assert.equal(result.printFinish,previous.printFinish);assert.equal(result.preserveOriginalColor,false);assert.equal(result.autoContrast,copied.schemes[i].version!=='CUSTOM');
  }
  assert.equal(copied.sharedTargets[0].widthRatio,.18);assert.deepEqual(destination,before);
});

test('只同步大小角度时，颜色、工艺和自动配色均保留接收产品原有设置',async()=>{
  const copy=await copyPreset(),source=createSchemes([{...target('source'),widthRatio:.25,rotation:45,color:'#bc2345',printFinish:'INK',autoContrast:true,preserveOriginalColor:false}]);
  const destination=createSchemes([{...target('recipient'),x:.7,y:.6,color:'#123456',printFinish:'GOLD FOIL',autoContrast:false}]);
  const copied=copy(source,destination,destination.sharedTargets,{size:true,rotation:true,color:false,printFinish:false});
  for(const scheme of copied.schemes){const t=scheme.targets[0],previous=destination.schemes.find(s=>s.version===scheme.version).targets[0];assert.equal(t.widthRatio,.25);assert.equal(t.rotation,45);assert.equal(t.color,'#123456');assert.equal(t.printFinish,previous.printFinish);assert.equal(t.autoContrast,false);assert.equal(t.preserveOriginalColor,previous.preserveOriginalColor);}
});

test('四个同步项都未选中时不修改任何布局',async()=>{
  const copy=await copyPreset(),source=createSchemes([{...target('source'),widthRatio:.9,color:'#ff0000'}]),destination=createSchemes([{...target('recipient'),x:.8}]);
  assert.deepEqual(copy(source,destination,[],{size:false,rotation:false,color:false,printFinish:false}),destination);
});

test('空同步范围不保存或修改任务',async()=>{
  const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
  const c=vm.createContext({copyingProductPreset:false,generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,selectedMultiProductId:'a',loadedMultiProductId:'a',multiPackageProducts:[{id:'a'},{id:'b'}],saveMultiProductView:()=>assert.fail('空范围不能修改任务')});
  vm.runInContext(source.slice(source.indexOf('async function applyPresetToOtherProducts('),source.indexOf('function openProductPresetScope(')),c);
  await c.applyPresetToOtherProducts([]);
});

test('一键复制会加载未打开的产品，保存最新编辑，并让保存和生成读取复制后的布局',async()=>{
  const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
  const sourceState=createSchemes([{...target('a-zone'),x:.3,widthRatio:.28,color:'#bc2345',preserveOriginalColor:false}]);
  const destination=createSchemes([{...target('b-zone'),x:.7}]);
  const events=[];
  const c=vm.createContext({selectedGenerationVersions:()=>['ORIGINAL','BLACK'],logoImage:null,structuredClone,copyScopedPreset,createSchemes,copyingProductPreset:false,generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,selectedMultiProductId:'a',loadedMultiProductId:'a',multiPackageProducts:[{id:'a',sku:'A'},{id:'b',sku:'B'}],multiProductViews:new Map(),schemeState:sourceState,activeScheme:'ORIGINAL',placementScope:'shared',selectedTargetId:'a-zone',baseData:'image-a',baseImage:{},lastResultPayload:null,savedSignatures:{},schemePhases:{},collectTargets:()=>sourceState.schemes[0].targets,syncSchemeState:()=>events.push('capture'),updateGenerateButton(){},setStatus:(text,type)=>events.push(type),taskDraft:{schedule:()=>events.push('save')},queueSchemeCards(){},renderMultiProductResults(){},loadSchemeTargets(){}});
  const snapshots=source.slice(source.indexOf('function saveMultiProductView(){'),source.indexOf('async function showMultiProduct('));
  const action=source.slice(source.indexOf('async function applyPresetToOtherProducts('),source.indexOf('function saveMultiLogoView(){'));
  vm.runInContext(snapshots+action,c);
  c.document={querySelector:()=>({checked:true})};
  c.fetch=async()=>{throw Error('已有任务的图片与母版快照不应读取图库的新母版');};
  c.loadMultiProductView=async product=>{assert.equal(product.id,'b');const view={baseData:'image-b',baseAssetUrl:'/b-asset',masterTargets:[{...target('b-zone'),x:.8,y:.4}],targets:destination.schemes[0].targets,schemeState:destination,activeScheme:'ORIGINAL',selectedTargetId:'b-zone',savedSignatures:{ORIGINAL:'previous-output'}};c.multiProductViews.set('b',view);return view;};
  await c.applyPresetToOtherProducts(['product/ORIGINAL/size','product/ORIGINAL/rotation']);
  const layouts=c.captureMultiProductLayouts(),b=layouts.find(layout=>layout.productId==='b');
  assert.equal(b.targets[0].x,.7);assert.equal(b.targets[0].y,.5);assert.equal(b.targets[0].widthRatio,.28);assert.equal(b.targets[0].color,'#000000');assert.equal(b.targets[0].id,'b-zone');
  assert.equal(b.schemeState.schemes[0].targets[0].widthRatio,.28);assert.equal(b.baseAssetUrl,'/b-asset');assert.equal(b.savedSignatures.ORIGINAL,'previous-output');
  assert.equal(b.masterTargets[0].x,.8,'母版位置快照必须进入自动保存的布局');
  assert.ok(events.includes('save'));assert.ok(events.includes('success'));assert.equal(c.loadedMultiProductId,'a');assert.equal(c.copyingProductPreset,false);
  c.multiProductViews.get('b').schemeState.schemes[0].targets[0].widthRatio=.1;
  const before=structuredClone(c.multiProductViews.get('b').schemeState);
  c.multiPackageProducts.push({id:'c',sku:'C'});
  const edge={...target('c-zone'),x:.9,y:.5,widthRatio:.2,quad:[{x:.8,y:.45},{x:1,y:.45},{x:1,y:.55},{x:.8,y:.55}]};
  c.multiProductViews.set('c',{masterTargets:[edge],schemeState:createSchemes([edge]),activeScheme:'ORIGINAL'});
  c.loadMultiProductView=async product=>c.multiProductViews.get(product.id);
  let restoredRetryControls=false;c.queueSchemeCards=()=>{if(!c.copyingProductPreset)restoredRetryControls=true;};
  await c.applyPresetToOtherProducts(['product/ORIGINAL/size','product/ORIGINAL/rotation']);
  assert.equal(events.at(-1),'error');assert.deepEqual(c.multiProductViews.get('b').schemeState,before,'任一产品无法容纳预设时，不能只修改前面的产品');
  assert.equal(restoredRetryControls,true,'同步失败后仍须刷新卡片，恢复重新生成入口');
});

test('同步配置期间，普通生成和重新生成都不能提交旧布局',async()=>{
  const source=await readFile(new URL('./demo.js',import.meta.url),'utf8'),buttons=new Map();
  const c=vm.createContext({addingPrintCombination:false,copyingProductPreset:true,generationSubmitting:false,generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,multiPackageProducts:[{id:'a'},{id:'b'}],taskLogos:[],selectedMultiProductId:'a',loadedMultiProductId:'a',multiLogoEnabled:true,currentTaskId:'task',s7User:{id:'alice'},baseData:'base',logoData:'logo',multiProductTabs:{querySelectorAll:()=>[]},selectedProductPlans:()=>[{productId:'a',selectedVersions:['ORIGINAL']},{productId:'b',selectedVersions:['ORIGINAL']}],selectedGenerationVersions:()=>['ORIGINAL'],modifiedSchemes:()=>['ORIGINAL'],document:{querySelectorAll:()=>[],querySelector:selector=>{if(!buttons.has(selector))buttons.set(selector,{});return buttons.get(selector);}},setStatus:()=>assert.fail('同步期间不能进入生成准备阶段'),captureMultiProductLayouts:()=>assert.fail('同步期间不能读取旧布局'),captureMultiLogoLayouts:()=>assert.fail('同步期间不能读取旧布局'),updateGenerateButton(){},submitBackgroundGeneration:()=>assert.fail('同步期间不能提交生成')});
  const update=source.slice(source.indexOf('function updateGenerateButton(){'),source.indexOf('for(const input of versionInputs)',source.indexOf('function updateGenerateButton(){')));
  Object.assign(c,{activeScheme:'ORIGINAL',collectTargets:()=>[],updateAllSchemeSelection(){},aiLogoBusy:false,aiRefineButton:{setAttribute(){}},aiRefineDownload:{}});
  vm.runInContext(update,c);c.updateGenerateButton();assert.equal(buttons.get('#generate-modified').disabled,true);
  for(const name of ['runGeneration','runMultiPackageGeneration','runMultiLogoGeneration']){
    const start=source.indexOf(`async function ${name}(`),end=source.indexOf('\n}',start)+2;
    vm.runInContext(source.slice(start,end),c);await c[name](['ORIGINAL']);
  }
  c.copyingProductPreset=false;c.updateGenerateButton();assert.equal(buttons.get('#apply-product-preset').disabled,false);
  c.generationSubmitting=true;c.updateGenerateButton();assert.equal(buttons.get('#apply-product-preset').disabled,true);
});
