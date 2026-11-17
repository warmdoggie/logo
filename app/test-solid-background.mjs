import {test} from 'node:test';import assert from 'node:assert/strict';
import {sharp,analyzePixels} from './logo-pixels.mjs';import {transparentMaster} from './smart-background.mjs';
const png=svg=>sharp(Buffer.from(svg)).png().toBuffer();
const pixel=(d,x,y,w)=>[...d.subarray((y*w+x)*4,(y*w+x)*4+4)];
test('自动单色去底保留内孔、独立点、细线与反色文字，压缩噪声不形成新墨色',async()=>{
 for(const [bg,ink] of [['#ffffff','#000000'],['#facce1','#000000'],['#000000','#ffffff'],['#ffffff','#66333d']]){
  const bytes=await png(`<svg width="240" height="120"><rect width="240" height="120" fill="${bg}"/><path d="M30 25H90V95H30Z M45 40V80H75V40Z" fill="${ink}" fill-rule="evenodd"/><circle cx="130" cy="35" r="4" fill="${ink}"/><path d="M125 90Q140 15 205 75" stroke="${ink}" stroke-width="1.3" fill="none"/></svg>`);
  const r=await transparentMaster(bytes);assert.equal(r.needsReview,false);assert.equal(r.method,'SOLID_INK_MATTE');const d=await sharp(r.buffer).ensureAlpha().raw().toBuffer();assert.equal(pixel(d,60,60,240)[3],0);assert.equal(pixel(d,10,10,240)[3],0);assert.equal(pixel(d,130,35,240)[3],255);assert.equal(pixel(d,35,50,240)[3],255);assert.ok([...d.subarray(120*4)].some((a,i)=>i%4===3&&a>0&&a<255),'保留平滑细线边缘');
 }
});
test('复杂与多色内容保留原像素待复核，不把渐变、内部白色或低对比图案强制变成单色',async()=>{
 const multi=await png('<svg width="160" height="100"><rect width="160" height="100" fill="white"/><rect x="20" y="20" width="60" height="60" fill="#dd3344"/><rect x="35" y="35" width="30" height="30" fill="white"/><rect x="95" y="20" width="40" height="60" fill="#2255bb"/></svg>');
 const r=await transparentMaster(multi);assert.equal(r.needsReview,true);assert.match(r.reason,/封闭区域/);const d=await sharp(r.buffer).ensureAlpha().raw().toBuffer();assert.deepEqual(pixel(d,40,40,160),[255,255,255,255]);assert.deepEqual(pixel(d,100,40,160),[34,85,187,255]);assert.equal(d[3],0);
 const grad=await png('<svg width="180" height="100"><defs><linearGradient id="g"><stop stop-color="black"/><stop offset="1" stop-color="#eeeeee"/></linearGradient></defs><rect width="180" height="100" fill="white"/><rect x="20" y="20" width="140" height="60" fill="url(#g)"/></svg>');
 assert.equal((await transparentMaster(grad)).needsReview,true);
 const faint=await png('<svg width="120" height="80"><rect width="120" height="80" fill="white"/><rect x="20" y="20" width="80" height="40" fill="#ededed"/></svg>');
 assert.notEqual((await transparentMaster(faint)).needsReview,false);
 const photo=await png('<svg width="120" height="80"><defs><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="120" height="80" fill="url(#g)"/></svg>');
 assert.equal((await transparentMaster(photo)).status,'DESIGNER_REQUIRED');
});
test('已有透明通道逐像素保留；独立半透明图形不能借用附近实色的置信度',async()=>{
 const bytes=await png('<svg width="160" height="100"><rect x="20" y="20" width="60" height="60" fill="#66283b"/><rect x="85" y="30" width="40" height="30" fill="#66283b" opacity=".4"/></svg>');
 const r=await transparentMaster(bytes);assert.equal(r.method,'KEEP_ALPHA');const before=await sharp(bytes).ensureAlpha().raw().toBuffer(),after=await sharp(r.buffer).ensureAlpha().raw().toBuffer();assert.deepEqual(after,before);assert.equal(analyzePixels(after,160,100).hasTransparency,true);
});
test('连通的细笔画末端识别为边缘，独立半透明小标记仍需复核',()=>{
 const w=60,h=30,d=Buffer.alloc(w*h*4);for(let y=10;y<20;y++)for(let x=10;x<25;x++)d.set([0,0,0,255],(y*w+x)*4);for(let x=25;x<34;x++)d.set([0,0,0,160],(15*w+x)*4);
 assert.equal(analyzePixels(d,w,h).hasTransparency,false);
 for(let y=8;y<12;y++)for(let x=30;x<34;x++)d.set([0,0,0,160],(y*w+x)*4);
 assert.equal(analyzePixels(d,w,h).hasTransparency,true);
});
