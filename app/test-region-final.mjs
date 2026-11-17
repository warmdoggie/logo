import {test} from 'node:test';import assert from 'node:assert/strict';
import {changeRegionProcess,changeRegionAppearance} from './public/region-adjust.js';
import {regionChoices} from './region-sales.mjs';import {salesOutputLabels} from './sales-workflow.mjs';
import {chooseCartonInk} from './carton-ink.mjs';import {sharp} from './logo-pixels.mjs';
test('继承的烫印和普通工艺可双向切换，恢复默认保留手动位置',()=>{
 const printing={allowed:['UV_PRINT','HOT_STAMP'],defaultProcess:'UV_PRINT',ink:'WHITE'},target={area:{id:'a',name:'产品',printing},carrier:{type:'BODY'}},plan={targets:[target]},item={id:'i'},placement={x:.5,y:.5,widthRatio:.1,rotation:10};
 const base={placement},effective={mode:'FOIL',foil:'SILVER'};
 for(const override of [changeRegionProcess(base,'UV_PRINT',effective,printing,'SILVER'),changeRegionAppearance(base,'ORIGINAL','HOT_STAMP',printing,'SILVER'),changeRegionAppearance(base,'SOLID','HOT_STAMP',printing,'SILVER')]){
  const row=regionChoices(plan,item,'FOIL',{foil:'SILVER',overrides:{'i:FOIL':{areas:{a:override}}}})[0];assert.equal(row.process,'UV_PRINT');assert.notEqual(row.appearance.mode,'FOIL');assert.deepEqual(row.placement,placement);
 }
 const foil=changeRegionAppearance(base,'FOIL','UV_PRINT',printing,'SILVER');assert.equal(foil.process,'HOT_STAMP');assert.deepEqual(changeRegionAppearance(foil,'DEFAULT','HOT_STAMP',printing,'SILVER'),base);
});
test('标签来自实际产品和彩盒区域，不把混合工艺标成首区域',()=>{
 const r=salesOutputLabels({regionVersion:2,targets:[{carrierType:'BODY',areaName:'左支',processType:'HOT_STAMP',appearance:{mode:'FOIL',foil:'SILVER'}},{carrierType:'BODY',areaName:'右支',processType:'UV_PRINT',appearance:{mode:'ORIGINAL'}},{carrierType:'CARTON',areaName:'正面',processType:'SCREEN_PRINT',appearance:{mode:'SOLID',hex:'#000000'}}]});
 assert.match(r.appearanceName,/产品：混合效果/);assert.match(r.actualDescription,/左支 烫印 · 烫银/);assert.match(r.actualDescription,/彩盒：丝印 · 黑色/);
});
test('局部已有深浅文字笔画辅助判色，不把花纹当可靠底色',async()=>{
 const image={width:200,height:200},logo={width:100,height:100},p={x:.5,y:.5,widthRatio:.8,rotation:0};
 for(const [bg,fg,hex] of [['white','black','#000000'],['black','white','#ffffff']]){
  const bytes=await sharp(Buffer.from('<svg width="200" height="200"><rect width="200" height="200" fill="'+bg+'"/>'+[40,65,90,115,140].map(x=>'<rect x="'+x+'" y="85" width="4" height="15" fill="'+fg+'"/>').join('')+'</svg>')).png().toBuffer();
  const r=await chooseCartonInk(bytes,p,image,logo);assert.equal(r.hex,hex);assert.equal(r.source,'LOCAL_BACKGROUND_AND_STROKES');assert.ok(r.evidence.textColorSupport.strokeCount>=3);
 }
 const gradient=await sharp(Buffer.from('<svg width="200" height="200"><defs><linearGradient id="g"><stop stop-color="black"/><stop offset="1" stop-color="white"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/></svg>')).png().toBuffer();assert.equal((await chooseCartonInk(gradient,p,image,logo)).status,'CHOICE_REQUIRED');
});
