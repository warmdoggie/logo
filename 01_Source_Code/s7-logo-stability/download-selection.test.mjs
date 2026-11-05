import test from 'node:test';
import assert from 'node:assert/strict';
import * as selection from './download-selection.mjs';

test('同一产品不同 Logo 的同款成图可以独立选择下载',()=>{
 const red={productId:'product',logoId:'red',version:'ORIGINAL',dataUrl:'/red.png'},blue={productId:'product',logoId:'blue',version:'ORIGINAL',dataUrl:'/blue.png'};
 const state=selection.syncDownloadSelection({},[red,blue]);
 assert.deepEqual(selection.selectedDownloadOutputs(state,[red,blue]),[red,blue]);
 state[selection.downloadKey(red)].selected=false;
 assert.deepEqual(selection.selectedDownloadOutputs(state,[red,blue]),[blue]);
});

test('成图默认选中，取消后跨产品切换和刷新保留选择，新成图重新默认选中',()=>{
 assert.equal(typeof selection.syncDownloadSelection,'function');
 const a={productId:'a',version:'ORIGINAL',dataUrl:'/a.png'},b={productId:'b',version:'ORIGINAL',dataUrl:'/b.png'};
 let state=selection.syncDownloadSelection({},[a,b]);
 assert.deepEqual(selection.selectedDownloadOutputs(state,[a,b]),[a,b]);
 state[selection.downloadKey(a)].selected=false;
 state=JSON.parse(JSON.stringify(state));
 assert.equal(selection.syncDownloadSelection(state,[a,b]),state,'相同成图的轮询不应修改已保存选择');
 assert.deepEqual(selection.selectedDownloadOutputs(state,[a,b]),[b],'取消当前产品不影响另一个产品');
 const replacement={...a,dataUrl:'/a-new.png'};
 state=selection.syncDownloadSelection(state,[replacement,b]);
 assert.deepEqual(selection.selectedDownloadOutputs(state,[replacement,b]),[replacement,b]);
});

test('未生成槽位不能选中或下载，移除产品不留在下载列表',()=>{
 assert.equal(typeof selection.syncDownloadSelection,'function');
 const pending={productId:'a',version:'BLACK'},done={version:'ORIGINAL',dataUrl:'/single.png'};
 const state=selection.syncDownloadSelection({},[pending,done]);
 assert.equal(Object.keys(state).length,1);
 assert.deepEqual(selection.selectedDownloadOutputs(state,[pending,done]),[done]);
 assert.deepEqual(selection.syncDownloadSelection(state,[]),{});
});

test('已取消的成图不参加下一次生成，跨 SKU 独立且旧成图选择不影响替换图',()=>{
 const gold={productId:'a',version:'GOLD FOIL',dataUrl:'/gold.png'},state={[selection.downloadKey(gold)]:{dataUrl:gold.dataUrl,selected:false}},versions=['GOLD FOIL','ROSE GOLD FOIL'];
 assert.deepEqual(selection.generationVersionsForProduct(versions,'a',[gold],state),['ROSE GOLD FOIL']);
 assert.deepEqual(selection.generationVersionsForProduct(versions,'b',[gold],state),versions);
 assert.deepEqual(selection.generationVersionsForProduct(versions,'a',[{...gold,dataUrl:'/new-gold.png'}],state),versions);
});

test('另一 Logo 取消的搭配不覆盖当前 Logo 的明确选择',()=>{
 const a={productId:'p',logoId:'a',version:'GOLD FOIL',dataUrl:'/a.png'},b={...a,logoId:'b',dataUrl:'/b.png'},state=selection.syncDownloadSelection({},[a,b]);
 state[selection.downloadKey(a)].selected=false;
 assert.deepEqual(selection.generationVersionsForProduct(['GOLD FOIL'],'p',[a,b],state,'b'),['GOLD FOIL']);
 assert.deepEqual(selection.generationVersionsForProduct(['GOLD FOIL'],'p',[a,b],state,'a'),[]);
});
