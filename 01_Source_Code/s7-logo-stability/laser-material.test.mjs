import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
import {renderTintedLogoLayer} from './preview-logo-layer.mjs';
import {renderLogoSet} from './index.mjs';
import {preservePrintSurface} from './ai-mockup-provider.mjs';
import * as foil from './foil-finishes.mjs';

const width=160,height=44;
const rainbowReference=()=>sharp(fileURLToPath(new URL('./fixtures/laser-muted-reference.png',import.meta.url))).removeAlpha().raw().toBuffer();
const reference=async()=>(await rainbowReference()).map(value=>Math.round(176+(value-176)*.42));
const data=bytes=>'data:image/png;base64,'+bytes.toString('base64');

test('silver holographic material has restrained spectral color over a neutral silver base',async()=>{
 const original=await rainbowReference();
 let oldChroma=0,newChroma=0,oldLuma=0,newLuma=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*3,old=[...original.subarray(i,i+3)],tone=foil.laserFoilColor((x+.5)/width,(y+.5)/height),rgb=[tone.r,tone.g,tone.b];
  oldChroma+=Math.max(...old)-Math.min(...old);newChroma+=Math.max(...rgb)-Math.min(...rgb);
  oldLuma+=old[0]*.2126+old[1]*.7152+old[2]*.0722;newLuma+=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
 }
 assert.ok(newChroma/oldChroma>.35&&newChroma/oldChroma<.5,'rainbow saturation must be substantially reduced');
 assert.ok(newChroma/(width*height)>12,'retain visible spectral reflections');
 assert.ok(newLuma>oldLuma,'silver base should not become dark gray ink');
});

test('browser laser preview adds the shared foil highlight to muted color without changing alpha',async()=>{
 const expected=await reference(),pixels=new Uint8ClampedArray(width*height*4);
 for(let i=0;i<width*height;i++)pixels[i*4+3]=i%256;
 const originalAlpha=pixels.filter((_,i)=>i%4===3);
 let written;
 const context={drawImage(){},getImageData:()=>({data:pixels}),putImageData:image=>written=image.data,fillRect(){},createLinearGradient:()=>({addColorStop(){}})};
 renderTintedLogoLayer({createCanvas:()=>({width,height,getContext:()=>context}),logoImage:{},width,height,color:'#BFC3C9',finish:'laser'});
 assert.ok(written,'laser preview must render the selected material');
 assert.deepEqual(written.filter((_,i)=>i%4===3),originalAlpha);
 assert.equal(typeof foil.foilBrightness,'function');
 for(let i=0;i<width*height;i++)for(let c=0;c<3;c++){
  const light=foil.foilBrightness(i%width,Math.floor(i/width),width,height)*1.1;
  assert.ok(Math.abs(written[i*4+c]-Math.min(255,expected[i*3+c]*light))<=7,`material mismatch at ${i},${c}`);
 }
 const ratio=(x,y)=>written[(y*width+x)*4]/expected[(y*width+x)*3];
 assert.ok(ratio(56,22)>1.3,'broad reflection must visibly brighten the rainbow');
 assert.ok(ratio(56,22)>ratio(145,22)+.25,'highlight must remain localized');
});

for(const surface of ['flat','cylinder'])test(`final ${surface} laser highlight follows gold placement and surface response with a small brightness lift`,async()=>{
 const expected=await reference();
 const baseImage=await sharp({create:{width:200,height:80,channels:4,background:'#cccccc'}}).png().toBuffer();
 const logoImage=await sharp({create:{width,height,channels:4,background:'#000000'}}).png().toBuffer();
 const target={id:'foil',x:.5,y:.5,widthRatio:.8,surface};
 const [guide]=(await renderLogoSet({baseImage,logoImage,targets:[{...target,printFinish:'LASER FOIL'}],selectedVersions:['LASER FOIL']})).outputs;
 const [gold]=(await renderLogoSet({baseImage,logoImage,targets:[{...target,printFinish:'GOLD FOIL'}],selectedVersions:['GOLD FOIL']})).outputs;
 const goldRaw=await sharp(gold.bytes).ensureAlpha().raw().toBuffer();
 const plan={local:true,version:guide.version,baseImage:data(baseImage),placementGuide:data(guide.bytes),maskImage:data(guide.mask),foilMaskImage:data(guide.foilMask),goldMaskImage:data(guide.goldMask),roseMaskImage:data(guide.roseMask),laserMaskImage:data(guide.laserMask)};
 const output=await preservePrintSurface(plan,baseImage),raw=await sharp(output).ensureAlpha().raw().toBuffer();
 const light=.83+.16*204/255;
 const differences=[[],[],[]];
 for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++)for(let c=0;c<3;c++){
  const offset=((y+18)*200+x+20)*4,sharedLight=goldRaw[offset+1]/160;
  const toneLight=foil.foilBrightness(x,y,width,height);
  const highlighted=Math.min(255,expected[(y*width+x)*3+c]*toneLight*1.1);
  const actual=raw[offset+c],wanted=Math.min(255,highlighted*sharedLight/toneLight)*light;
  differences[c].push(actual-wanted);
 }
 for(const channel of differences){
  const mean=channel.reduce((sum,v)=>sum+v,0)/channel.length;
  assert.ok(Math.abs(mean)<2,'foil grain must preserve the accepted broad color and brightness');
 }
 assert.deepEqual(await preservePrintSurface(plan,baseImage),output);
});
