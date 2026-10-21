import test from 'node:test';
import assert from 'node:assert/strict';
import * as previews from './image-preview.mjs';

function viewer(options={}){
 const image={src:'',hidden:true,removeAttribute(){this.src='';}},states=[],dropped=[];
 assert.equal(typeof previews.createImagePreview,'function');
 const preview=previews.createImagePreview({image,request:async()=>({ok:true,blob:async()=>new Blob(['original'])}),loadImage:async()=>{},makeUrl:()=> 'blob:original',dropUrl:url=>dropped.push(url),onStatus:(...status)=>states.push(status),...options});
 return {image,states,dropped,preview};
}

test('large preview immediately shows the decoded thumbnail while the original loads',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);
 const {image,states,preview}=viewer({request:()=>pending});
 const loading=preview.show('/s7/api/image.png','blob:thumbnail');
 assert.equal(image.src,'blob:thumbnail');assert.equal(image.hidden,false);assert.equal(states.at(-1)[0],'loading');
 finish({ok:true,blob:async()=>new Blob(['original'])});await loading;
 assert.equal(image.src,'blob:original');assert.equal(states.at(-1)[0],'ready');
 preview.close();
});

test('failed original requests keep the thumbnail visible and can be retried',async()=>{
 let fail=true;
 const {image,states,preview}=viewer({request:async()=>{if(fail)throw Error('network');return {ok:true,blob:async()=>new Blob(['original'])};}});
 await preview.show('/original.png','blob:thumbnail');
 assert.equal(image.src,'blob:thumbnail');assert.equal(image.hidden,false);assert.equal(states.at(-1)[0],'error');
 fail=false;await preview.show('/original.png','blob:thumbnail');
 assert.equal(image.src,'blob:original');assert.equal(states.at(-1)[0],'ready');preview.close();
});

test('an undecodable original cannot replace the visible thumbnail',async()=>{
 const {image,states,dropped,preview}=viewer({loadImage:async()=>{throw Error('invalid image');}});
 await preview.show('/invalid.png','blob:thumbnail');
 assert.equal(image.src,'blob:thumbnail');assert.equal(states.at(-1)[0],'error');assert.deepEqual(dropped,['blob:original']);preview.close();
});

test('closing or switching a preview cancels pending requests and discards late original images',async()=>{
 let finish,signal;
 const {image,states,dropped,preview}=viewer({request:async(url,options)=>{if(url==='/slow.png'){signal=options.signal;return new Promise(resolve=>finish=resolve);}return {ok:true,blob:async()=>new Blob(['new'])};}});
 const slow=preview.show('/slow.png','blob:old-thumbnail');
 await preview.show('/fast.png','blob:new-thumbnail');assert.equal(signal.aborted,true);
 finish({ok:true,blob:async()=>new Blob(['old'])});await slow;
 assert.equal(image.src,'blob:original');assert.equal(states.filter(state=>state[0]==='ready').length,1);
 preview.close();assert.equal(image.src,'');assert.deepEqual(dropped,['blob:original']);
});

test('HTTP failures show an error without presenting a broken image',async()=>{
 const {image,states,preview}=viewer({request:async()=>({ok:false,status:401})});
 await preview.show('/private.png');assert.equal(image.hidden,true);assert.equal(states.at(-1)[0],'error');preview.close();
});

test('inline generation results use the image decoder without a CSP-blocked fetch',async()=>{
 const src='data:image/png;base64,iVBORw0KGgo=';
 const {image,states,preview}=viewer({request:async()=>{throw Error('inline images must not be fetched');}});
 await preview.show(src);assert.equal(image.src,src);assert.equal(image.hidden,false);assert.equal(states.at(-1)[0],'ready');preview.close();
});
