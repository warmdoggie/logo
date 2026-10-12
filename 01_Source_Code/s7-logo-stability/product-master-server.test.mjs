import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';

async function image(){
  return sharp({create:{width:16,height:10,channels:4,background:{r:230,g:220,b:210,alpha:1}}}).png().toBuffer();
}

async function openServer(options={}){
  const server=createDemoServer(options);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {server,base:`http://127.0.0.1:${server.address().port}`};
}

test('product library exposes a master template endpoint for each product',async()=>{
  const {server,base}=await openServer({productCatalog:async()=>[{
    id:'product-1',sku:'F0083',name:'包装',category:'脸部',status:'ACTIVE',standardImage:'product.png',imageBytes:await image(),currentVersion:3,
    template:{version:3,standardImage:'product.png',zones:[{id:'zone-1',zoneType:'logo',x:.2,y:.2,width:.4,height:.2,defaultAnchorX:.4,defaultAnchorY:.3,maxLogoWidthRatio:.7,defaultRotation:12}]}
  }]});
  try{
    const catalog=await fetch(base+'/api/product-library').then(response=>response.json());
    assert.equal(catalog[0].hasMaster,true);
    assert.equal(catalog[0].templateVersion,3);
    const response=await fetch(base+catalog[0].templateUrl);
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.equal(payload.template.version,3);
    assert.equal(payload.template.zones[0].id,'zone-1');
    const script=await fetch(base+'/demo.js').then(result=>result.text());
    assert.match(script,/masterTargetsFromTemplate/);
    assert.match(script,/masterLocked/);
    assert.match(script,/dragTarget=targetAt\(normalized\)/);
    assert.doesNotMatch(script,/dragTarget\.masterLocked&&dragMode!==['"]scale['"]/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
