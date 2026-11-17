import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';
import {preparePlacementLogo} from './placement-logo.mjs';

test('uploading an unprocessed Logo keeps its original canvas until background removal',async()=>{
  const logo={logoImage:'original',sourceData:'original'};
  await preparePlacementLogo(logo,()=>assert.fail('upload must not crop before removing the background'));
  assert.deepEqual(logo,{logoImage:'original',sourceData:'original'});
});

test('Logo processing crops after background removal and edge cleanup, then saves transparent padding',async()=>{
  let saved;
  const server=createDemoServer({aiProcessor:()=>assert.fail('local processing must not call AI'),saveLogoToLibrary:async(_req,bytes)=>{saved=bytes;return {id:'padded'};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    for(const [width,height,left,top,markWidth,markHeight,expectedSize,margin] of [
      [160,100,20,30,100,30,[110,40],4],
      [40,30,0,0,20,10,[25,15],2]
    ]){
      const raw=Buffer.alloc(width*height*4,255);
      for(let y=top;y<top+markHeight;y++)for(let x=left;x<left+markWidth;x++)raw.set([20,60,120,255],(y*width+x)*4);
      // This isolated speck must be removed before it can affect the crop bounds.
      raw.set([20,60,120,255],((height-4)*width+width-4)*4);
      const source=await sharp(raw,{raw:{width,height,channels:4}}).png().toBuffer();
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/process-logo`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({logoImage:source.toString('base64'),targetColor:'original'})});
      assert.equal(response.status,200);
      const payload=await response.json(),output=Buffer.from(payload.dataUrl.split(',')[1],'base64');
      const {data,info}=await sharp(output).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      assert.deepEqual([info.width,info.height],expectedSize);
      assert.deepEqual([payload.width,payload.height],expectedSize);
      let minX=info.width,minY=info.height,maxX=-1,maxY=-1;
      for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]){
        minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
      }
      assert.deepEqual([minX,minY,info.width-1-maxX,info.height-1-maxY],[margin,margin,margin,margin]);
      const center=(Math.floor(info.height/2)*info.width+Math.floor(info.width/2))*4;
      assert.deepEqual([...data.subarray(center,center+4)],[20,60,120,255]);
      assert.deepEqual(saved,output,'the Logo library must retain the padding shown in the preview');
    }
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
