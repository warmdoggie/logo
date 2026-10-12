import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {renderLogoSet} from './index.mjs';

async function solid(width,height,background) {
  return sharp({create:{width,height,channels:4,background}}).png().toBuffer();
}

async function transparentLogo() {
  const raw=Buffer.alloc(8*4*4);
  for(let i=0;i<8*4;i++){
    raw[i*4]=255;
    raw[i*4+1]=255;
    raw[i*4+2]=255;
    raw[i*4+3]=255;
  }
  return sharp(raw,{raw:{width:8,height:4,channels:4}}).png().toBuffer();
}

async function narrowMarkLogo() {
  const raw=Buffer.alloc(16*8*4);
  for(let y=0;y<8;y++)for(const x of [1,2,13,14]){
    const offset=(y*16+x)*4;
    raw[offset]=255;
    raw[offset+1]=255;
    raw[offset+2]=255;
    raw[offset+3]=255;
  }
  return sharp(raw,{raw:{width:16,height:8,channels:4}}).png().toBuffer();
}

function inside(point,bounds) {
  return bounds.some(b=>point.x>=b.left&&point.x<b.left+b.width&&point.y>=b.top&&point.y<b.top+b.height);
}

test('四个版本共享同一布局，并覆盖全部上样目标',async()=>{
  const base=await solid(80,40,{r:240,g:230,b:220,alpha:1});
  const logo=await transparentLogo();
  const targets=[
    {id:'compact',x:.2,y:.5,widthRatio:.18,rotation:0},
    {id:'box',x:.75,y:.5,widthRatio:.22,rotation:90}
  ];

  const result=await renderLogoSet({baseImage:base,logoImage:logo,targets});

  assert.deepEqual(result.outputs.map(v=>v.version),['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL']);
  assert.deepEqual(result.targetIds,['compact','box']);
  assert.equal(new Set(result.outputs.map(v=>v.layoutFingerprint)).size,1);
  assert.equal(result.outputs.every(v=>v.bounds.length===2),true);

  const baseRaw=await sharp(base).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(const output of result.outputs){
    const raw=await sharp(output.bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(let y=0;y<40;y++)for(let x=0;x<80;x++)if(!inside({x,y},output.bounds)){
      const i=(y*80+x)*4;
      assert.deepEqual([...raw.data.subarray(i,i+4)],[...baseRaw.data.subarray(i,i+4)],`${output.version} changed protected pixel ${x},${y}`);
    }
  }
});

test('目标缺失、重复或越界时拒绝生成',async()=>{
  const base=await solid(40,20,{r:255,g:255,b:255,alpha:1});
  const logo=await transparentLogo();
  await assert.rejects(()=>renderLogoSet({baseImage:base,logoImage:logo,targets:[]}),/至少需要一个上样目标/);
  await assert.rejects(()=>renderLogoSet({baseImage:base,logoImage:logo,targets:[{id:'same',x:.3,y:.5,widthRatio:.2},{id:'same',x:.7,y:.5,widthRatio:.2}]}),/目标ID不能重复/);
  await assert.rejects(()=>renderLogoSet({baseImage:base,logoImage:logo,targets:[{id:'edge',x:.01,y:.5,widthRatio:.5}]}),/超出原图/);
});

test('四种工艺只改变Logo像素，不改变布局元数据',async()=>{
  const base=await solid(80,40,{r:240,g:230,b:220,alpha:1});
  const logo=await transparentLogo();
  const result=await renderLogoSet({baseImage:base,logoImage:logo,targets:[{id:'box',x:.5,y:.5,widthRatio:.2,rotation:0}]});
  const layouts=result.outputs.map(v=>JSON.stringify(v.bounds));
  assert.equal(new Set(layouts).size,1);
  const center=await Promise.all(result.outputs.map(async v=>{
    const raw=await sharp(v.bytes).ensureAlpha().raw().toBuffer();
    const i=(20*80+40)*4;
    return [...raw.subarray(i,i+3)];
  }));
  assert.deepEqual(center[0],[255,255,255]);
  assert.deepEqual(center[1],[0,0,0]);
  assert.ok(center[2][0]>center[2][1]&&center[2][1]>center[2][2]);
  assert.ok(center[3][2]>=center[3][1]&&center[3][1]>=center[3][0]);
});

test('ORIGINAL版本使用用户选择的Logo颜色',async()=>{
  const base=await solid(80,40,{r:240,g:230,b:220,alpha:1});
  const logo=await transparentLogo();
  const result=await renderLogoSet({baseImage:base,logoImage:logo,targets:[{id:'box',x:.5,y:.5,widthRatio:.2,rotation:0}],originalColor:'#C54B78'});
  const raw=await sharp(result.outputs[0].bytes).ensureAlpha().raw().toBuffer();
  const pixel=(20*80+40)*4;
  assert.deepEqual([...raw.subarray(pixel,pixel+3)],[197,75,120]);
});

test('ORIGINAL版本允许每个上样目标使用各自的Logo颜色',async()=>{
  const base=await solid(80,40,{r:240,g:230,b:220,alpha:1});
  const logo=await transparentLogo();
  const result=await renderLogoSet({baseImage:base,logoImage:logo,targets:[
    {id:'product',x:.25,y:.5,widthRatio:.1,rotation:0,color:'#C54B78'},
    {id:'box',x:.75,y:.5,widthRatio:.1,rotation:0,color:'#3E9B75'}
  ]});
  const raw=await sharp(result.outputs[0].bytes).ensureAlpha().raw().toBuffer();
  const pixel=(x,y)=>[...raw.subarray((y*80+x)*4,(y*80+x)*4+3)];
  assert.deepEqual(pixel(20,20),[197,75,120]);
  assert.deepEqual(pixel(60,20),[62,155,117]);
});

test('自动对比模式会让深色管身使用白色并让浅色彩盒使用黑色',async()=>{
  const base=await sharp({create:{width:80,height:40,channels:4,background:{r:255,g:255,b:255,alpha:1}}}).composite([
    {input:await sharp({create:{width:16,height:16,channels:4,background:{r:20,g:20,b:20,alpha:1}}}).png().toBuffer(),left:12,top:12}
  ]).png().toBuffer();
  const logo=await transparentLogo();
  const result=await renderLogoSet({baseImage:base,logoImage:logo,targets:[
    {id:'tube',x:.25,y:.5,widthRatio:.2,rotation:0,autoContrast:true},
    {id:'box',x:.75,y:.5,widthRatio:.2,rotation:0,autoContrast:true}
  ]});
  const raw=await sharp(result.outputs[1].bytes).ensureAlpha().raw().toBuffer();
  const pixel=(x,y)=>[...raw.subarray((y*80+x)*4,(y*80+x)*4+3)];
  assert.deepEqual(pixel(20,20),[255,255,255]);
  assert.deepEqual(pixel(60,20),[0,0,0]);
});

test('自动对比不会覆盖烫金和烫银的固定金属颜色',async()=>{
  const base=await solid(80,40,{r:20,g:20,b:20,alpha:1});
  const logo=await transparentLogo();
  const result=await renderLogoSet({baseImage:base,logoImage:logo,targets:[{id:'tube',x:.5,y:.5,widthRatio:.2,rotation:0,autoContrast:true}]});
  const pixel=async output=>{
    const raw=await sharp(output.bytes).ensureAlpha().raw().toBuffer();
    return [...raw.subarray((20*80+40)*4,(20*80+40)*4+3)];
  };
  assert.deepEqual(await pixel(result.outputs[1]),[255,255,255]);
  const gold=await pixel(result.outputs[2]),silver=await pixel(result.outputs[3]);
  assert.ok(gold[0]>gold[1]&&gold[1]>gold[2]);
  assert.ok(silver[2]>=silver[1]&&silver[1]>=silver[0]);
});

test('ORIGINAL保留每个图位选择的颜色，只有BLACK会在深色背景自动变白',async()=>{
  const base=await solid(80,40,{r:20,g:20,b:20,alpha:1});
  const logo=await transparentLogo();
  const result=await renderLogoSet({baseImage:base,logoImage:logo,targets:[{
    id:'tube',x:.5,y:.5,widthRatio:.2,rotation:0,color:'#C54B78',autoContrast:true
  }]});
  const pixel=async output=>{
    const raw=await sharp(output.bytes).ensureAlpha().raw().toBuffer();
    return [...raw.subarray((20*80+40)*4,(20*80+40)*4+3)];
  };
  assert.deepEqual(await pixel(result.outputs[0]),[197,75,120]);
  assert.deepEqual(await pixel(result.outputs[1]),[255,255,255]);
});

test('烫金和烫银在锁定Logo蒙版内带有平滑金属高光，不改变字形',async()=>{
  const base=await solid(80,40,{r:240,g:230,b:220,alpha:1});
  const logo=await transparentLogo();
  const result=await renderLogoSet({baseImage:base,logoImage:logo,targets:[{id:'box',x:.5,y:.5,widthRatio:.2,rotation:0}]});
  const colors=async output=>{
    const raw=await sharp(output.bytes).ensureAlpha().raw().toBuffer();
    const bounds=output.bounds[0],visible=new Set();
    for(let y=bounds.top;y<bounds.top+bounds.height;y++)for(let x=bounds.left;x<bounds.left+bounds.width;x++){
      const offset=(y*80+x)*4;
      visible.add(`${raw[offset]},${raw[offset+1]},${raw[offset+2]}`);
    }
    return visible;
  };
  assert.ok((await colors(result.outputs[2])).size>1);
  assert.ok((await colors(result.outputs[3])).size>1);
  assert.deepEqual(result.outputs[2].bounds,result.outputs[3].bounds);
});

test('烫金会读取每个上样表面的原图明暗，而不是所有位置使用同一亮度',async()=>{
  const black=await solid(40,40,{r:20,g:20,b:20,alpha:1});
  const white=await solid(40,40,{r:245,g:245,b:245,alpha:1});
  const base=await sharp({create:{width:80,height:40,channels:4,background:{r:245,g:245,b:245,alpha:1}}}).composite([{input:black,left:0,top:0},{input:white,left:40,top:0}]).png().toBuffer();
  const logo=await transparentLogo();
  const result=await renderLogoSet({baseImage:base,logoImage:logo,targets:[
    {id:'tube',x:.25,y:.5,widthRatio:.2,rotation:0},
    {id:'box',x:.75,y:.5,widthRatio:.2,rotation:0}
  ]});
  const raw=await sharp(result.outputs[2].bytes).ensureAlpha().raw().toBuffer();
  const pixel=x=>raw[(20*80+x)*4];
  assert.ok(pixel(60)>pixel(20));
});

test('圆管目标在Logo横截面上具有中心更亮、边缘更暗的连续金属反射',async()=>{
  const base=await solid(80,40,{r:90,g:90,b:90,alpha:1});
  const logo=await transparentLogo();
  const result=await renderLogoSet({baseImage:base,logoImage:logo,targets:[{id:'tube',x:.5,y:.5,widthRatio:.2,rotation:0,surface:'cylinder'}]});
  const bounds=result.outputs[2].bounds[0];
  const raw=await sharp(result.outputs[2].bytes).ensureAlpha().raw().toBuffer();
  const red=(x,y)=>raw[(y*80+x)*4];
  const x=bounds.left+Math.floor(bounds.width/2);
  assert.ok(red(x,bounds.top+Math.floor(bounds.height/2))>red(x,bounds.top+1));
});

test('平面目标可使用四点透视边界贴合倾斜彩盒面',async()=>{
  const base=await solid(100,100,{r:240,g:240,b:240,alpha:1});
  const logo=await transparentLogo();
  const result=await renderLogoSet({baseImage:base,logoImage:logo,targets:[{
    id:'box',x:.5,y:.5,widthRatio:.2,rotation:0,surface:'flat',
    quad:[{x:.2,y:.2},{x:.8,y:.3},{x:.7,y:.6},{x:.25,y:.55}]
  }]});
  assert.deepEqual(result.outputs[0].bounds[0],{id:'box',left:20,top:20,width:60,height:40});
});

test('自由光泽参考不要求把上样目标归类为平面或圆管',async()=>{
  const base=await solid(80,40,{r:120,g:100,b:90,alpha:1});
  const logo=await transparentLogo();
  const result=await renderLogoSet({baseImage:base,logoImage:logo,targets:[{id:'cap',x:.5,y:.5,widthRatio:.2,rotation:0,surface:'free'}]});
  assert.equal(result.outputs.length,4);
  assert.equal(result.outputs[2].bounds[0].id,'cap');
});

test('曲面弯曲强度会改变Logo的横向贴面形变但不改变四版本布局',async()=>{
  const base=await solid(120,60,{r:240,g:240,b:240,alpha:1});
  const logo=await narrowMarkLogo();
  const flat=await renderLogoSet({baseImage:base,logoImage:logo,targets:[{id:'tube',x:.5,y:.5,widthRatio:.4,rotation:0,curve:0}]});
  const curved=await renderLogoSet({baseImage:base,logoImage:logo,targets:[{id:'tube',x:.5,y:.5,widthRatio:.4,rotation:0,curve:.9}]});
  assert.equal(new Set(curved.outputs.map(output=>JSON.stringify(output.bounds))).size,1);
  assert.notDeepEqual(curved.outputs[0].bytes,flat.outputs[0].bytes);
});
