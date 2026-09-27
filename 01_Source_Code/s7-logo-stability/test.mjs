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
  assert.deepEqual(center[2],[196,160,82]);
  assert.deepEqual(center[3],[191,195,201]);
});
