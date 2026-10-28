import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildTransparentLogoDataUrl,triggerTransparentLogoDownload} from './transparent-logo-download.mjs';

test('transparent Logo data is normalized to a PNG data URL',()=>{
  assert.equal(buildTransparentLogoDataUrl('abc123'),'data:image/png;base64,abc123');
  assert.equal(buildTransparentLogoDataUrl('data:image/png;base64,already'), 'data:image/png;base64,already');
});

test('transparent Logo download uses only the Logo PNG and a stable filename',()=>{
  const calls=[];
  const documentRef={createElement(tag){
    assert.equal(tag,'a');
    return {click(){calls.push({href:this.href,download:this.download});}};
  }};
  triggerTransparentLogoDownload('abc123',{documentRef,filename:'F0083-logo-transparent.png'});
  assert.deepEqual(calls,[{href:'data:image/png;base64,abc123',download:'F0083-logo-transparent.png'}]);
});

test('placement canvas saves the transparent Logo only when the context menu is over a target',()=>{
  const script=fs.readFileSync(new URL('./demo.js',import.meta.url),'utf8');
  assert.match(script,/canvas\.addEventListener\('contextmenu'/);
  assert.match(script,/const normalized=pointerToNormalized\(event\.clientX,event\.clientY,canvas\.getBoundingClientRect\(\)\)/);
  assert.match(script,/if\(!targetAt\(normalized\)\)return/);

});


for(const snapshot of [false,true])test(`右键下载${snapshot?'任务快照的完整原图':'旧版内联原图'}`,async()=>{
 const script=fs.readFileSync(new URL('./demo.js',import.meta.url),'utf8'),calls=[];let handler;
 const c=vm.createContext({canvas:{addEventListener:(_event,fn)=>handler=fn,getBoundingClientRect:()=>({})},baseImage:{},logoImage:{},logoData:'preview',loadedTaskLogoId:'one',taskLogos:[{id:'one',...(snapshot?{logoAssetUrl:'/snapshot'}:{})}],pointerToNormalized:()=>({}),targetAt:()=>true,setStatus(){},fetch:async url=>{assert.equal(url,'/snapshot');return {ok:true,blob:async()=>({})};},fileData:async()=>({data:'full-original'}),triggerTransparentLogoDownload:data=>calls.push(data)});
 const start=script.indexOf("canvas.addEventListener('contextmenu'");vm.runInContext(script.slice(start,script.indexOf("document.querySelector('#add-target')",start)),c);
 await handler({preventDefault(){},clientX:0,clientY:0});assert.deepEqual(calls,[snapshot?'full-original':'preview']);
});
