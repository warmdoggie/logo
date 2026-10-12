import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  assert.match(script,/triggerTransparentLogoDownload\(logoData/);
});
