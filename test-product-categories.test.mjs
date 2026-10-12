import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('产品录入和编辑使用四个一级产品大类',async()=>{
  const app=await readFile(new URL('./01_Source_Code/public/app.js',import.meta.url),'utf8');
  const management=await readFile(new URL('./01_Source_Code/public/management-ui.js',import.meta.url),'utf8');
  for(const category of ['唇部','脸部','身体','眼部']){
    assert.match(app,new RegExp(category));
    assert.match(management,new RegExp(category));
  }
  assert.doesNotMatch(app,/value="唇蜜"/);
  assert.doesNotMatch(app,/value="修容棒"/);
});
