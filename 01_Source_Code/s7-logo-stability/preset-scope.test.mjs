import test from 'node:test';
import assert from 'node:assert/strict';
import * as presets from './product-preset.mjs';
import {createSchemes,setCustomColors} from './schemes.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const target=(id,carrierType='BODY')=>({id,carrierType,x:.5,y:.5,widthRatio:.12,rotation:0,color:'#000000'});

for(const parameters of [['size'],['rotation'],['color'],['size','rotation','color']])test(`以选中的第二个产品为参考，向全部产品同步 ${parameters.join('+')}，保留位置及未选参数`,()=>{
  const source=createSchemes([target('a1'),{...target('a2'),widthRatio:.2,rotation:60,color:'#123456'},target('a-box','CARTON_FRONT')]);
  source.schemes[4].targets[1].color='#123456';
  const destination=createSchemes([{...target('b1'),x:.3},{...target('b2'),x:.6},{...target('b3'),y:.7},target('b-box','CARTON_FRONT')]);
  const before=structuredClone(destination),selection=parameters.map(parameter=>`product/CUSTOM/${parameter}`);
  const result=presets.copyScopedPreset(source,destination,selection,undefined,'a2');
  for(let index=0;index<3;index++){
    const previous=before.schemes[4].targets[index],expected={...previous};
    if(parameters.includes('size'))expected.widthRatio=.2;
    if(parameters.includes('rotation'))expected.rotation=60;
    if(parameters.includes('size')||parameters.includes('rotation'))expected.quad=undefined;
    if(parameters.includes('color'))Object.assign(expected,{color:'#123456',printFinish:'INK',autoContrast:false,preserveOriginalColor:false});
    assert.deepEqual(result.schemes[4].targets[index],expected);
  }
  assert.deepEqual(result.schemes[4].targets[3],before.schemes[4].targets[3]);
  assert.deepEqual(result.schemes.slice(0,4),before.schemes.slice(0,4));
  assert.deepEqual(destination,before);
});

test('产品参考在各搭配中取对应区域的参数；固定配色和工艺不随几何同步变化',()=>{
  const source=createSchemes([target('a1'),target('a2')]),destination=createSchemes([target('b1'),target('b2'),target('b3')]);
  source.schemes.forEach((scheme,index)=>Object.assign(scheme.targets[1],{rotation:15*index,widthRatio:.13+.01*index}));
  const selection=presets.presetScopeKeys.filter(key=>key.startsWith('product/')&&!key.endsWith('/color'));
  const result=presets.copyScopedPreset(source,destination,selection,undefined,'a2');
  result.schemes.forEach((scheme,index)=>scheme.targets.forEach((t,i)=>{
    assert.equal(t.rotation,source.schemes[index].targets[1].rotation);
    assert.equal(t.widthRatio,source.schemes[index].targets[1].widthRatio);
    for(const key of ['color','printFinish','autoContrast','preserveOriginalColor'])assert.equal(t[key],destination.schemes[index].targets[i][key]);
  }));
});

test('全部产品同步中，后续区域越界也必须拒绝整个复制且不修改原状态',()=>{
  const source=createSchemes([{...target('a'),widthRatio:.3}]),destination=createSchemes([target('b1'),{...target('b2'),x:.99}]);
  const before=structuredClone(destination);
  assert.throws(()=>presets.copyScopedPreset(source,destination,['product/BLACK/size'],{width:800,height:600,logoAspect:.2}),/超出/);
  assert.deepEqual(destination,before);
});

test('非正方形原图中的每个产品透视框按实际像素旋转，保留各自中心',()=>{
  const source=createSchemes([{...target('a'),rotation:90}]);
  const destination=createSchemes([.3,.7].map((x,index)=>({...target(`b${index}`),x,quad:[{x:x-.06,y:.47},{x:x+.06,y:.47},{x:x+.06,y:.53},{x:x-.06,y:.53}]})));
  const result=presets.copyScopedPreset(source,destination,['product/BLACK/rotation'],{width:800,height:400,logoAspect:.25});
  result.schemes[1].targets.forEach((t,index)=>{
    const x=destination.schemes[1].targets[index].x;
    assert.deepEqual(t.quad,[{x:x+.015,y:.38},{x:x+.015,y:.62},{x:x-.015,y:.62},{x:x-.015,y:.38}].map(p=>({x:Number(p.x.toFixed(6)),y:p.y})));
    assert.equal(t.x,x);assert.equal(t.y,.5);
  });
});

test('产品同步包含来源 SKU 中的全部产品，仍按勾选版本更新且保留彩盒',async()=>{
  const script=await readFile(new URL('./demo.js',import.meta.url),'utf8');
  const a={schemeState:createSchemes([target('a1'),{...target('a2'),rotation:70,widthRatio:.2},target('a-box','CARTON_FRONT')]),activeScheme:'BLACK'};
  const b={schemeState:createSchemes([target('b1'),target('b2'),target('b3'),target('b-box','CARTON_FRONT')]),activeScheme:'BLACK'};
  const before=structuredClone(a),views=new Map([['a',a],['b',b]]);let refreshed=0;
  const c=vm.createContext({logoImage:null,structuredClone,copyScopedPreset:presets.copyScopedPreset,copyingProductPreset:false,generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,selectedMultiProductId:'a',loadedMultiProductId:'a',selectedTargetId:'a2',multiPackageProducts:[{id:'a'},{id:'b'}],multiProductViews:views,schemeState:a.schemeState,saveMultiProductView(){},updateGenerateButton(){},queueSchemeCards(){},renderMultiProductResults(){},loadSchemeTargets(){refreshed++;},setStatus(){},taskDraft:{schedule(){}},loadMultiProductView:async product=>views.get(product.id)});
  const start=script.indexOf('async function applyPresetToOtherProducts('),end=script.indexOf('\nfunction openProductPresetScope(',start);
  vm.runInContext(script.slice(start,end),c);
  await c.applyPresetToOtherProducts(['product/BLACK/size','product/BLACK/rotation'],'a2');
  for(const id of ['a','b'])for(const t of views.get(id).schemeState.schemes[1].targets.filter(t=>t.carrierType==='BODY')){
    assert.equal(t.widthRatio,.2);assert.equal(t.rotation,70);
  }
  assert.equal(refreshed,1);
  assert.equal(c.schemeState.schemes[1].targets[0].rotation,70);
  assert.deepEqual(views.get('a').schemeState.schemes[1].targets[2],before.schemeState.schemes[1].targets[2]);
  assert.deepEqual(views.get('a').schemeState.schemes[0],before.schemeState.schemes[0]);
});

for(const [parameters,width,rotation] of [[['size'],.24,-15],[['rotation'],.12,35],[['size','rotation'],.24,35]])test(`彩盒原色同步 ${parameters.join('+')} 同时更新烫金烫银方案中的彩盒，保留产品及配色`,()=>{
  const source=createSchemes([target('a-body'),{...target('a-front','CARTON_FRONT'),widthRatio:.24,rotation:35}]);
  source.schemes[2].targets[1].rotation=80;
  source.schemes[3].targets[1].widthRatio=.3;
  const destination=createSchemes([target('b-body'),{...target('b-front','CARTON_FRONT'),x:.4,rotation:-15,color:'#123456'}]);
  const before=structuredClone(destination);
  const result=presets.copyScopedPreset(source,destination,parameters.map(parameter=>`carton/ORIGINAL/${parameter}`));
  for(const index of [0,2,3]){
    const scheme=result.schemes[index],previous=before.schemes[index];
    assert.deepEqual(scheme.targets[1],{...previous.targets[1],widthRatio:width,rotation,quad:undefined});
    assert.deepEqual(scheme.targets[0],previous.targets[0]);
    assert.equal(scheme.independentGeometry,true);
  }
  for(const index of [1,4])assert.deepEqual(result.schemes[index],before.schemes[index]);
  assert.deepEqual(result.sharedTargets,before.sharedTargets);
  assert.deepEqual(destination,before);
});

test('接收 SKU 当前为未勾选生成的烫金方案时，彩盒同步仍刷新该方案并保留旧成图签名',async()=>{
  const script=await readFile(new URL('./demo.js',import.meta.url),'utf8');
  const recipient={schemeState:createSchemes([target('b-body'),target('b-front','CARTON_FRONT')]),activeScheme:'GOLD FOIL',savedSignatures:{'GOLD FOIL':'old-gold','SILVER FOIL':'old-silver'}};
  const before=structuredClone(recipient);let saved=0;
  const c=vm.createContext({logoImage:null,structuredClone,copyScopedPreset:presets.copyScopedPreset,copyingProductPreset:false,generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,selectedMultiProductId:'a',loadedMultiProductId:'a',multiPackageProducts:[{id:'a'},{id:'b'}],multiProductViews:new Map([['b',recipient]]),schemeState:createSchemes([target('a-body'),{...target('a-front','CARTON_FRONT'),widthRatio:.24,rotation:35}]),saveMultiProductView(){},updateGenerateButton(){},queueSchemeCards(){},renderMultiProductResults(){},loadSchemeTargets(){},setStatus(){},taskDraft:{schedule(){saved++;}},loadMultiProductView:async()=>recipient,selectedGenerationVersions:()=>['ORIGINAL','BLACK']});
  const start=script.indexOf('async function applyPresetToOtherProducts('),end=script.indexOf('\nfunction openProductPresetScope(',start);
  vm.runInContext(script.slice(start,end),c);
  await c.applyPresetToOtherProducts(['carton/ORIGINAL/size','carton/ORIGINAL/rotation']);
  const result=c.multiProductViews.get('b');
  assert.equal(result.targets[1].widthRatio,.24);
  assert.equal(result.targets[1].rotation,35);
  assert.deepEqual(result.targets[0],before.schemeState.schemes[2].targets[0]);
  assert.deepEqual(result.savedSignatures,before.savedSignatures);
  assert.equal(saved,1);
});

test('分层同步只改选中的载体、搭配和参数，保留接收方位置与其他分支',()=>{
  assert.equal(typeof presets.copyScopedPreset,'function');
  const source=setCustomColors(createSchemes([{...target('a'),rotation:30,widthRatio:.2},target('front','CARTON_FRONT')]),{product:'#112233',carton:'#FF0000'});
  const destination=setCustomColors(createSchemes([{...target('b'),x:.3},target('back','CARTON_BACK')]),{product:'#ABCDEF',carton:'#FFFFFF'});
  const before=structuredClone(destination);
  const result=presets.copyScopedPreset(source,destination,['carton/CUSTOM/color','product/GOLD FOIL/rotation']);
  assert.equal(result.schemes[4].targets[1].color,'#FF0000');
  assert.deepEqual(result.schemes[4].targets[0],before.schemes[4].targets[0]);
  assert.deepEqual(result.schemes[2].targets[0],{...before.schemes[2].targets[0],rotation:30,quad:undefined});
  assert.equal(result.schemes[2].independentGeometry,true);
  assert.deepEqual(result.schemes[2].targets[1],before.schemes[2].targets[1]);
  for(const index of [0,1,3])assert.deepEqual(result.schemes[index],before.schemes[index]);
  assert.deepEqual(result.sharedTargets,before.sharedTargets);
  assert.deepEqual(destination,before);
});

test('分层同步拒绝固定颜色、彩盒烫金烫银及未知参数',()=>{
  assert.equal(typeof presets.copyScopedPreset,'function');
  const state=createSchemes([target('body'),target('front','CARTON_FRONT')]);
  for(const key of ['product/BLACK/color','carton/ORIGINAL/color','carton/GOLD FOIL/size','carton/SILVER FOIL/rotation','product/CUSTOM/printFinish']){
    assert.throws(()=>presets.copyScopedPreset(state,state,[key]),/同步范围/);
  }
});

test('分层大小和角度同步保留当前位置，缺失的载体不猜测不修改',()=>{
  assert.equal(typeof presets.copyScopedPreset,'function');
  const source=createSchemes([{...target('a'),widthRatio:.2,rotation:45},target('front','CARTON_FRONT')]);
  const destination=createSchemes([{...target('b'),x:.3,y:.4,quad:[{x:.24,y:.37},{x:.36,y:.37},{x:.36,y:.43},{x:.24,y:.43}]}]);
  const result=presets.copyScopedPreset(source,destination,['product/CUSTOM/size','product/CUSTOM/rotation','carton/CUSTOM/color']);
  assert.equal(result.schemes[4].targets[0].x,.3);
  assert.equal(result.schemes[4].targets[0].y,.4);
  assert.equal(result.schemes[4].targets[0].widthRatio,.2);
  assert.equal(result.schemes[4].targets[0].rotation,45);
  assert.deepEqual(result.schemes.slice(0,4),destination.schemes.slice(0,4));
  assert.deepEqual(presets.copyScopedPreset(source,destination,[]),destination);
});

test('没有相同彩盒面或设置已一致时，不把方案改为独立摆放',()=>{
  const source=createSchemes([target('front','CARTON_FRONT')]),destination=createSchemes([target('back','CARTON_BACK')]);
  assert.deepEqual(presets.copyScopedPreset(source,destination,['carton/ORIGINAL/size']),destination);
  assert.deepEqual(presets.copyScopedPreset(destination,destination,['carton/ORIGINAL/size','carton/ORIGINAL/rotation']),destination);
});

test('普通区域同步尺寸或旋转后超出接收原图时拒绝，颜色同步不受已有布局影响',()=>{
  const source=createSchemes([{...target('a'),widthRatio:.3,rotation:90}]),destination=createSchemes([{...target('b'),x:.92,y:.92,widthRatio:.1}]);
  const dimensions={width:800,height:400,logoAspect:2};
  for(const selection of [['product/CUSTOM/size'],['product/CUSTOM/rotation']])assert.throws(()=>presets.copyScopedPreset(source,destination,selection,dimensions),/超出/);
  assert.doesNotThrow(()=>presets.copyScopedPreset(source,destination,['product/CUSTOM/color'],dimensions));
});

test('确认范围后加载未打开的 SKU，仅保存勾选分支，不改旧成图签名',async()=>{
  const script=await readFile(new URL('./demo.js',import.meta.url),'utf8');
  const recipient={schemeState:createSchemes([target('b'),target('back','CARTON_BACK')]),activeScheme:'ORIGINAL',savedSignatures:{CUSTOM:'old'}};
  const before=structuredClone(recipient);let saved=0;
  const c=vm.createContext({logoImage:null,structuredClone,copyScopedPreset:presets.copyScopedPreset,copyingProductPreset:false,generationBusy:false,multiPackageBusy:false,logoSelectionBusy:false,selectedMultiProductId:'a',loadedMultiProductId:'a',multiPackageProducts:[{id:'a'},{id:'b'}],multiProductViews:new Map(),schemeState:setCustomColors(createSchemes([target('a'),target('front','CARTON_FRONT')]),{product:'#112233',carton:'#FF0000'}),saveMultiProductView(){},updateGenerateButton(){},queueSchemeCards(){},renderMultiProductResults(){},loadSchemeTargets(){},setStatus(){},taskDraft:{schedule(){saved++;}},loadMultiProductView:async()=>{c.multiProductViews.set('b',recipient);return recipient;}});
  const start=script.indexOf('async function applyPresetToOtherProducts('),end=script.indexOf('\nfunction openProductPresetScope(',start);
  vm.runInContext(script.slice(start,end),c);
  await c.applyPresetToOtherProducts(['carton/CUSTOM/color']);
  const result=c.multiProductViews.get('b');
  assert.equal(result.schemeState.schemes[4].targets[1].color,'#FF0000');
  assert.deepEqual(result.schemeState.schemes[4].targets[0],before.schemeState.schemes[4].targets[0]);
  assert.deepEqual(result.schemeState.schemes.slice(0,4),before.schemeState.schemes.slice(0,4));
  assert.deepEqual(result.savedSignatures,{CUSTOM:'old'});assert.equal(saved,1);
});
