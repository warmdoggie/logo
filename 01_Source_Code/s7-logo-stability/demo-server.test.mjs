import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';

async function image(width,height,background){
  return sharp({create:{width,height,channels:4,background}}).png().toBuffer();
}

async function openServer(){
  const server=createDemoServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {server,base:`http://127.0.0.1:${server.address().port}`};
}

test('展示界面提供静态页面并生成四个预览版本',async()=>{
  const {server,base}=await openServer();
  try{
    const page=await fetch(base+'/');
    assert.equal(page.status,200);
    assert.match(await page.text(),/S7 Logo Stability/);
    const baseImage=await image(80,40,{r:240,g:230,b:220,alpha:1});
    const logo=await image(8,4,{r:255,g:255,b:255,alpha:1});
    const response=await fetch(base+'/api/render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({baseImage:baseImage.toString('base64'),logoImage:logo.toString('base64'),targets:[{id:'compact',x:.5,y:.5,widthRatio:.2,rotation:0}]})});
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.equal(payload.outputs.length,4);
    assert.ok(payload.outputs.every(output=>output.dataUrl.startsWith('data:image/png;base64,')));
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('展示界面对非法输入返回可读的400错误',async()=>{
  const {server,base}=await openServer();
  try{
    const response=await fetch(base+'/api/render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({baseImage:'not-image',logoImage:'not-image',targets:[]})});
    assert.equal(response.status,400);
    assert.match((await response.json()).error,/至少需要一个上样目标|图片/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('展示界面可以先加工Logo再用于上样',async()=>{
  const {server,base}=await openServer();
  try{
    const raw=Buffer.alloc(20*12*4,255);
    for(let y=4;y<8;y++)for(let x=7;x<13;x++){const i=(y*20+x)*4;raw[i]=0;raw[i+1]=0;raw[i+2]=0;raw[i+3]=255;}
    const response=await fetch(base+'/api/process-logo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({logoImage:(await sharp(raw,{raw:{width:20,height:12,channels:4}}).png().toBuffer()).toString('base64'),threshold:24})});
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.match(payload.dataUrl,/^data:image\/png;base64,/);
    assert.deepEqual({width:payload.width,height:payload.height},{width:6,height:4});
  }finally{await new Promise(resolve=>server.close(resolve));}
});
