import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chooseContrastColor} from './contrast-color.mjs';
import sharp from 'sharp';
import {renderLogoSet} from './index.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

function paddedLogoFixture(vertical=true){
  const data=new Uint8Array(100*100*4),logo={data:new Uint8Array(60*60*4),width:60,height:60};
  for(let y=0;y<100;y++)for(let x=0;x<100;x++){
    const offset=(y*100+x)*4,value=vertical?(x>=45&&x<55&&y>=20&&y<80?20:240):(y>=45&&y<55&&x>=20&&x<80?20:240);
    data.set([value,value,value,255],offset);
  }
  for(let y=28;y<32;y++)for(let x=10;x<50;x++)logo.data.set([150,0,200,255],(y*60+x)*4);
  return {data,width:100,height:100,left:20,top:20,boxWidth:60,boxHeight:60,logo};
}

test('透明留白不参与自动配色，只采样 Logo 实际字形下方的表面',()=>{
  assert.equal(chooseContrastColor(paddedLogoFixture(false)),'#FFFFFF');
});

test('竖排 Logo 旋转后按实际字形位置采样，不被两侧浅色背景干扰',()=>{
  assert.equal(chooseContrastColor({...paddedLogoFixture(),rotation:90}),'#FFFFFF');
  assert.equal(chooseContrastColor({...paddedLogoFixture(),rotation:0}),'#000000');
});

test('四点 Logo 使用透视区域中的字形位置，忽略旧的矩形取色区域',()=>{
  assert.equal(chooseContrastColor({...paddedLogoFixture(),left:0,top:0,quad:[{x:.8,y:.2},{x:.8,y:.8},{x:.2,y:.8},{x:.2,y:.2}]}),'#FFFFFF');
});

test('实际黑白成图中，深色笔杆上的带透明留白竖排 Logo 输出白色',async()=>{
  const fixture=paddedLogoFixture(),baseImage=await sharp(fixture.data,{raw:{width:100,height:100,channels:4}}).png().toBuffer();
  const logoImage=await sharp(fixture.logo.data,{raw:{width:60,height:60,channels:4}}).png().toBuffer();
  const result=await renderLogoSet({baseImage,logoImage,targets:[{id:'pen',x:.5,y:.5,widthRatio:.6,rotation:90,autoContrast:true}],selectedVersions:['BLACK']});
  const pixels=await sharp(result.outputs[0].bytes).ensureAlpha().raw().toBuffer();
  assert.deepEqual([...pixels.subarray((50*100+50)*4,(50*100+50)*4+3)],[255,255,255]);
});

test('曲面弯曲后的字形按变形后的落点取色，实际成图在深色表面输出白色',async()=>{
  const data=new Uint8Array(200*100*4),logo={data:new Uint8Array(200*100*4),width:200,height:100};
  for(let y=0;y<100;y++)for(let x=0;x<200;x++){const value=x>=38&&x<50?20:240;data.set([value,value,value,255],(y*200+x)*4);}
  for(let y=40;y<60;y++)for(let x=40;x<45;x++)logo.data.set([0,0,0,255],(y*200+x)*4);
  assert.equal(chooseContrastColor({data,width:200,height:100,left:20,top:10,boxWidth:160,boxHeight:80,logo,curve:1}),'#FFFFFF');
  const baseImage=await sharp(data,{raw:{width:200,height:100,channels:4}}).png().toBuffer(),logoImage=await sharp(logo.data,{raw:{width:200,height:100,channels:4}}).png().toBuffer();
  const result=await renderLogoSet({baseImage,logoImage,targets:[{id:'curved',x:.22,y:.5,widthRatio:.04,curve:1,autoContrast:true}],selectedVersions:['BLACK']});
  const pixels=await sharp(result.outputs[0].bytes).ensureAlpha().raw().toBuffer();
  let white=0;for(let y=35;y<65;y++)for(let x=38;x<50;x++)if(pixels[(y*200+x)*4]>240)white++;
  assert.ok(white>0,'弯曲后的 Logo 应在深色带上显示白色字形');
});

for(const kind of ['canvas','thumbnail'])test(`${kind} 预览与成图一样，按旋转后的字形底色选择白色`,async()=>{
  const source=await readFile(new URL('./demo.js',import.meta.url),'utf8'),fixture=paddedLogoFixture(),colors=[];
  const context={clearRect(){},drawImage(){},getImageData:()=>({data:fixture.data}),save(){},restore(){},translate(){},rotate(){}};
  const canvas={width:100,height:100,getContext:()=>context},target={id:'pen',x:.5,y:.5,widthRatio:.6,rotation:90,autoContrast:true};
  const c=vm.createContext({canvas,baseImage:{naturalWidth:100,naturalHeight:100},logoImage:{naturalWidth:60,naturalHeight:60},previewBaseImage:null,previewBasePixels:null,rebuildingTargets:false,activeScheme:'BLACK',previewEmpty:{},selectedTargetId:null,collectTargets:()=>[target],targetRect:()=>({left:20,top:20,width:60,height:60}),syncSchemeState(){},queueSchemeCards(){},taskDraft:{schedule(){}},isTargetSelected:()=>false,
    chooseContrastColor,logoContrastPixels:()=>fixture.logo,resolveTargetPrint:(await import('./target-print.mjs')).resolveTargetPrint,renderTintedLogoLayer:options=>{colors.push(options.color);return {};},curvePreviewLogo:layer=>layer,
    loadedMultiProductId:'a',schemeSignature:()=>'',schemeThumbnails:new Map(),document:{querySelector:()=>({value:'BLACK'}),createElement:()=>({getContext:()=>context})}});
  if(kind==='canvas'){
    vm.runInContext(source.slice(source.indexOf('function drawPreview(){'),source.indexOf("canvas.addEventListener('pointerdown'")),c);c.drawPreview();
  }else{
    vm.runInContext(source.slice(source.indexOf('function drawSchemeThumbnail('),source.indexOf('function taskDownloadOutputs(')),c);c.drawSchemeThumbnail(canvas,{version:'BLACK',targets:[target]});
  }
  assert.deepEqual(colors,['#FFFFFF']);
});

test('深色图位自动选择白色 Logo',()=>{
  const data=Uint8Array.from([20,20,20,255,20,20,20,255,20,20,20,255,20,20,20,255]);
  assert.equal(chooseContrastColor({data,width:2,height:2}), '#FFFFFF');
});

test('浅色图位自动选择黑色 Logo',()=>{
  const data=Uint8Array.from([240,240,240,255,240,240,240,255,240,240,240,255,240,240,240,255]);
  assert.equal(chooseContrastColor({data,width:2,height:2}), '#000000');
});
