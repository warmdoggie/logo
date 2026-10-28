import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
function workspace(width,height){
 const draws=[];let reads=0;
 const context={clearRect(){},drawImage:(...args)=>draws.push(args),getImageData:()=>{reads++;return {data:new Uint8ClampedArray(4)};}};
 const c=vm.createContext({canvas:{getContext:()=>context},baseImage:{naturalWidth:width,naturalHeight:height},logoImage:{},baseData:'full-resolution-original',rebuildingTargets:false,previewBaseImage:null,previewBasePixels:null,previewEmpty:{},syncSchemeState(){},queueSchemeCards(){},taskDraft:{schedule(){}},collectTargets:()=>[]});
 vm.runInContext(source.slice(source.indexOf('function drawPreview(){'),source.indexOf("canvas.addEventListener('pointerdown'")),c);
 return {c,draws,reads:()=>reads};
}

for(const [width,height,wantWidth,wantHeight] of [[3000,3000,1200,1200],[4000,2000,1200,600],[800,400,800,400]])test(`编辑 ${width}×${height} 产品时限制预览像素并保持原图`,()=>{
 const {c,draws}=workspace(width,height);c.drawPreview();
 assert.equal(c.canvas.width,wantWidth);assert.equal(c.canvas.height,wantHeight);
 assert.deepEqual(draws[0].slice(1),[0,0,wantWidth,wantHeight]);assert.equal(c.baseData,'full-resolution-original');assert.equal(c.baseImage.naturalWidth,width);
});

test('拖动或切换 Logo 时复用产品底色采样，切换产品后更新采样',()=>{
 const {c,reads}=workspace(3000,3000);c.drawPreview();c.drawPreview();c.logoImage={};c.drawPreview();assert.equal(reads(),1);
 c.baseImage={naturalWidth:2000,naturalHeight:1000};c.drawPreview();assert.equal(reads(),2);
});
