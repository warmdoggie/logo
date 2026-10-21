import test from 'node:test';
import assert from 'node:assert/strict';
import * as presentation from './generation-client.mjs';

test('同一预览框在生成中显示环形状态，完成后明确展示成图状态',()=>{
 assert.equal(typeof presentation.previewStatus,'function');
 assert.deepEqual(presentation.previewStatus(null,{stage:'generating'},false),{busy:true,label:'正在生成',complete:false});
 assert.deepEqual(presentation.previewStatus({dataUrl:'/saved.png'},{stage:'complete'},false),{busy:false,label:'已生成完成',complete:true});
 assert.deepEqual(presentation.previewStatus({dataUrl:'/previous.png'},{stage:'failed',error:'超时'},false),{busy:false,label:'失败：超时',complete:false});
});

test('切换产品只读取该产品对应的四张图与阶段，序列化恢复不改变状态',()=>{
 assert.equal(typeof presentation.productGeneration,'function');
 const record=JSON.parse(JSON.stringify({kind:'multi-product',status:'running',outputs:[{productId:'a',version:'BLACK',dataUrl:'/a.png'},{productId:'b',version:'BLACK',dataUrl:'/b.png'}],stages:{'a:BLACK':{stage:'complete'},'b:BLACK':{stage:'saving'}}}));
 const view=presentation.productGeneration(record,'b');assert.deepEqual(view.outputs,[{productId:'b',version:'BLACK',dataUrl:'/b.png'}]);assert.deepEqual(view.stages.BLACK,{stage:'saving'});assert.equal(view.stages['a:BLACK'],undefined);
});
