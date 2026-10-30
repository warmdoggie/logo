import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {lockOutsideLogo} from './mockup-lock.mjs';

async function printFixture(color){
 const width=64,height=32,base=Buffer.alloc(width*height*4),guide=Buffer.alloc(base.length),mask=Buffer.alloc(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,k=i*4,luma=Math.round(65+x/63*175)+((x+y)%2?1:-1),inside=x>=8&&x<56&&y>=8&&y<24&&!(x>=30&&x<34&&y>=12&&y<20);
  base.set([luma,luma,luma,255],k);guide.set(inside?[...color,255]:[luma,luma,luma,255],k);mask[i]=inside?255:0;
 }
 const encode=(data,channels)=>sharp(data,{raw:{width,height,channels}}).png().toBuffer();
 return {width,height,rawBase:base,rawMask:mask,baseImage:await encode(base,4),guideImage:await encode(guide,4),maskImage:await encode(mask,1)};
}

test('black screen print retains deep ink with restrained surface highlights and unchanged cutouts',async()=>{
 const f=await printFixture([0,0,0]);
 const result=await lockOutsideLogo({...f,generatedImage:f.baseImage,feather:0,surfaceResponse:true});
 const raw=await sharp(result).ensureAlpha().raw().toBuffer();
 const pixel=(x,y)=>raw[(y*f.width+x)*4];
 assert.ok(pixel(50,16)>pixel(12,16)+3,'原图亮部应有柔和油墨反光');
 for(let i=0;i<f.rawMask.length;i++)if(f.rawMask[i]){assert.ok(raw[i*4]>0&&raw[i*4]<=22,'保留深黑墨色，不变成灰色金属');}
 else assert.deepEqual(raw.subarray(i*4,i*4+4),f.rawBase.subarray(i*4,i*4+4));
 const repeated=await lockOutsideLogo({...f,generatedImage:f.baseImage,feather:0,surfaceResponse:true});assert.deepEqual(result,repeated);
});

test('silver rejects exaggerated AI bevel lighting while controlling its own thin-layer relief',async()=>{
 const f=await printFixture([191,195,201]),generated=Buffer.alloc(f.rawBase.length);
 for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){
  const edge=x===8||x===55||y===8||y===23;generated.set(edge?[255,255,255,255]:[15,15,15,255],(y*f.width+x)*4);
 }
 const hostile=await sharp(generated,{raw:{width:f.width,height:f.height,channels:4}}).png().toBuffer();
 const options={...f,feather:0,surfaceResponse:true,foilMaskImage:f.maskImage,foilFinish:'silver'};
 const result=await lockOutsideLogo({...options,generatedImage:hostile});
 const plain=await lockOutsideLogo({...options,generatedImage:f.baseImage});
 assert.deepEqual(result,plain,'AI 生成的字边高光、暗边不能进入银箔结果');
 const raw=await sharp(result).ensureAlpha().raw().toBuffer();
 const columnMean=x=>Array.from({length:16},(_,y)=>raw[((y+8)*f.width+x)*4]).reduce((sum,value)=>sum+value)/16;
 assert.ok(Math.abs(columnMean(8)-columnMean(9))<=26,'只允许极细压合边缘，不能出现厚重凸字亮边');
 const samples=[];for(let x=10;x<27;x++)samples.push(raw[(16*f.width+x)*4]);assert.ok(new Set(samples).size>2,'箔面仍保留柔和变化');
 for(let i=0;i<f.rawMask.length;i++)if(!f.rawMask[i])assert.deepEqual(raw.subarray(i*4,i*4+4),f.rawBase.subarray(i*4,i*4+4));
});

test('silver retains fine foil grain in midtones and bright reflections without white plateaus',async()=>{
 for(const color of [[191,195,201],[255,255,255]]){
  const f=await printFixture(color);
  const baseImage=await sharp({create:{width:f.width,height:f.height,channels:4,background:'#d8b2a0'}}).png().toBuffer();
  const result=await lockOutsideLogo({...f,baseImage,generatedImage:baseImage,feather:0,surfaceResponse:true,foilMaskImage:f.maskImage,foilFinish:'silver'});
  const raw=await sharp(result).ensureAlpha().raw().toBuffer(),samples=[];
  for(let y=10;y<16;y++)for(let x=12;x<26;x++)samples.push(raw[(y*f.width+x)*4]);
  const mean=samples.reduce((sum,value)=>sum+value)/samples.length;
  const deviation=Math.sqrt(samples.reduce((sum,value)=>sum+(value-mean)**2,0)/samples.length);
  assert.ok(deviation>=2&&deviation<=9,'亮部和中间调都保留克制的细密箔纹');
  assert.ok(Math.max(...samples)<=253,'银白高光不能成为纯白色块');
  if(color[0]===255)assert.ok(mean>=240,'亮部应保留银白反射，不能整体压成磨砂灰');
  const repeated=await lockOutsideLogo({...f,baseImage,generatedImage:baseImage,feather:0,surfaceResponse:true,foilMaskImage:f.maskImage,foilFinish:'silver'});
  assert.deepEqual(result,repeated,'箔纹在相同位置稳定显示');
 }
});

test('silver highlights stay visible against white packaging without losing foil texture',async()=>{
 for(const luma of [235,248,255])for(const color of [[191,195,201],[255,255,255]]){
  const f=await printFixture(color);
  const baseImage=await sharp({create:{width:f.width,height:f.height,channels:4,background:{r:luma,g:luma,b:luma,alpha:1}}}).png().toBuffer();
  const raw=await sharp(await lockOutsideLogo({...f,baseImage,generatedImage:baseImage,feather:0,surfaceResponse:true,foilMaskImage:f.maskImage,foilFinish:'silver'})).ensureAlpha().raw().toBuffer();
  const samples=[];
  for(let i=0;i<f.rawMask.length;i++){
   if(!f.rawMask[i]){assert.deepEqual([...raw.subarray(i*4,i*4+4)],[luma,luma,luma,255]);continue;}
   assert.ok(Math.max(...raw.subarray(i*4,i*4+3))<=luma-16,`银箔亮部不能融进亮度为 ${luma} 的白色包材`);
  }
  for(let y=10;y<16;y++)for(let x=12;x<26;x++)samples.push(raw[(y*f.width+x)*4]);
  const mean=samples.reduce((sum,value)=>sum+value)/samples.length;
  const deviation=Math.sqrt(samples.reduce((sum,value)=>sum+(value-mean)**2,0)/samples.length);
  assert.ok(mean>=155,'浅底上的银箔仍应保留金属亮度');
  assert.ok(deviation>=1.5&&new Set(samples).size>=8,`控制高光后仍须保留细密箔纹，不能裁成均匀灰块：底色 ${luma}，银色 ${color}，标准差 ${deviation}，灰阶数 ${new Set(samples).size}`);
 }
});

test('silver has a thin bonded edge and clustered foil variation within its original mask',async()=>{
 const f=await printFixture([191,195,201]);
 const baseImage=await sharp({create:{width:f.width,height:f.height,channels:4,background:'#bda39a'}}).png().toBuffer();
 const output=await lockOutsideLogo({...f,baseImage,generatedImage:baseImage,feather:0,surfaceResponse:true,foilMaskImage:f.maskImage,foilFinish:'silver'});
 const raw=await sharp(output).ensureAlpha().raw().toBuffer();
 const rowMean=y=>Array.from({length:38},(_,x)=>raw[(y*f.width+x+12)*4]).reduce((sum,v)=>sum+v)/38;
 const edge=rowMean(8)-rowMean(10);
 assert.ok(edge>=2&&edge<=26,'压合边缘仅在字形内，亮度变化克制');
 const patchMean=(x,y)=>Array.from({length:6},(_,i)=>raw[((y+Math.floor(i/3))*f.width+x+i%3)*4]).reduce((sum,v)=>sum+v)/6;
 const patches=[];for(let x=12;x<26;x+=3)for(let y=10;y<16;y+=2)patches.push(patchMean(x,y));
 assert.ok(Math.max(...patches)-Math.min(...patches)>=7,'箔纹应有疏密与局部反射变化，不是均匀噪点');
 const original=await sharp(baseImage).ensureAlpha().raw().toBuffer();
 for(let i=0;i<f.rawMask.length;i++)if(!f.rawMask[i])assert.deepEqual(raw.subarray(i*4,i*4+4),original.subarray(i*4,i*4+4));
});

test('silver has restrained opposite light and dark edges that read as a thin material layer',async()=>{
 const f=await printFixture([191,195,201]);
 const baseImage=await sharp({create:{width:f.width,height:f.height,channels:4,background:'#bda39a'}}).png().toBuffer();
 const raw=await sharp(await lockOutsideLogo({...f,baseImage,generatedImage:baseImage,feather:0,surfaceResponse:true,foilMaskImage:f.maskImage,foilFinish:'silver'})).ensureAlpha().raw().toBuffer();
 const mean=y=>Array.from({length:38},(_,x)=>raw[(y*f.width+x+12)*4]).reduce((sum,value)=>sum+value)/38;
 const lit=mean(8)-mean(10),shade=mean(23)-mean(21);
 assert.ok(lit>=14&&lit<=26,'朝光边缘应能看见细薄亮面');
 assert.ok(shade<=-12&&shade>=-22,'背光边缘需要可见且克制的暗面，形成薄箔厚度');
 assert.ok(Math.abs(mean(9)-mean(10))<4&&Math.abs(mean(22)-mean(21))<4,'厚度明暗不能向字面内部扩成宽斜面');
 const original=await sharp(baseImage).ensureAlpha().raw().toBuffer();
 for(let i=0;i<f.rawMask.length;i++)if(!f.rawMask[i])assert.deepEqual(raw.subarray(i*4,i*4+4),original.subarray(i*4,i*4+4),'不扩字形、不增加外投影或填充镂空');
});

test('mixed finishes restrict generated foil lighting to the metallic target mask',async()=>{
  const baseImage=await sharp({create:{width:10,height:4,channels:4,background:'#888888'}}).png().toBuffer();
  const generatedImage=await sharp({create:{width:10,height:4,channels:4,background:'#FFFFFF'}}).png().toBuffer();
  const guideImage=await sharp({create:{width:10,height:4,channels:4,background:'#C54B78'}}).png().toBuffer();
  const maskImage=await sharp(Buffer.alloc(40,255),{raw:{width:10,height:4,channels:1}}).png().toBuffer();
  const foilRaw=Buffer.alloc(40);for(let y=0;y<4;y++)for(let x=0;x<5;x++)foilRaw[y*10+x]=255;
  const foilMaskImage=await sharp(foilRaw,{raw:{width:10,height:4,channels:1}}).png().toBuffer();
  const result=await lockOutsideLogo({baseImage,generatedImage,guideImage,maskImage,foilMaskImage,goldMaskImage:foilMaskImage,feather:0,useGeneratedLighting:true,foilFinish:'gold'});
  const raw=await sharp(result).ensureAlpha().raw().toBuffer();
  assert.deepEqual([...raw.subarray((2*10+7)*4,(2*10+7)*4+3)],[197,75,120]);
  assert.notDeepEqual([...raw.subarray((2*10+2)*4,(2*10+2)*4+3)],[197,75,120]);
});

test('烫金保留细微箔纹和字形内部压印边缘，框外和镂空像素完全不变',async()=>{
 const width=40,height=40,baseRaw=Buffer.alloc(width*height*4),guideRaw=Buffer.alloc(width*height*4),maskRaw=Buffer.alloc(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,k=i*4,inside=x>=8&&x<32&&y>=8&&y<32&&!(x>=18&&x<22&&y>=18&&y<22);
  baseRaw.set([210,200,190,255],k);guideRaw.set(inside?[196,160,82,255]:[210,200,190,255],k);maskRaw[i]=inside?255:0;
 }
 const encode=(data,channels)=>sharp(data,{raw:{width,height,channels}}).png().toBuffer();
 const base=await encode(baseRaw,4),guide=await encode(guideRaw,4),mask=await encode(maskRaw,1);
 const result=await lockOutsideLogo({baseImage:base,generatedImage:base,guideImage:guide,maskImage:mask,feather:0,foilFinish:'gold'});
 const raw=await sharp(result).raw().toBuffer();
 const values=[];
 for(let y=12;y<16;y++)for(let x=12;x<28;x++)values.push(raw[(y*width+x)*4]);
 assert.ok(Math.max(...values)-Math.min(...values)>=6,'平坦箔面仍应有可见的微小纹理变化');
 const mean=y=>Array.from({length:20},(_,x)=>raw[(y*width+x+10)*4]).reduce((a,b)=>a+b)/20;
 assert.ok(mean(8)>mean(31)+8,'字形内上缘与下缘有克制的亮暗对比');
 for(let i=0;i<maskRaw.length;i++)if(!maskRaw[i])assert.deepEqual(raw.subarray(i*4,i*4+4),baseRaw.subarray(i*4,i*4+4));
 for(let i=0;i<maskRaw.length;i++)if(maskRaw[i])assert.ok(raw[i*4]>=raw[i*4+1]&&raw[i*4+1]>raw[i*4+2],'保持金色，不能出现彩色光斑');
 const repeated=await lockOutsideLogo({baseImage:base,generatedImage:base,guideImage:guide,maskImage:mask,feather:0,foilFinish:'gold'});
 assert.deepEqual(result,repeated,'纹理必须稳定，不能每次保存随机变化');
});

test('AI成图只保留Logo区域，Logo之外恢复原图',async()=>{
  const base=await sharp({create:{width:2,height:1,channels:4,background:{r:10,g:20,b:30,alpha:1}}}).png().toBuffer();
  const generated=await sharp({create:{width:2,height:1,channels:4,background:{r:200,g:0,b:0,alpha:1}}}).composite([{input:await sharp({create:{width:1,height:1,channels:4,background:{r:0,g:200,b:0,alpha:1}}}).png().toBuffer(),left:1,top:0}]).png().toBuffer();
  const mask=await sharp({create:{width:2,height:1,channels:3,background:{r:0,g:0,b:0}}}).composite([{input:await sharp({create:{width:1,height:1,channels:3,background:{r:255,g:255,b:255}}}).png().toBuffer(),left:0,top:0}]).grayscale().png().toBuffer();
  const result=await lockOutsideLogo({baseImage:base,generatedImage:generated,maskImage:mask,feather:0});
  const raw=await sharp(result).raw().toBuffer();
  assert.deepEqual([...raw.subarray(0,4)],[200,0,0,255]);
  assert.deepEqual([...raw.subarray(4,8)],[10,20,30,255]);
});

test('AI不能重绘Logo字形，只能为原始Logo增加材质明暗',async()=>{
  const base=await sharp({create:{width:2,height:1,channels:4,background:{r:10,g:20,b:30,alpha:1}}}).png().toBuffer();
  const generated=await sharp({create:{width:2,height:1,channels:4,background:{r:10,g:20,b:30,alpha:1}}}).png().toBuffer();
  const guide=await sharp({create:{width:2,height:1,channels:4,background:{r:80,g:120,b:160,alpha:1}}}).png().toBuffer();
  const mask=await sharp({create:{width:2,height:1,channels:3,background:{r:0,g:0,b:0}}}).composite([{input:await sharp({create:{width:1,height:1,channels:3,background:{r:255,g:255,b:255}}}).png().toBuffer(),left:0,top:0}]).grayscale().png().toBuffer();
  const result=await lockOutsideLogo({baseImage:base,generatedImage:generated,guideImage:guide,maskImage:mask,feather:0});
  const raw=await sharp(result).raw().toBuffer();
  assert.deepEqual([...raw.subarray(0,4)],[80,120,160,255]);
  assert.deepEqual([...raw.subarray(4,8)],[10,20,30,255]);
});

test('金属材质保留可见明暗纹理，同时避免银箔通道饱和偏色',async()=>{
  const base=await sharp({create:{width:1,height:1,channels:4,background:{r:0,g:0,b:0,alpha:1}}}).png().toBuffer();
  const generated=await sharp({create:{width:1,height:1,channels:4,background:{r:255,g:255,b:255,alpha:1}}}).png().toBuffer();
  const guide=await sharp({create:{width:1,height:1,channels:4,background:{r:191,g:195,b:201,alpha:1}}}).png().toBuffer();
  const mask=await sharp({create:{width:1,height:1,channels:3,background:{r:255,g:255,b:255}}}).png().toBuffer();
  const result=await lockOutsideLogo({baseImage:base,generatedImage:generated,guideImage:guide,maskImage:mask,feather:0});
  const raw=await sharp(result).raw().toBuffer();
  assert.deepEqual([...raw],[225,230,237,255]);
});
