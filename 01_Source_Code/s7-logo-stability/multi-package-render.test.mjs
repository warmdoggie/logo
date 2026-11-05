import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';
import {buildAiMockupPlan} from './ai-mockup-generation.mjs';
import {createSchemes} from './schemes.mjs';
import {renderLogoSet} from './index.mjs';

async function runBatch(mockupRenderer,request={}){
  const baseImage=await sharp({create:{width:80,height:80,channels:4,background:'#eeeeee'}}).png().toBuffer();
  const logo=await sharp({create:{width:8,height:4,channels:4,background:'#222222'}}).png().toBuffer();
  const products=['a','b'].map(id=>({id,sku:id,name:id,imageBytes:baseImage,template:{id:'template-'+id,version:1,zones:[{id:'zone',zoneType:'logo',x:.3,y:.3,width:.2,height:.1}],automation:{carriers:[{id:'body',type:'BODY'}],areas:[{id:'area',zoneId:'zone',carrierId:'body',foilProcesses:['GOLD FOIL','SILVER FOIL']}],schemes:[]}}}));
  const server=createDemoServer({authenticate:null,productCatalog:async()=>products,productTemplate:async product=>({template:product.template}),mockupRenderer});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/ai-render-multi`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({productIds:['a','b'],logoImage:logo.toString('base64'),model:'flux-3-image',...request})});
    assert.equal(response.status,200);
    return (await response.text()).trim().split('\n\n').map(block=>({event:block.match(/^event: (.+)$/m)[1],data:JSON.parse(block.match(/^data: (.+)$/m)[1])}));
  }finally{await new Promise(resolve=>server.close(resolve));}
}

test('batch loads each master and passes the existing four schemes through guides and AI planning',async()=>{
  let calls=0;
  const events=await runBatch(async input=>{
    calls++;
    assert.equal(buildAiMockupPlan(input).length,4);
    return input.guides.map(guide=>({version:guide.version,bytes:Buffer.from(guide.dataUrl.split(',')[1],'base64')}));
  });
  assert.deepEqual(events.filter(item=>item.event==='product-error'),[]);
  assert.equal(calls,2);
  const results=events.filter(item=>item.event==='product-done');
  assert.equal(results.length,2);
  for(const {data} of results){assert.equal(data.images.length,4);assert.equal(data.complete,true);assert.ok(data.images.every(image=>!image.label.includes('四格图')));}
  assert.equal(events.at(-1).data.completed,2);
});

test('batch reports the actual stage error when no print effect succeeded',async()=>{
  const events=await runBatch(async input=>{
    await input.onStage('ORIGINAL','failed',Error('上游返回 HTTP 503'));
    return [];
  });
  const errors=events.filter(item=>item.event==='product-error');
  assert.equal(errors.length,2);
  assert.match(errors[0].data.error,/上游返回 HTTP 503/);
  assert.equal(events.filter(item=>item.event==='product-done').length,0);
});

test('batch preserves successful images and the failed variant when only part of a product completes',async()=>{
  const events=await runBatch(async input=>{
    await input.onStage('BLACK','failed',Error('测试上游失败'));
    return input.guides.filter(guide=>guide.version!=='BLACK').map(guide=>({version:guide.version,bytes:Buffer.from(guide.dataUrl.split(',')[1],'base64')}));
  });
  const results=events.filter(item=>item.event==='product-done');
  assert.equal(results.length,2);
  assert.equal(results[0].data.complete,false);
  assert.equal(results[0].data.images.length,3);
  assert.deepEqual(results[0].data.failures,[{version:'BLACK',error:'测试上游失败'}]);
  assert.equal(events.at(-1).data.failed,2);
});

test('batch uses each product edited position, size, rotation and independent scheme in every guide and model request',async()=>{
  const productLayouts=['a','b'].map((productId,index)=>{
    const targets=[{id:'master-zone',masterZoneId:'zone',x:.45+index*.15,y:.55,widthRatio:.3,rotation:15,curve:0,surface:'free'}];
    const schemes=createSchemes(targets).schemes;
    schemes[2].targets[0]={...schemes[2].targets[0],x:.35,widthRatio:.4,rotation:-25};
    schemes[2].independentGeometry=true;
    return {productId,targets,schemes};
  });
  let calls=0;
  const events=await runBatch(async input=>{
    const expected=productLayouts[calls++];
    const geometry=targets=>targets.map(({carrierType,printFinish,preserveOriginalColor,...target})=>target);
    assert.deepEqual(geometry(input.targets),expected.targets);
    assert.deepEqual(input.schemes.map(scheme=>({...scheme,targets:geometry(scheme.targets)})),expected.schemes.map(scheme=>({...scheme,targets:geometry(scheme.targets)})));
    assert.ok(input.targets.every(target=>target.carrierType==='BODY'));
    assert.equal(input.schemes.find(scheme=>scheme.version==='GOLD FOIL').targets[0].printFinish,'GOLD FOIL');
    const guides=await renderLogoSet({baseImage:Buffer.from(input.baseImage.split(',')[1],'base64'),logoImage:Buffer.from(input.logoImage.split(',')[1],'base64'),targets:expected.targets,schemes:expected.schemes,originalColor:'#000000'});
    for(const guide of input.guides)assert.deepEqual(Buffer.from(guide.dataUrl.split(',')[1],'base64'),guides.outputs.find(item=>item.version===guide.version).bytes);
    assert.equal(buildAiMockupPlan(input).length,4);
    return input.guides.map(guide=>({version:guide.version,bytes:Buffer.from(guide.dataUrl.split(',')[1],'base64')}));
  },{productLayouts});
  assert.deepEqual(events.filter(item=>item.event==='product-error'),[]);
  assert.equal(calls,2);
});
