import {test} from 'node:test';import assert from 'node:assert/strict';
import {sharp} from './logo-pixels.mjs';import {recolorSurfaces,normalizeSurfaceMask} from './surface-colors.mjs';import {labelDelivery} from './delivery-labels.mjs';
const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}],mask={regions:[{mode:'INCLUDE',points:rect(.1,.1,.8,.8)},{mode:'EXCLUDE',points:rect(.4,.4,.2,.2)}],reviewed:true,reviewNote:'已排除中间文字'};
test('底色蒙版：边界/排除像素/透明度保护、光影差异、重叠与未复核拒绝',async()=>{
 const raw=Buffer.alloc(20*20*4);for(let y=0;y<20;y++)for(let x=0;x<20;x++){const i=(y*20+x)*4;raw[i]=raw[i+1]=raw[i+2]=70+y*5;raw[i+3]=(x===10&&y===10)?128:255;}
 const bytes=await sharp(raw,{raw:{width:20,height:20,channels:4}}).png().toBuffer(),c=[{id:'body',name:'本体',surfaceMask:mask}],s=[{carrierId:'body',surfaceColor:'#b04020'}];
 const result=await recolorSurfaces(bytes,c,s),after=await sharp(result.bytes).raw().toBuffer();
 for(let y=0;y<20;y++)for(let x=0;x<20;x++){const i=(y*20+x)*4;assert.equal(after[i+3],raw[i+3]);if(x<2||x>=18||y<2||y>=18||(x>=8&&x<12&&y>=8&&y<12))assert.deepEqual(after.subarray(i,i+4),raw.subarray(i,i+4));}
 assert.notEqual(after[(3*20+3)*4],after[(15*20+3)*4]);assert.deepEqual((await recolorSurfaces(bytes,c,[])).bytes,bytes);
 await assert.rejects(recolorSurfaces(bytes,[{...c[0],surfaceMask:{...mask,reviewed:false}}],s),/复核/);
 await assert.rejects(recolorSurfaces(bytes,[...c,{...c[0],id:'carton'}],[...s,{carrierId:'carton',surfaceColor:'#112233'}]),/重叠/);
 assert.throws(()=>normalizeSurfaceMask({...mask,reviewNote:''}),/复核说明/);assert.throws(()=>normalizeSurfaceMask({...mask,regions:[{mode:'INCLUDE',points:[{x:0,y:0},{x:1,y:1},{x:0,y:1},{x:1,y:0}]}]}),/交叉/);
 await assert.rejects(recolorSurfaces(bytes,[{...c[0],surfaceMask:{...mask,regions:[{mode:'INCLUDE',points:rect(.1,.1,.2,.2)},{mode:'EXCLUDE',points:rect(0,0,1,1)}]}}],s),/有效像素/);
});
test('交付标签：追加页脚、原图像素保持、长字段与特殊字符可导出',async()=>{
 const raw=Buffer.from([20,30,40,0,5,6,7,128,150,200,250,255,0,0,0,255]),bytes=await sharp(raw,{raw:{width:2,height:2,channels:4}}).png().toBuffer();
 const output={id:'output-id',version:2,snapshot:{sku:'A<&'+ '1234567890'.repeat(20),schemeId:'A',requirementVersion:2,surfaceChanges:[{}]}};
 const result=await labelDelivery(bytes,output),decoded=await sharp(result).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(decoded.info.width,800);assert.ok(decoded.info.height>2);
 for(let y=0;y<2;y++)assert.deepEqual(decoded.data.subarray(y*800*4,y*800*4+8),raw.subarray(y*8,y*8+8));
 assert.ok(decoded.data.some((v,i)=>i>800*2*4&&i%4===0&&v<100),'页脚文字必须实际渲染');
});
