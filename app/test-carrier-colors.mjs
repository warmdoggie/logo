import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sharp} from './logo-pixels.mjs';
import {normalizeLogoColor,tintCarrierLogo} from './carrier-colors.mjs';
test('载体Logo改色：仅改变可见RGB，透明度/尺寸/输入不变，空图与非法颜色拒绝',async()=>{
 const raw=Buffer.from([1,2,3,0,200,5,10,128,100,200,3,255,3,4,200,255]);
 const input=await sharp(raw,{raw:{width:2,height:2,channels:4}}).png().toBuffer(),original=Buffer.from(input);
 const v=await tintCarrierLogo(input,'#FfFfFf'),out=await sharp(v.png).raw().toBuffer();
 assert.deepEqual(input,original);assert.equal(v.provenance.color,'#ffffff');assert.equal(v.observation.hasTransparency,true);
 for(let i=0;i<4;i++){assert.equal(out[i*4+3],raw[i*4+3]);if(raw[i*4+3])assert.deepEqual([...out.subarray(i*4,i*4+3)],[255,255,255]);else assert.deepEqual(out.subarray(i*4,i*4+4),raw.subarray(i*4,i*4+4));}
 assert.deepEqual((await tintCarrierLogo(input,'#ffffff')).png,v.png);assert.equal(v.observation.width,2);assert.equal(v.observation.height,2);
 for(const value of ['red','#fff','#ffffff00',' #ffffff',{},1])assert.throws(()=>normalizeLogoColor(value));
 const empty=await sharp({create:{width:2,height:2,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();await assert.rejects(tintCarrierLogo(empty,'#000000'),/全透明/);
});
