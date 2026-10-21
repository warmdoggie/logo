import test from 'node:test';
import assert from 'node:assert/strict';
import * as previews from './preview-images.mjs';

test('预览并发请求去重，返回看过的产品不重新下载，同组图片解码后一起显示',async()=>{
 assert.equal(typeof previews.createPreviewImages,'function');
 let calls=0,release;const gate=new Promise(r=>release=r),snapshots=[];
 const viewer=previews.createPreviewImages({request:async()=>{calls++;return {ok:true,blob:async()=>new Blob(['image'])};},makeUrl:()=>`blob:${calls}`,dropUrl:()=>{},warm:async()=>{}});
 const images=[{hidden:false,src:'old-a',decode:async()=>gate},{hidden:false,src:'old-b',decode:async()=>{}}];
 const entries=images.map(image=>({image,url:'/same.png'}));
 const pending=viewer.show('a',entries,{onReady:()=>snapshots.push(images.map(image=>image.hidden))});
 assert.ok(images.every(image=>image.hidden),'新产品准备期间不能继续展示旧产品的图片');
 await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(snapshots.length,0);
 release();await pending;assert.deepEqual(snapshots,[[false,false]]);
 await viewer.show('b',images.map(image=>({image,url:'/other.png'})));
 await viewer.show('a',entries);assert.equal(calls,2,'返回已访问产品不应重复下载');
 viewer.clear();
});

test('快速切换时迟到的图片不能覆盖当前产品',async()=>{
 assert.equal(typeof previews.createPreviewImages,'function');
 let release;const gate=new Promise(r=>release=r),events=[];
 const viewer=previews.createPreviewImages({request:async url=>{if(url==='/slow.png')await gate;return {ok:true,blob:async()=>new Blob([url])};},makeUrl:blob=>blob,dropUrl:()=>{},warm:async()=>{}});
 const image={hidden:false,src:'old',decode:async()=>{}};
 const slow=viewer.show('slow',[{image,url:'/slow.png'}],{onReady:()=>events.push('slow')});
 await viewer.show('fast',[{image,url:'/fast.png'}],{onReady:()=>events.push('fast')});
 const fast=image.src;release();await slow;assert.equal(image.src,fast);assert.deepEqual(events,['fast']);viewer.clear();
});

test('预览失败后保持提示，用户重试时重新请求而不反复自动重试',async()=>{
 let calls=0,errors=0;
 const viewer=previews.createPreviewImages({request:async()=>{calls++;if(calls===1)throw Error('network');return {ok:true,blob:async()=>new Blob(['ok'])};},makeUrl:()=> 'blob:ok',dropUrl:()=>{},warm:async()=>{}});
 const image={hidden:false,decode:async()=>{}},entries=[{image,url:'/retry.png'}];
 await viewer.show('retry',entries,{onError:()=>errors++});
 await viewer.show('retry',entries);assert.equal(calls,1);assert.equal(errors,1);
 viewer.retry();await viewer.show('retry',entries);assert.equal(calls,2);assert.equal(image.hidden,false);viewer.clear();
});
