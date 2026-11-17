import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';
import {renderLogoSet} from './index.mjs';
import {prepareGenerationImage} from './prepared-generation.mjs';
import {preparePlacementLogo} from './placement-logo.mjs';
import {cropLogoForPlacement} from './logo-processing.mjs';

async function fixture(background=0){
  const data=Buffer.alloc(100*80*4,background);
  for(let y=6;y<26;y++)for(let x=8;x<48;x++){
    const i=(y*100+x)*4;
    data.set([20,60,120,255],i);
  }
  // A detached mark belongs to the same logo; its spacing must survive cropping.
  if(!background)data.set([150,30,70,128],(30*100+54)*4);
  return sharp(data,{raw:{width:100,height:80,channels:4}}).png().toBuffer();
}

test('placement preparation crops margins without changing logo colors or background alpha or calling AI',async()=>{
  const server=createDemoServer({aiProcessor:()=>assert.fail('must stay local'),saveLogoToLibrary:()=>assert.fail('must not save')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    for(const [source,preserveLogoDetails] of [[await fixture(),true],[await fixture(255),false]]){
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/prepare-logo`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({logoImage:source.toString('base64'),preserveLogoDetails})});
      assert.equal(response.status,200);
      const output=await response.json();
      const {data,info}=await sharp(Buffer.from(output.dataUrl.split(',')[1],'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      if(preserveLogoDetails){
        assert.deepEqual([info.width,info.height],[51,29]);
        const expected=await sharp(source).extract({left:6,top:4,width:51,height:29}).raw().toBuffer();
        assert.deepEqual(data,expected);
      }else{
        assert.deepEqual([info.width,info.height],[44,24]);
        const expected=await sharp(source).extract({left:6,top:4,width:44,height:24}).raw().toBuffer();
        assert.deepEqual(data,expected);
      }
      assert.deepEqual([output.width,output.height],[info.width,info.height]);
    }
    const source=(await fixture()).toString('base64');
    const logo={logoImage:source,aiRefined:true};
    let calls=0;
    const request=(url,options)=>{calls++;return fetch(`http://127.0.0.1:${server.address().port}${url}`,options);};
    await preparePlacementLogo(logo,request);
    await preparePlacementLogo(logo,request);
    assert.equal(calls,1);
    assert.equal(logo.sourceData,source);
    assert.equal(logo.logoAssetUrl,undefined);
    const meta=await sharp(Buffer.from(logo.logoImage,'base64')).metadata();
    assert.deepEqual([meta.width,meta.height],[51,29]);
    const original=(await fixture(255)).toString('base64');
    const previous={logoImage:original,sourceData:original,placementPrepared:true};
    await preparePlacementLogo(previous,request);
    const restored=await sharp(Buffer.from(previous.logoImage,'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.deepEqual([restored.info.width,restored.info.height],[100,80]);
    assert.equal(calls,1,'unprocessed originals must wait for background removal before cropping');
    for(let i=3;i<restored.data.length;i+=4)assert.equal(restored.data[i],255);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('cropping opaque logos retains interior background and leaves an unrecognizable image available for AI',async()=>{
 const server=createDemoServer({aiProcessor:()=>assert.fail('AI is explicit'),saveLogoToLibrary:()=>assert.fail('must not save')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const raw=Buffer.alloc(100*80*4,255);
  for(let y=6;y<26;y++)for(let x=8;x<48;x++)if(x<14||x>=42||y<10||y>=22)raw.set([20,60,120,255],(y*100+x)*4);
  const source=await sharp(raw,{raw:{width:100,height:80,channels:4}}).png().toBuffer();
  const blank=await sharp({create:{width:30,height:20,channels:4,background:'#fff'}}).png().toBuffer();
  for(const image of [source,blank]){
   const response=await fetch(`http://127.0.0.1:${server.address().port}/api/prepare-logo`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({logoImage:image.toString('base64')})});
   assert.equal(response.status,200);
   const output=await response.json(),pixels=await sharp(Buffer.from(output.dataUrl.split(',')[1],'base64')).raw().toBuffer();
   const expected=image===source?await sharp(source).extract({left:6,top:4,width:44,height:24}).raw().toBuffer():await sharp(blank).raw().toBuffer();
   assert.deepEqual(pixels,expected);
  }
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('transparent crop padding scales with artwork size even when the artwork touches the canvas edge',async()=>{
  for(const [left,top,width,height,expectedSize,padding] of [
    [20,20,100,30,[106,36],3],
    [0,0,20,10,[24,14],2],
    [180,70,20,10,[24,14],2]
  ]){
    const raw=Buffer.alloc(200*80*4);
    for(let y=top;y<top+height;y++)for(let x=left;x<left+width;x++)raw.set([20,60,120,255],(y*200+x)*4);
    const source=await sharp(raw,{raw:{width:200,height:80,channels:4}}).png().toBuffer();
    const output=await cropLogoForPlacement(source),meta=await sharp(output).metadata();
    assert.deepEqual([meta.width,meta.height],expectedSize);
    assert.deepEqual(await sharp(output).extract({left:padding,top:padding,width,height}).raw().toBuffer(),await sharp(source).extract({left,top,width,height}).raw().toBuffer());
    const {data,info}=await sharp(output).raw().toBuffer({resolveWithObject:true});
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(x<padding||y<padding||x>=info.width-padding||y>=info.height-padding)assert.equal(data[(y*info.width+x)*4+3],0);
  }
});

test('transparent padding does not move or shrink logos in any finish, rotation or perspective',async()=>{
  const padded=await fixture(),cropped=await sharp(padded).extract({left:8,top:6,width:47,height:25}).png().toBuffer();
  const base=await sharp({create:{width:240,height:200,channels:4,background:'#ddd'}}).png().toBuffer();
  for(const geometry of [{rotation:0},{rotation:90},{rotation:-32},{quad:[{x:.2,y:.2},{x:.7,y:.25},{x:.65,y:.7},{x:.25,y:.65}]}]){
    const targets=[{id:'manual-position',x:.42,y:.57,widthRatio:.3,preserveOriginalColor:true,...geometry}];
    const actual=await renderLogoSet({baseImage:base,logoImage:padded,targets});
    const expected=await renderLogoSet({baseImage:base,logoImage:cropped,targets});
    for(let i=0;i<actual.outputs.length;i++){
      assert.deepEqual(actual.outputs[i].bounds,expected.outputs[i].bounds);
      assert.deepEqual(actual.outputs[i].bytes,expected.outputs[i].bytes);
      assert.deepEqual(actual.outputs[i].mask,expected.outputs[i].mask);
    }
    assert.deepEqual(targets,[{id:'manual-position',x:.42,y:.57,widthRatio:.3,preserveOriginalColor:true,...geometry}]);
  }
});

test('queued generation uses the visible aspect ratio and the same cropped logo as its guide',async()=>{
  const base=await sharp({create:{width:240,height:200,channels:4,background:'#ddd'}}).png().toBuffer();
  const output=await prepareGenerationImage({baseImage:base,logoImage:await fixture(),targets:[{id:'a',x:.5,y:.5,widthRatio:.3}],selectedVersions:['ORIGINAL']});
  assert.equal(output.input.logoAspectRatio,25/47);
  const meta=await sharp(Buffer.from(output.input.logoImage.split(',')[1],'base64')).metadata();
  assert.deepEqual([meta.width,meta.height],[47,25]);
});
