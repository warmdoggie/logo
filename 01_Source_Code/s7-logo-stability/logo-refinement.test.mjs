import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';

async function refineThroughApi(raw,width,height,targetColor='#000000'){
  const png=await sharp(raw,{raw:{width,height,channels:4}}).png().toBuffer();
  let saved;
  const server=createDemoServer({aiProcessor:async()=>{throw Error('Local processing must never call AI');},saveLogoToLibrary:async(req,bytes)=>{saved=bytes;return {id:'refined'};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/process-logo`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({logoImage:png.toString('base64'),targetColor,cropTransparentBounds:false})});
    const payload=await response.json();
    assert.equal(response.status,200,JSON.stringify(payload));
    const bytes=Buffer.from(payload.dataUrl.split(',')[1],'base64');
    assert.deepEqual(saved,bytes,'Logo library must receive the same cleaned PNG shown to the user');
    const decoded=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(decoded.info.width,width);assert.equal(decoded.info.height,height);
    return decoded.data;
  }finally{await new Promise(resolve=>server.close(resolve));}
}

function shapes(){
  const width=96,height=72,raw=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const r=Math.hypot(x-28,y-30);
    if((r<=20&&r>=11)||(x>=60&&x<=80&&y>=12&&y<=x-40)||(y===62&&x>=12&&x<=50)||(x>=50&&x<=52&&y>=54&&y<=56)){
      const noise=(x*17+y*13)%19;
      raw.set([noise,noise+2,noise+4,255],(y*width+x)*4);
    }
  }
  raw.set([180,190,200,4],(5*width+5)*4);
  return {raw,width,height};
}

test('local black Logo output removes RGB contamination while retaining transparent holes and small marks',async()=>{
  const {raw,width,height}=shapes(),out=await refineThroughApi(raw,width,height);
  let partial=0,areaBefore=0,areaAfter=0;
  for(let i=0;i<out.length;i+=4){
    if(out[i+3])assert.deepEqual([...out.subarray(i,i+3)],[0,0,0]);
    if(out[i+3]>0&&out[i+3]<255)partial++;
    areaBefore+=raw[i+3]/255;areaAfter+=out[i+3]/255;
  }
  assert.ok(partial>40,'binary stair steps should acquire partial pixel coverage');
  assert.ok(Math.abs(areaAfter/areaBefore-1)<.05,'smoothing must not noticeably thicken or erode the artwork');
  assert.equal(out[(30*width+28)*4+3],0,'letter hole must remain transparent');
  assert.equal(out[(5*width+5)*4+3],0,'near-invisible haze must be cleared');
  assert.ok(out[(55*width+51)*4+3]>220,'small legitimate mark must remain');
  assert.ok(out[(62*width+30)*4+3]>170,'one-pixel stroke must remain visible');
  assert.equal(out[(30*width+10)*4+3],255,'solid interior must remain opaque');
});

test('local processing removes a framed solid background inside letter holes without AI',async()=>{
  const width=64,height=64,raw=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const r=Math.hypot(x-32,y-32);
    const border=x<2||y<2||x>=width-2||y>=height-2;
    raw.set(border?[128,128,128,255]:r>=10&&r<=22?[190,140,75,255]:[0,0,0,255],(y*width+x)*4);
  }
  const out=await refineThroughApi(raw,width,height,'original');
  assert.equal(out[3],0,'outside background must be transparent');
  assert.equal(out[(32*width+32)*4+3],0,'enclosed letter hole must be transparent');
  assert.deepEqual([...out.subarray((16*width+32)*4,(16*width+32)*4+4)],[190,140,75,255]);
});

test('local processing preserves an already transparent Logo touching the canvas edge',async()=>{
  const width=32,height=24,raw=Buffer.alloc(width*height*4);
  for(let y=5;y<19;y++)for(let x=0;x<15;x++)raw.set([0,0,0,255],(y*width+x)*4);
  const out=await refineThroughApi(raw,width,height);
  assert.equal(out[(12*width+3)*4+3],255);
  assert.equal(out[(12*width+28)*4+3],0);
});

test('local processing recovers foreground color from antialiased pixels blended with a black background',async()=>{
  const width=40,height=32,raw=Buffer.alloc(width*height*4);
  for(let i=3;i<raw.length;i+=4)raw[i]=255;
  for(let y=8;y<24;y++)for(let x=8;x<32;x++)raw.set([190,140,76,255],(y*width+x)*4);
  for(let y=8;y<24;y++)raw.set([95,70,38,255],(y*width+7)*4);
  const out=await refineThroughApi(raw,width,height,'original'),i=(16*width+7)*4;
  assert.deepEqual([...out.subarray(i,i+3)],[190,140,76]);
  assert.ok(out[i+3]>80&&out[i+3]<180,'background mixture must become partial coverage');
});

test('local processing keeps opaque artwork touching the first corner',async()=>{
  const width=64,height=64,raw=Buffer.alloc(width*height*4,255);
  for(let y=0;y<24;y++)for(let x=0;x<12;x++)raw.set([0,0,0,255],(y*width+x)*4);
  const out=await refineThroughApi(raw,width,height);
  assert.equal(out[(10*width+6)*4+3],255);
  assert.equal(out[(40*width+40)*4+3],0);
});

test('local processing preserves opaque pale ink beside a darker ink with the same hue',async()=>{
  const width=80,height=48,raw=Buffer.alloc(width*height*4,255);
  for(let y=8;y<40;y++)for(let x=4;x<36;x++)raw.set([0,0,200,255],(y*width+x)*4);
  for(let y=12;y<36;y++)for(let x=52;x<72;x++)raw.set([128,128,228,255],(y*width+x)*4);
  const out=await refineThroughApi(raw,width,height,'original');
  assert.deepEqual([...out.subarray((24*width+62)*4,(24*width+62)*4+4)],[128,128,228,255]);
  assert.deepEqual([...out.subarray((24*width+53)*4,(24*width+53)*4+4)],[128,128,228,255]);
});

test('original-color Logo output merges small color variations without merging distinct brand colors',async()=>{
  const width=72,height=40,raw=Buffer.alloc(width*height*4);
  for(let y=8;y<32;y++)for(let x=8;x<64;x++){
    const base=x<36?[190,30,60]:[20,80,195],noise=(x*7+y*11)%13-6;
    raw.set([...base.map(c=>c+noise),255],(y*width+x)*4);
  }
  const out=await refineThroughApi(raw,width,height,'original'),colors=[new Set(),new Set()];
  for(let y=12;y<28;y++)for(let x=12;x<60;x++){
    if(x>=32&&x<=39)continue;
    const i=(y*width+x)*4;colors[x<36?0:1].add([...out.subarray(i,i+3)].join(','));
  }
  assert.equal(colors[0].size,1,'red color block should be uniform');
  assert.equal(colors[1].size,1,'blue color block should be uniform');
  const red=[...colors[0]][0].split(',').map(Number),blue=[...colors[1]][0].split(',').map(Number);
  for(let c=0;c<3;c++){assert.ok(Math.abs(red[c]-[190,30,60][c])<=2);assert.ok(Math.abs(blue[c]-[20,80,195][c])<=2);}
});

test('original-color single-color Logo removes white matte from partially transparent edge pixels',async()=>{
  const width=32,height=24,raw=Buffer.alloc(width*height*4);
  for(let y=6;y<18;y++)for(let x=6;x<26;x++)raw.set([180,25,55,255],(y*width+x)*4);
  for(let y=6;y<18;y++){raw.set([220,140,155,128],(y*width+5)*4);raw.set([220,140,155,128],(y*width+26)*4);}
  const out=await refineThroughApi(raw,width,height,'original');
  assert.ok(out[(12*width+5)*4+3]>0);
  assert.deepEqual([...out.subarray((12*width+5)*4,(12*width+5)*4+3)],[180,25,55]);
});

test('original-color Logo retains a translucent accent with no opaque color sample',async()=>{
  const width=48,height=32,raw=Buffer.alloc(width*height*4);
  for(let y=6;y<26;y++)for(let x=6;x<22;x++)raw.set([10,70,200,255],(y*width+x)*4);
  for(let y=8;y<24;y++)for(const x of [23,34])raw.set([220,30,45,180],(y*width+x)*4);
  const out=await refineThroughApi(raw,width,height,'original');
  for(const x of [23,34]){
    assert.deepEqual([...out.subarray((15*width+x)*4,(15*width+x)*4+3)],[220,30,45]);
    assert.ok(out[(15*width+x)*4+3]>100,'the translucent accent must stay visible');
  }
});

test('local processing removes isolated compression specks while preserving dots and thin strokes',async()=>{
  const {raw,width,height}=shapes();
  for(const [x,y] of [[4,5],[5,5],[88,62]])raw.set([45,45,45,255],(y*width+x)*4);
  const out=await refineThroughApi(raw,width,height);
  for(const [x,y] of [[4,5],[5,5],[88,62]])assert.equal(out[(y*width+x)*4+3],0,'detached one- and two-pixel dirt must disappear');
  assert.ok(out[(55*width+51)*4+3]>220,'the small dot must remain');
  assert.ok(out[(62*width+30)*4+3]>170,'the thin line must remain');
});

test('local original-color processing flattens noisy gold instead of abandoning its palette',async()=>{
  const width=80,height=48,raw=Buffer.alloc(width*height*4);
  for(let y=8;y<40;y++)for(let x=8;x<72;x++){
    const noise=[(x*17+y*11)%43-21,(x*7+y*19)%43-21,(x*13+y*5)%43-21];
    raw.set([...[210,195,160].map((c,i)=>c+noise[i]),255],(y*width+x)*4);
  }
  const out=await refineThroughApi(raw,width,height,'original'),colors=new Set();
  for(let y=12;y<36;y++)for(let x=12;x<68;x++){
    const i=(y*width+x)*4;colors.add([...out.subarray(i,i+3)].join(','));
    assert.equal(out[i+3],255);
  }
  assert.equal(colors.size,1,'a noisy single ink must become one solid color');
});

test('local processing clears a screenshot edge remnant outside its framed background',async()=>{
  const width=80,height=60,raw=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const border=x<2||y<2||x>=width-2||y>=height-2;
    raw.set(border?[128,128,128,255]:[0,0,0,255],(y*width+x)*4);
  }
  for(let y=16;y<44;y++)for(let x=20;x<60;x++)raw.set([210,195,160,255],(y*width+x)*4);
  for(let y=30;y<40;y++)for(let x=0;x<3;x++)raw.set([30,55,125,255],(y*width+x)*4);
  for(let y=30;y<40;y++)raw.set([100,100,100,255],(y*width+2)*4);
  for(let x=4;x<60;x++){
    const a=Math.min(1,(x-3)/15);
    raw.set([...[210,195,160].map(c=>Math.round(c*a)),255],(48*width+x)*4);
  }
  const out=await refineThroughApi(raw,width,height);
  assert.equal(out[(35*width+1)*4+3],0);
  assert.equal(out[(35*width+2)*4+3],0,'all colors in the attached frame fragment must be removed');
  assert.equal(out[(30*width+40)*4+3],255);
  assert.ok(out[(48*width+40)*4+3]>170,'the tapered underline must remain');
});

test('local original-color processing rejects rare dark contamination in a dominant gold ink',async()=>{
  const width=80,height=48,raw=Buffer.alloc(width*height*4);
  for(let y=8;y<40;y++)for(let x=8;x<72;x++)raw.set([210,195,160,255],(y*width+x)*4);
  for(let y=16;y<20;y++)for(let x=20;x<28;x++)raw.set([45,35,20,255],(y*width+x)*4);
  const out=await refineThroughApi(raw,width,height,'original');
  assert.deepEqual([...out.subarray((18*width+24)*4,(18*width+24)*4+4)],[210,195,160,255]);
});

test('local original-color processing retains a small opaque accent of a distinct hue',async()=>{
  const width=80,height=48,raw=Buffer.alloc(width*height*4);
  for(let y=8;y<40;y++)for(let x=8;x<64;x++)raw.set([210,195,160,255],(y*width+x)*4);
  for(let y=20;y<24;y++)for(let x=70;x<74;x++)raw.set([200,20,45,255],(y*width+x)*4);
  const out=await refineThroughApi(raw,width,height,'original');
  assert.deepEqual([...out.subarray((22*width+72)*4,(22*width+72)*4+3)],[200,20,45]);
});

test('local processing preserves a three-pixel dot above a small raster letter stem',async()=>{
  const width=32,height=32,raw=Buffer.alloc(width*height*4);
  for(let y=10;y<27;y++)for(let x=14;x<17;x++)raw.set([0,0,0,255],(y*width+x)*4);
  for(let x=14;x<17;x++)raw.set([0,0,0,255],(6*width+x)*4);
  const out=await refineThroughApi(raw,width,height);
  assert.ok(out[(6*width+15)*4+3]>170,'the dot is part of the letter, not isolated dirt');
});

test('local original-color processing preserves separate solid red and orange inks',async()=>{
  const width=80,height=48,raw=Buffer.alloc(width*height*4);
  for(let y=8;y<40;y++)for(let x=8;x<72;x++)raw.set(x<40?[200,20,45,255]:[230,55,30,255],(y*width+x)*4);
  const out=await refineThroughApi(raw,width,height,'original');
  for(const [x,color] of [[20,[200,20,45]],[60,[230,55,30]]])assert.deepEqual([...out.subarray((24*width+x)*4,(24*width+x)*4+3)],color);
});

test('local processing removes dark dust near a gold stem without treating it as a letter dot',async()=>{
  const width=32,height=32,raw=Buffer.alloc(width*height*4);
  for(let y=10;y<27;y++)for(let x=14;x<17;x++)raw.set([210,195,160,255],(y*width+x)*4);
  raw.set([45,35,20,255],(6*width+15)*4);
  const out=await refineThroughApi(raw,width,height);
  assert.equal(out[(6*width+15)*4+3],0);
});

test('local original-color processing unifies a translucent shade of its gold ink',async()=>{
  const width=64,height=40,raw=Buffer.alloc(width*height*4);
  for(let y=8;y<32;y++)for(let x=8;x<32;x++)raw.set([216,202,170,255],(y*width+x)*4);
  for(let y=12;y<28;y++)raw.set([178,165,133,128],(y*width+44)*4);
  const out=await refineThroughApi(raw,width,height,'original');
  assert.deepEqual([...out.subarray((20*width+44)*4,(20*width+44)*4+3)],[216,202,170]);
  assert.ok(out[(20*width+44)*4+3]>0);
});

test('local processing clears dust connected to the artwork only by a faint alpha bridge',async()=>{
  const width=64,height=48,raw=Buffer.alloc(width*height*4);
  for(let y=8;y<40;y++)for(let x=8;x<28;x++)raw.set([0,0,0,255],(y*width+x)*4);
  for(let x=28;x<40;x++)raw.set([0,0,0,12],(22*width+x)*4);
  raw.set([0,0,0,180],(22*width+40)*4);
  const out=await refineThroughApi(raw,width,height);
  assert.equal(out[(22*width+40)*4+3],0,'faint connections must not protect a dirt pixel');
  assert.equal(out[(22*width+37)*4+3],0,'the detached faint bridge must also disappear');
  assert.equal(out[(22*width+20)*4+3],255);
});

test('local processing does not recreate detached faint dots during smoothing',async()=>{
  const width=64,height=48,raw=Buffer.alloc(width*height*4);
  for(let y=8;y<40;y++)for(let x=8;x<28;x++)raw.set([0,0,0,255],(y*width+x)*4);
  for(const [x,y] of [[30,22],[31,23],[32,24],[33,25]])raw.set([0,0,0,10],(y*width+x)*4);
  const out=await refineThroughApi(raw,width,height);
  for(let y=19;y<29;y++)for(let x=30;x<37;x++)assert.equal(out[(y*width+x)*4+3],0,'background beyond the antialias edge must be fully transparent');
  assert.ok(out[(22*width+27)*4+3]>170,'the artwork edge must remain');
});

test('local processing does not preserve dirt beside a diagonal stroke as a letter dot',async()=>{
  const width=48,height=48,raw=Buffer.alloc(width*height*4);
  for(let y=20;y<40;y++)for(let dx=0;dx<3;dx++)raw.set([0,0,0,255],(y*width+y+dx)*4);
  raw.set([0,0,0,180],(16*width+24)*4);
  const out=await refineThroughApi(raw,width,height);
  assert.equal(out[(16*width+24)*4+3],0);
  assert.ok(out[(30*width+31)*4+3]>170);
});

test('local processing preserves the dot above a short upright raster stem',async()=>{
  const width=16,height=16,raw=Buffer.alloc(width*height*4);
  for(let y=6;y<10;y++)for(let x=6;x<9;x++)raw.set([0,0,0,255],(y*width+x)*4);
  for(let x=6;x<9;x++)raw.set([0,0,0,255],(3*width+x)*4);
  const out=await refineThroughApi(raw,width,height);
  assert.ok(out[(3*width+7)*4+3]>170);
});
