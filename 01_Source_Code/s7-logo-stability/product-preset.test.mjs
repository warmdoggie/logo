import test from 'node:test';
import assert from 'node:assert/strict';
import {createSchemes} from './schemes.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {masterTargetsFromTemplate} from './product-master.mjs';
import {webcrypto} from 'node:crypto';

async function copyPreset(){
  const module=await import('./product-preset.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
  assert.equal(typeof module.copyProductPreset,'function','应提供跨产品复制预设的功能');
  return module.copyProductPreset;
}
const target=(id,carrierType='BODY')=>({id,carrierType,x:.5,y:.5,widthRatio:.15,rotation:0,curve:0,surface:'free',color:'#000000',preserveOriginalColor:true,autoContrast:true,masterZoneId:id,masterLocked:true});

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
  const before=structuredClone(destination),copied=copy(source,destination,[],{geometry:false,color:true});
  for(let i=0;i<copied.schemes.length;i++){
    const result=copied.schemes[i].targets[0],previous=before.schemes[i].targets[0];
    for(const key of ['x','y','widthRatio','rotation','quad'])assert.deepEqual(result[key],previous[key],key);
    assert.equal(copied.schemes[i].independentGeometry,before.schemes[i].independentGeometry);assert.equal(result.color,'#bc2345');assert.equal(result.printFinish,'INK');assert.equal(result.preserveOriginalColor,false);assert.equal(result.autoContrast,true);
  }
  assert.equal(copied.sharedTargets[0].widthRatio,.18);assert.deepEqual(destination,before);
});

test('只同步大小角度时，颜色、工艺和自动配色均保留接收产品原有设置',async()=>{
  const copy=await copyPreset(),source=createSchemes([{...target('source'),widthRatio:.25,rotation:45,color:'#bc2345',printFinish:'INK',autoContrast:true,preserveOriginalColor:false}]);
  const destination=createSchemes([{...target('recipient'),x:.7,y:.6,color:'#123456',printFinish:'GOLD FOIL',autoContrast:false}]);
  const copied=copy(source,destination,destination.sharedTargets,{geometry:true,color:false});
  for(const scheme of copied.schemes){const t=scheme.targets[0];assert.equal(t.widthRatio,.25);assert.equal(t.rotation,45);assert.equal(t.color,'#123456');assert.equal(t.printFinish,'GOLD FOIL');assert.equal(t.autoContrast,false);assert.equal(t.preserveOriginalColor,true);}
});

test('两个同步项都未选中时不修改任何布局',async()=>{
  const copy=await copyPreset(),source=createSchemes([{...target('source'),widthRatio:.9,color:'#ff0000'}]),destination=createSchemes([{...target('recipient'),x:.8}]);
  assert.deepEqual(copy(source,destination,[],{geometry:false,color:false}),destination);
});

test('界面只选颜色时跳过母版校验，两个选项都取消时不保存或修改任务',async()=>{
  const copy=await copyPreset(),source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
  const nodes={'#copy-preset-geometry':{checked:false},'#copy-preset-color':{checked:true}};
  const sourceState=createSchemes([{...target('a'),widthRatio:.9,rotation:90,color:'#bc2345',preserveOriginalColor:false}]);
  const recipient={schemeState:createSchemes([{...target('b'),x:.7,widthRatio:.18,rotation:15}]),activeScheme:'ORIGINAL',placementScope:'current'};
  let saves=0;
  const c=vm.createContext({structuredClone,copyProductPreset:copy,copyingProductPreset:false,generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,selectedMultiProductId:'a',loadedMultiProductId:'a',multiPackageProducts:[{id:'a'},{id:'b'}],multiProductViews:new Map([['b',recipient]]),schemeState:sourceState,document:{querySelector:selector=>nodes[selector]},saveMultiProductView(){saves++;},updateGenerateButton(){},queueSchemeCards(){},renderMultiProductResults(){},loadSchemeTargets(){},setStatus(){},taskDraft:{schedule(){saves++;}}});
  vm.runInContext(source.slice(source.indexOf('async function applyPresetToOtherProducts()'),source.indexOf('function saveMultiLogoView(){')),c);
  c.loadPresetMasterTargets=async()=>assert.fail('只改颜色不应校验或重载产品母版');c.loadMultiProductView=async()=>recipient;
  await c.applyPresetToOtherProducts();
  const copied=c.multiProductViews.get('b');assert.equal(copied.schemeState.schemes[0].targets[0].color,'#bc2345');assert.equal(copied.schemeState.schemes[0].targets[0].widthRatio,.18);assert.equal(copied.schemeState.schemes[0].targets[0].rotation,15);assert.equal(copied.schemeState.schemes[0].targets[0].x,.7);assert.equal(copied.placementScope,'current');
  const before=structuredClone(copied),saved=saves;nodes['#copy-preset-color'].checked=false;await c.applyPresetToOtherProducts();assert.equal(saves,saved);assert.deepEqual(structuredClone(c.multiProductViews.get('b')),before);
});

test('一键复制会加载未打开的产品，保存最新编辑，并让保存和生成读取复制后的布局',async()=>{
  const copy=await copyPreset(),source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
  const sourceState=createSchemes([{...target('a-zone'),x:.3,widthRatio:.28,color:'#bc2345',preserveOriginalColor:false}]);
  const destination=createSchemes([{...target('b-zone'),x:.7}]);
  const events=[];
  const c=vm.createContext({structuredClone,copyProductPreset:copy,createSchemes,copyingProductPreset:false,generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,selectedMultiProductId:'a',loadedMultiProductId:'a',multiPackageProducts:[{id:'a',sku:'A'},{id:'b',sku:'B'}],multiProductViews:new Map(),schemeState:sourceState,activeScheme:'ORIGINAL',placementScope:'shared',selectedTargetId:'a-zone',baseData:'image-a',baseImage:{},lastResultPayload:null,savedSignatures:{},schemePhases:{},collectTargets:()=>sourceState.schemes[0].targets,syncSchemeState:()=>events.push('capture'),updateGenerateButton(){},setStatus:(text,type)=>events.push(type),taskDraft:{schedule:()=>events.push('save')},queueSchemeCards(){},renderMultiProductResults(){},loadSchemeTargets(){}});
  const snapshots=source.slice(source.indexOf('function saveMultiProductView(){'),source.indexOf('async function showMultiProduct('));
  const action=source.slice(source.indexOf('async function applyPresetToOtherProducts()'),source.indexOf('function saveMultiLogoView(){'));
  vm.runInContext(snapshots+action,c);
  c.document={querySelector:()=>({checked:true})};
  c.masterTargetsFromTemplate=masterTargetsFromTemplate;
  c.fetch=async()=>{throw Error('已有任务的图片与母版快照不应读取图库的新母版');};
  c.loadMultiProductView=async product=>{assert.equal(product.id,'b');const view={baseData:'image-b',baseAssetUrl:'/b-asset',masterTargets:[{...target('b-zone'),x:.8,y:.4}],targets:destination.schemes[0].targets,schemeState:destination,activeScheme:'ORIGINAL',selectedTargetId:'b-zone',savedSignatures:{ORIGINAL:'previous-output'}};c.multiProductViews.set('b',view);return view;};
  await c.applyPresetToOtherProducts();
  const layouts=c.captureMultiProductLayouts(),b=layouts.find(layout=>layout.productId==='b');
  assert.equal(b.targets[0].x,.8);assert.equal(b.targets[0].y,.4);assert.equal(b.targets[0].widthRatio,.28);assert.equal(b.targets[0].color,'#bc2345');assert.equal(b.targets[0].id,'b-zone');
  assert.equal(b.schemeState.schemes[0].targets[0].widthRatio,.28);assert.equal(b.baseAssetUrl,'/b-asset');assert.equal(b.savedSignatures.ORIGINAL,'previous-output');
  assert.equal(b.masterTargets[0].x,.8,'母版位置快照必须进入自动保存的布局');
  assert.ok(events.includes('save'));assert.ok(events.includes('success'));assert.equal(c.loadedMultiProductId,'a');assert.equal(c.copyingProductPreset,false);
  const before=structuredClone(c.multiProductViews.get('b').schemeState);
  c.multiPackageProducts.push({id:'c',sku:'C'});
  const edge={...target('c-zone'),x:.9,y:.5,widthRatio:.2,quad:[{x:.8,y:.45},{x:1,y:.45},{x:1,y:.55},{x:.8,y:.55}]};
  c.multiProductViews.set('c',{masterTargets:[edge],schemeState:createSchemes([edge]),activeScheme:'ORIGINAL'});
  c.loadMultiProductView=async product=>c.multiProductViews.get(product.id);
  let restoredRetryControls=false;c.queueSchemeCards=()=>{if(!c.copyingProductPreset)restoredRetryControls=true;};
  await c.applyPresetToOtherProducts();
  assert.equal(events.at(-1),'error');assert.deepEqual(c.multiProductViews.get('b').schemeState,before,'任一产品无法容纳预设时，不能只修改前面的产品');
  assert.equal(restoredRetryControls,true,'同步失败后仍须刷新卡片，恢复重新生成入口');
});

for(const [bytes,success]of [['abc',true],['changed-image',false]])test(`旧任务没有母版快照时核对原图，${success?'同图可补齐母版':'换图后拒绝混用新母版'}`,async()=>{
  const source=await readFile(new URL('./demo.js',import.meta.url),'utf8'),view={baseAssetUrl:'/api/my-space/tasks/task/assets/ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad.png'};
  const c=vm.createContext({structuredClone,Uint8Array,crypto:webcrypto,masterTargetsFromTemplate,loadMultiProductView:async()=>view,fetch:async()=>({ok:true,arrayBuffer:async()=>new TextEncoder().encode(bytes).buffer,json:async()=>({template:{zones:[{id:'body',zoneType:'logo',x:.6,y:.3,width:.2,height:.2}]}})})});
  vm.runInContext(source.slice(source.indexOf('async function loadPresetMasterTargets('),source.indexOf('function saveMultiLogoView(){')),c);
  if(success){const targets=await c.loadPresetMasterTargets({id:'b',sku:'B'});assert.ok(Math.abs(targets[0].x-.7)<.000001);assert.equal(view.masterTargets[0].masterZoneId,'body');}
  else{await assert.rejects(()=>c.loadPresetMasterTargets({id:'b',sku:'B'}),/图库图片已更新/);assert.equal(view.masterTargets,undefined);}
});

test('同步配置期间，普通生成和重新生成都不能提交旧布局',async()=>{
  const source=await readFile(new URL('./demo.js',import.meta.url),'utf8'),buttons=new Map();
  const c=vm.createContext({copyingProductPreset:true,generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,multiPackageProducts:[{id:'a'},{id:'b'}],taskLogos:[],selectedMultiProductId:'a',loadedMultiProductId:'a',multiLogoEnabled:true,currentTaskId:'task',s7User:{id:'alice'},baseData:'base',logoData:'logo',multiProductTabs:{querySelectorAll:()=>[]},selectedGenerationVersions:()=>['ORIGINAL'],modifiedSchemes:()=>['ORIGINAL'],document:{querySelector:selector=>{if(!buttons.has(selector))buttons.set(selector,{});return buttons.get(selector);}},setStatus:()=>assert.fail('同步期间不能进入生成准备阶段'),captureMultiProductLayouts:()=>assert.fail('同步期间不能读取旧布局'),captureMultiLogoLayouts:()=>assert.fail('同步期间不能读取旧布局'),updateGenerateButton(){},submitBackgroundGeneration:()=>assert.fail('同步期间不能提交生成')});
  const update=source.slice(source.indexOf('function updateGenerateButton(){'),source.indexOf('for(const input of versionInputs)'));
  vm.runInContext(update,c);c.updateGenerateButton();assert.equal(buttons.get('#generate-modified').disabled,true);
  for(const name of ['runGeneration','runMultiPackageGeneration','runMultiLogoGeneration']){
    const start=source.indexOf(`async function ${name}(`),end=source.indexOf('\n}',start)+2;
    vm.runInContext(source.slice(start,end),c);await c[name](['ORIGINAL']);
  }
  c.copyingProductPreset=false;buttons.get('#copy-preset-geometry').checked=false;buttons.get('#copy-preset-color').checked=true;c.updateGenerateButton();assert.equal(buttons.get('#apply-product-preset').disabled,false);
  buttons.get('#copy-preset-color').checked=false;c.updateGenerateButton();assert.equal(buttons.get('#apply-product-preset').disabled,true);
});
