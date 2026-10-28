import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {schemeSignature} from './schemes.mjs';

const source=await readFile(new URL('./demo.js',import.meta.url),'utf8');
function workspace(){
 let renders=0;
 const context={drawImage(){},getImageData:()=>({data:[]}),save(){},translate(){},rotate(){},restore(){}};
 const canvas=()=>({width:0,height:0,getContext:()=>context});
 const c=vm.createContext({baseImage:{naturalWidth:1200,naturalHeight:600},logoImage:{naturalWidth:100,naturalHeight:50},loadedMultiProductId:'a',schemeThumbnails:new Map(),schemeSignature,document:{createElement:canvas},chooseContrastColor:()=> '#000000',resolveTargetPrint:()=>({color:'#000000'}),renderTintedLogoLayer:()=>{renders++;return canvas();},curvePreviewLogo:layer=>layer,drawQuadPreview(){}});
 vm.runInContext(source.slice(source.indexOf('function drawSchemeThumbnail('),source.indexOf('function taskDownloadOutputs(')),c);
 return {c,canvas,renders:()=>renders};
}
const scheme={version:'ORIGINAL',targets:[{id:'body',x:.5,y:.5,widthRatio:.2,color:'#000000'}]};

test('切回已预览产品时复用方案图，修改位置、Logo 或产品图后重新绘制',()=>{
 const {c,canvas,renders}=workspace(),first=c.baseImage;
 c.drawSchemeThumbnail(canvas(),scheme);c.loadedMultiProductId='b';c.baseImage={...first};c.drawSchemeThumbnail(canvas(),scheme);
 c.loadedMultiProductId='a';c.baseImage=first;c.drawSchemeThumbnail(canvas(),structuredClone(scheme));assert.equal(renders(),2);
 const edited=structuredClone(scheme);edited.targets[0].x=.7;c.drawSchemeThumbnail(canvas(),edited);assert.equal(renders(),3);
 c.logoImage={...c.logoImage};c.drawSchemeThumbnail(canvas(),edited);assert.equal(renders(),4);
 c.baseImage={...first};c.drawSchemeThumbnail(canvas(),edited);assert.equal(renders(),5);
});

test('方案图缓存限制数量，竖图缩略图也限制最长边',()=>{
 const {c,canvas,renders}=workspace();c.baseImage={naturalWidth:600,naturalHeight:2400};
 const thumbnail=canvas();c.drawSchemeThumbnail(thumbnail,scheme);assert.equal(thumbnail.width,192);assert.equal(thumbnail.height,768);
 for(let n=1;n<=8;n++){c.loadedMultiProductId=String(n);c.drawSchemeThumbnail(canvas(),scheme);}
 c.loadedMultiProductId='a';c.drawSchemeThumbnail(canvas(),scheme);assert.equal(renders(),10);
});
