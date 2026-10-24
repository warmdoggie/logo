import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeRegions,restoreOutsideRegions,createCleanupProvider} from './provider.mjs';

const image=(width,height,color)=>sharp({create:{width,height,channels:4,background:color}}).png().toBuffer();

test('only selected pixels change, including when provider changes the whole image',async()=>{
  const original=await image(10,8,'#123456'),generated=await image(10,8,'#abcdef');
  const bytes=await restoreOutsideRegions(original,generated,[{x:.2,y:.25,width:.3,height:.5}]);
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,10);assert.equal(info.height,8);
  for(let y=0;y<8;y++)for(let x=0;x<10;x++)assert.deepEqual([...data.subarray((y*10+x)*4,(y*10+x)*4+4)],x>=2&&x<5&&y>=2&&y<6?[171,205,239,255]:[18,52,86,255]);
});

test('out-of-bounds and oversized regions cannot silently edit protected content',()=>{
  for(const regions of [[{x:-.1,y:0,width:.2,height:.1}],[{x:0,y:0,width:1,height:1}],[{x:.9,y:.1,width:.2,height:.1}],[],[{x:0,y:0,width:NaN,height:.1}]])assert.throws(()=>normalizeRegions(regions));
  assert.deepEqual(normalizeRegions([{x:.2,y:.2,width:.1,height:.3,text:'YOUR LOGO'}]),[{x:.2,y:.2,width:.1,height:.3,text:'YOUR LOGO'}]);
});

test('provider dimensions cannot warp the source composition',async()=>{
  await assert.rejects(restoreOutsideRegions(await image(20,10,'red'),await image(10,20,'blue'),[{x:0,y:0,width:.1,height:.2}]),/比例/);
});

test('repair borders match the original material tone without changing pixels outside the box',async()=>{
  const background=await image(40,40,'#646464');
  const source=await sharp(background).composite([{input:await image(4,4,'black'),left:8,top:8}]).png().toBuffer();
  const result=await restoreOutsideRegions(source,await image(40,40,'#787878'),[{x:.1,y:.1,width:.3,height:.3}],{blend:true});
  const pixels=await sharp(result).ensureAlpha().raw().toBuffer();
  assert.deepEqual([...pixels.subarray((10*40+10)*4,(10*40+10)*4+4)],[100,100,100,255]);
  assert.deepEqual([...pixels.subarray(0,4)],[100,100,100,255]);
});

test('white lettering touching a repair border is not pasted back into a clean AI result',async()=>{
  const background=await image(40,40,'#202020');
  const source=await sharp(background).composite([{input:await image(2,10,'white'),left:10,top:12}]).png().toBuffer();
  const regions=[{x:.25,y:.25,width:.3,height:.4}];
  const result=await restoreOutsideRegions(source,background,regions,{blend:true});
  const raw=await sharp(result).ensureAlpha().raw().toBuffer();
  for(const [x,y] of [[10,15],[11,15],[15,15],[9,15]])assert.deepEqual([...raw.subarray((y*40+x)*4,(y*40+x)*4+4)],[32,32,32,255]);
});

test('missing color samples at image edges or adjacent selections do not introduce shading',async()=>{
  const source=await image(40,40,'#646464'),generated=await image(40,40,'#787878');
  for(const regions of [
    [{x:0,y:.2,width:.2,height:.2}],
    [{x:0,y:0,width:.1,height:1}],
    [{x:.2,y:.2,width:.2,height:.2},{x:.4,y:.2,width:.2,height:.2}]
  ]){
    const result=await restoreOutsideRegions(source,generated,regions,{blend:true});
    const raw=await sharp(result).ensureAlpha().raw().toBuffer();
    for(let i=0;i<raw.length;i+=4)assert.deepEqual([...raw.subarray(i,i+4)],[100,100,100,255]);
  }
});

test('spatial color drift follows the original curved shading without a rectangular color patch',async()=>{
  const width=100,height=100,clean=Buffer.alloc(width*height*4),changed=Buffer.alloc(clean.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const offset=(y*width+x)*4,drift=20*Math.sin(x*Math.PI/50)+20*Math.cos(y*Math.PI/50);
    for(let c=0;c<3;c++){clean[offset+c]=Math.round(70+c*20+x*.3+y*.2);changed[offset+c]=Math.round(clean[offset+c]+drift);}
    clean[offset+3]=changed[offset+3]=255;
  }
  const source=Buffer.from(clean);
  for(let y=40;y<45;y++)for(let x=38;x<43;x++)for(let c=0;c<3;c++)source[(y*width+x)*4+c]=255;
  const png=raw=>sharp(raw,{raw:{width,height,channels:4}}).png().toBuffer();
  const result=await restoreOutsideRegions(await png(source),await png(changed),[{x:.3,y:.2,width:.2,height:.5}],{blend:true});
  const raw=await sharp(result).ensureAlpha().raw().toBuffer();
  let maxError=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++){
    const offset=(y*width+x)*4+c;
    if(x>=30&&x<50&&y>=20&&y<70)maxError=Math.max(maxError,Math.abs(raw[offset]-clean[offset]));
    else assert.equal(raw[offset],source[offset]);
  }
  assert.ok(maxError<=2,`maximum channel error: ${maxError}`);
});

test('a coarse text box preserves clean product pixels inside the box instead of replacing a rectangle',async()=>{
  const width=100,height=100,clean=Buffer.alloc(width*height*4),generated=Buffer.alloc(clean.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const offset=(y*width+x)*4;
    for(let c=0;c<3;c++){
      clean[offset+c]=80+c*20;
      generated[offset+c]=80+c*20+(x>=30&&x<70&&y>=30&&y<60?12:0);
    }
    clean[offset+3]=generated[offset+3]=255;
  }
  const source=Buffer.from(clean);
  for(let y=40;y<45;y++)for(let x=45;x<50;x++)for(let c=0;c<3;c++)source[(y*width+x)*4+c]=255;
  for(let c=0;c<3;c++)source[(42*width+39)*4+c]+=12;
  const png=raw=>sharp(raw,{raw:{width,height,channels:4}}).png().toBuffer();
  const result=await restoreOutsideRegions(await png(source),await png(generated),[{x:.3,y:.3,width:.4,height:.3}],{blend:true});
  const raw=await sharp(result).ensureAlpha().raw().toBuffer();
  for(const [x,y] of [[32,35],[65,55],[45,42],[39,42]]){
    const offset=(y*width+x)*4;
    assert.deepEqual([...raw.subarray(offset,offset+4)],[80,100,120,255]);
  }
});

test('white letters over a product highlight are removed along with higher contrast letters',async()=>{
  const width=100,height=100,clean=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,value=Math.min(250,Math.round(100+1.8*x));clean.set([value,value,value,255],i);
  }
  const source=Buffer.from(clean);
  for(const left of [30,75])for(let y=42;y<48;y++)for(let x=left;x<left+4;x++)for(let c=0;c<3;c++)source[(y*width+x)*4+c]=255;
  const png=raw=>sharp(raw,{raw:{width,height,channels:4}}).png().toBuffer();
  const bytes=await restoreOutsideRegions(await png(source),await png(clean),[{x:.2,y:.35,width:.6,height:.2}],{blend:true});
  const raw=await sharp(bytes).ensureAlpha().raw().toBuffer();
  for(const [x,want] of [[31,156],[77,239]])assert.equal(raw[(44*width+x)*4],want);
});

test('image-only API keys submit an alpha inpainting mask and restore protected pixels',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cleanup-provider-'));
  try{
    const configPath=join(dir,'config.json');
    await writeFile(configPath,JSON.stringify({provider:'APIMART',endpoint:'https://api.apimart.ai',apiKey:'test-only',model:'flux-3-image',mockupModels:['flux-3-image','gpt-image-2.5-flare']}));
    const source=await sharp(await image(100,100,'#123456')).composite([{input:await image(4,4,'black'),left:24,top:34}]).png().toBuffer(),generated=await image(100,100,'#abcdef');
    let editRequest;
    const provider=createCleanupProvider({configPath,pollIntervalMs:0,transport:async(url,options)=>{
      if(String(url).endsWith('/v1/images/generations')){editRequest=JSON.parse(options.body);return Response.json({data:[{task_id:'cleanup-task'}]});}
      if(String(url).includes('/v1/tasks/'))return Response.json({data:{status:'completed',result:{images:[{url:['https://getapib.org/cleanup.png']}]}}});
      assert.equal(String(url),'https://getapib.org/cleanup.png');return new Response(generated);
    }});
    const regions=[{x:.2,y:.3,width:.2,height:.1}];
    const result=await provider.remove(source,regions);
    assert.equal(editRequest.model,'gpt-image-2.5-flare');
    assert.match(editRequest.prompt,/Private Label/);
    const mask=await sharp(Buffer.from(editRequest.mask_url.split(',')[1],'base64')).ensureAlpha().raw().toBuffer();
    assert.equal(mask[(35*100+25)*4+3],0);
    assert.equal(mask[3],255);
    const raw=await sharp(result).ensureAlpha().raw().toBuffer();
    assert.deepEqual([...raw.subarray(0,4)],[18,52,86,255]);
    assert.deepEqual([...raw.subarray((35*100+25)*4,(35*100+25)*4+4)],[18,52,86,255]);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('invalid generated image clears the remote checkpoint so retry can regenerate',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cleanup-retry-'));
  try{
    const configPath=join(dir,'config.json');await writeFile(configPath,JSON.stringify({provider:'APIMART',endpoint:'https://api.apimart.ai',apiKey:'test-only'}));
    let submissions=0,remote;
    const generated=await image(100,200,'white'),provider=createCleanupProvider({configPath,pollIntervalMs:0,transport:async url=>{
      if(String(url).endsWith('/v1/images/generations')){submissions++;return Response.json({data:[{url:'https://getapib.org/invalid.png'}]});}
      return new Response(generated);
    }});
    for(let i=0;i<2;i++)await assert.rejects(provider.remove(await image(200,100,'white'),[{x:.2,y:.2,width:.1,height:.1}],{resume:remote,onCheckpoint:value=>{remote=value;}}),/比例/);
    assert.equal(submissions,2);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('terminal missing, malformed or disallowed image URLs clear checkpoints so retry can regenerate',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cleanup-invalid-url-'));
  try{
    const configPath=join(dir,'config.json');await writeFile(configPath,JSON.stringify({provider:'APIMART',endpoint:'https://api.apimart.ai',apiKey:'test-only'}));
    for(const invalid of [undefined,'','   ','not-a-url','https://invalid.example/image.png']){
      let remote,submissions=0,polls=0;
      const provider=createCleanupProvider({configPath,pollIntervalMs:0,transport:async url=>{
        if(String(url).endsWith('/v1/images/generations')){submissions++;polls=0;return Response.json({data:[{task_id:'invalid-image-task'}]});}
        if(++polls>1)throw Error('completed task was polled again');
        return Response.json({data:{status:'completed',result:{images:[{url:invalid}]}}});
      }});
      for(let i=0;i<2;i++){
        await assert.rejects(provider.remove(await image(100,100,'white'),[{x:.2,y:.2,width:.1,height:.1}],{resume:remote,onCheckpoint:value=>{remote=value;}}));
        assert.equal(remote,null);
      }
      assert.equal(submissions,2);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

