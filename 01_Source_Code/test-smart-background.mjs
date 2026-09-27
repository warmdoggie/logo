import {test} from 'node:test';import assert from 'node:assert/strict';import {sharp} from './logo-pixels.mjs';import {transparentMaster,referenceColor} from './smart-background.mjs';
test('白/黑/彩色底：只去边缘连通背景，保留封闭内部白色、多色和原比例',async()=>{
 for(const bg of [[255,255,255],[0,0,0],[30,120,180]]){
  const raw=Buffer.alloc(40*40*4);for(let y=0;y<40;y++)for(let x=0;x<40;x++){const ring=x>=10&&x<30&&y>=10&&y<30,color=ring?(x>=14&&x<26&&y>=14&&y<26?bg:[220,30,70]):bg;raw.set([...color,255],(y*40+x)*4);}
  const input=await sharp(raw,{raw:{width:40,height:40,channels:4}}).png().toBuffer(),out=await transparentMaster(input);assert.equal(out.status,'READY');const decoded=await sharp(out.buffer).raw().toBuffer();assert.equal(decoded[3],0);assert.deepEqual([...decoded.subarray((20*40+20)*4,(20*40+20)*4+4)],[...bg,255]);assert.deepEqual([...decoded.subarray((10*40+10)*4,(10*40+10)*4+4)],[220,30,70,255]);assert.equal(out.width,40);
 }
});
test('已有透明通道保留，多像素平均吸色不标为 Pantone，复杂背景转设计师',async()=>{
 const transparent=await sharp({create:{width:20,height:20,channels:4,background:'#12345680'}}).png().toBuffer();const r=await transparentMaster(transparent);assert.equal(r.method,'KEEP_ALPHA');assert.deepEqual((await referenceColor(transparent,.5,.5)).rgb,[18,52,86]);
 const raw=Buffer.alloc(20*20*4);for(let i=0;i<400;i++)raw.set([i%256,(i*43)%256,(i*79)%256,255],i*4);const complex=await sharp(raw,{raw:{width:20,height:20,channels:4}}).png().toBuffer();assert.equal((await transparentMaster(complex)).status,'DESIGNER_REQUIRED');
});
