import {test} from 'node:test';import assert from 'node:assert/strict';
import {sharp,analyzePixels} from './logo-pixels.mjs';import {transparentMaster} from './smart-background.mjs';
const svg=body=>Buffer.from('<svg width="720" height="200" xmlns="http://www.w3.org/2000/svg">'+body+'</svg>');
const draw=(bg='#ffffff',ink='#080808')=>svg(`<rect width="720" height="200" fill="${bg}"/><text x="25" y="133" font-family="Arial" font-weight="bold" font-size="85" fill="${ink}">SUGAR DEVIL</text><circle cx="663" cy="110" r="14" fill="#eb81ab"/>`);
const px=(d,x,y,w=720)=>[...d.subarray((y*w+x)*4,(y*w+x)*4+4)];
test('白底双色文字及小彩色标记自动去底；JPEG 压缩边缘不误判为复杂图形',async()=>{
 for(const quality of [null,95,80,60]){
  const source=sharp(draw()),input=await (quality?source.jpeg({quality}):source.png()).toBuffer(),r=await transparentMaster(input);
  assert.equal(r.status,'READY');assert.equal(r.needsReview,false,JSON.stringify({quality,...r,buffer:undefined}));assert.equal(r.method,'FLAT_COLOR_MATTE');
  const {data,info}=await sharp(r.buffer).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(px(data,5,5)[3],0);const pink=px(data,663,110);assert.ok(pink[0]>210&&pink[1]>90&&pink[1]<170&&pink[2]>140&&pink[3]===255,'粉色标记保留');
  const a=analyzePixels(data,info.width,info.height);assert.equal(a.estimatedColorCount,2);assert.equal(a.hasTransparency,false);assert.equal(a.hasGradient,false);assert.equal(a.analysisConfidence,'HIGH');
 }
});
test('黑底和彩色均匀底保留两种墨色与原尺寸',async()=>{
 for(const [bg,ink] of [['#000000','#ffffff'],['#cce0f5','#101010']]){
  const r=await transparentMaster(await sharp(draw(bg,ink)).png().toBuffer());assert.equal(r.needsReview,false,JSON.stringify({...r,buffer:undefined}));assert.equal(r.width,720);assert.equal(r.height,200);
  const d=await sharp(r.buffer).ensureAlpha().raw().toBuffer();assert.equal(px(d,5,5)[3],0);assert.equal(px(d,663,110)[3],255);
 }
});
test('不以主文字面积为阈值吞掉独立的小色点',async()=>{
 const input=svg('<rect width="720" height="200" fill="white"/><rect x="20" y="30" width="600" height="140" fill="black"/><circle cx="670" cy="100" r="5" fill="#e479a3"/>');
 const r=await transparentMaster(await sharp(input).png().toBuffer());assert.equal(r.needsReview,false);const d=await sharp(r.buffer).ensureAlpha().raw().toBuffer();assert.ok(px(d,670,100)[0]>200);assert.equal(px(d,670,100)[3],255);const a=analyzePixels(d,720,200);assert.equal(a.estimatedColorCount,2);assert.equal(a.analysisConfidence,'HIGH');
});
test('紧密字母间的长窄平滑缝隙不是内容透明，宽半透明区域仍需复核',()=>{
 const w=120,h=160;
 const draw=gap=>{const data=Buffer.alloc(w*h*4);for(let y=20;y<140;y++)for(let x=15;x<105;x++)data[(y*w+x)*4+3]=x>=55-gap/2&&x<55+gap/2?96:255;return data;};
 const narrow=analyzePixels(draw(6),w,h);assert.equal(narrow.hasTransparency,false);assert.equal(narrow.needsManualReview,false);assert.equal(narrow.contentPartialPixels,0);assert.equal(narrow.antialiasPixels,720);
 const wide=analyzePixels(draw(24),w,h);assert.equal(wide.hasTransparency,true);assert.ok(wide.contentPartialPixels>100);
 const detached=Buffer.alloc(w*h*4);for(let y=20;y<140;y++)for(let x=15;x<45;x++)detached[(y*w+x)*4+3]=255;for(let y=20;y<140;y++)for(let x=55;x<61;x++)detached[(y*w+x)*4+3]=100;
 assert.equal(analyzePixels(detached,w,h).hasTransparency,true);
});
test('彩色图形内的白色填充保留待确认，渐变及阴影不能伪装成实色边缘',async()=>{
 const inner=svg('<rect width="720" height="200" fill="white"/><rect x="20" y="20" width="140" height="140" fill="#ee3344"/><rect x="60" y="60" width="60" height="60" fill="white"/><circle cx="300" cy="100" r="50" fill="#2244aa"/>');
 const r=await transparentMaster(await sharp(inner).png().toBuffer());assert.equal(r.needsReview,true);assert.deepEqual(px(await sharp(r.buffer).ensureAlpha().raw().toBuffer(),80,80),[255,255,255,255]);
 const gradient=svg('<defs><linearGradient id="g"><stop stop-color="black"/><stop offset="1" stop-color="#eeeeee"/></linearGradient></defs><rect width="720" height="200" fill="white"/><rect x="20" y="20" width="500" height="140" fill="url(#g)"/><circle cx="663" cy="100" r="14" fill="#eb81ab"/>');
 assert.equal((await transparentMaster(await sharp(gradient).png().toBuffer())).needsReview,true);
 const shadow=svg('<rect width="720" height="200" fill="white"/><rect x="20" y="20" width="300" height="130" fill="black"/><path d="M320 20h40v130h-40z" fill="#dddddd"/><circle cx="663" cy="100" r="14" fill="#eb81ab"/>');
 // A flat intentional grey fill is retained as its own colour, never erased.
 const s=await transparentMaster(await sharp(shadow).png().toBuffer());if(s.needsReview===false)assert.ok(px(await sharp(s.buffer).ensureAlpha().raw().toBuffer(),340,80)[3]>0);
});
