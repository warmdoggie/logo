import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {schemeTargets} from './schemes.mjs';
import {chooseContrastColor} from './contrast-color.mjs';
import {normalizeTargetPrint,resolveTargetPrint} from './target-print.mjs';

const VARIANTS=[
  {version:'ORIGINAL'},
  {version:'BLACK'},
  {version:'GOLD FOIL'},
  {version:'SILVER FOIL'}
];

const fail=message=>{throw new Error(message);};
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function hexColor(value){
  if(value===undefined||value===null||value==='')return null;
  const hex=String(value).replace(/^#/,'');
  if(!/^[0-9a-fA-F]{6}$/.test(hex))fail('ORIGINAL Logo 颜色无效');
  return {r:Number.parseInt(hex.slice(0,2),16),g:Number.parseInt(hex.slice(2,4),16),b:Number.parseInt(hex.slice(4,6),16)};
}

function normalizeTargets(targets,width,height){
  if(!Array.isArray(targets)||targets.length===0)fail('至少需要一个上样目标');
  const ids=new Set();
  return targets.map((target,index)=>{
    if(!target||typeof target.id!=='string'||!target.id.trim())fail(`第 ${index+1} 个目标缺少目标ID`);
    if(ids.has(target.id))fail('目标ID不能重复');
    ids.add(target.id);
    for(const key of ['x','y','widthRatio'])if(typeof target[key]!=='number'||!Number.isFinite(target[key]))fail(`目标 ${target.id} 的 ${key} 无效`);
    const rotation=target.rotation??0;
    const surface=target.surface??'free';
    const quad=target.quad===undefined?null:target.quad;
    const curve=target.curve??0;
    if(typeof rotation!=='number'||!Number.isFinite(rotation)||Math.abs(rotation)>180)fail(`目标 ${target.id} 的旋转角度无效`);
    if(!['free','flat','cylinder'].includes(surface))fail(`目标 ${target.id} 的光泽参考无效`);
    if(typeof curve!=='number'||!Number.isFinite(curve)||curve<0||curve>1)fail(`目标 ${target.id} 的曲面弯曲强度无效`);
    if(quad!==null&&(!Array.isArray(quad)||quad.length!==4||quad.some(point=>!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.x>1||point.y<0||point.y>1)))fail(`目标 ${target.id} 的四点透视无效`);
    if(target.widthRatio<=0||target.widthRatio>1||target.x<0||target.x>1||target.y<0||target.y>1)fail(`目标 ${target.id} 的位置或比例无效`);
    if(target.color!==undefined&&target.color!==null)hexColor(target.color);
    return {id:target.id,x:target.x,y:target.y,widthRatio:target.widthRatio,rotation,surface,curve,quad,color:target.color??null,autoContrast:target.autoContrast===true,preserveOriginalColor:target.preserveOriginalColor===true,...normalizeTargetPrint(target)};
  });
}

function foilBrightness(x,y,width,height){
  const u=(x+.5)/width,v=(y+.5)/height,diagonal=u*.76+v*.24;
  const broad=Math.exp(-((diagonal-.53)**2)/.13);
  const glint=Math.exp(-((diagonal-.39)**2)/.012);
  return Math.min(1.24,Math.max(.72,.76+broad*.22+glint*.26));
}

async function recolorLogo(logoImage,color,finish='flat'){
  if(!color)return logoImage;
  const {data,info}=await sharp(logoImage).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let visible=0;
  for(let i=0;i<info.width*info.height;i++){
    const k=i*4,x=i%info.width,y=Math.floor(i/info.width);
    if(data[k+3]===0)continue;
    visible++;
    const brightness=finish==='flat'?1:foilBrightness(x,y,info.width,info.height);
    data[k]=Math.round(Math.min(255,color.r*brightness));
    data[k+1]=Math.round(Math.min(255,color.g*brightness));
    data[k+2]=Math.round(Math.min(255,color.b*brightness));
  }
  if(!visible)fail('Logo没有可见像素');
  return sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
}

async function curveLogo(logoImage,curve){
  if(!curve)return logoImage;
  const {data,info}=await sharp(logoImage).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const output=Buffer.alloc(data.length),half=(info.width-1)/2,theta=curve*1.15,sine=Math.sin(theta);
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
    const relative=half?((x-half)/half):0;
    const sourceX=half+(Math.asin(Math.max(-1,Math.min(1,relative*sine)))/theta)*half;
    output.set(sampleRgba(data,info.width,info.height,sourceX,y),(y*info.width+x)*4);
  }
  return sharp(output,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
}

async function prepareLogo(logoImage,target,imageWidth,imageHeight){
  const curvedLogo=await curveLogo(logoImage,target.curve);
  if(target.quad)return prepareQuadLogo(curvedLogo,target,imageWidth,imageHeight);
  const width=Math.max(1,Math.round(target.widthRatio*imageWidth));
  const {data,info}=await sharp(curvedLogo)
    .resize({width})
    .rotate(target.rotation,{background:{r:0,g:0,b:0,alpha:0}})
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject:true});
  const left=Math.round(target.x*imageWidth-info.width/2);
  const top=Math.round(target.y*imageHeight-info.height/2);
  if(left<0||top<0||left+info.width>imageWidth||top+info.height>imageHeight)fail(`目标 ${target.id} 的Logo超出原图`);
  let visible=0;
  for(let i=0;i<info.width*info.height;i++)if(data[i*4+3])visible++;
  if(!visible)fail(`目标 ${target.id} 的Logo没有可见像素`);
  return {input:await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer(),bounds:{id:target.id,left,top,width:info.width,height:info.height}};
}

function solveLinear(matrix){
  const rows=matrix.map(row=>[...row]);
  for(let column=0;column<8;column++){
    let pivot=column;
    for(let row=column+1;row<8;row++)if(Math.abs(rows[row][column])>Math.abs(rows[pivot][column]))pivot=row;
    if(Math.abs(rows[pivot][column])<1e-10)fail('四点透视无法计算');
    [rows[column],rows[pivot]]=[rows[pivot],rows[column]];
    const scale=rows[column][column];
    for(let index=column;index<=8;index++)rows[column][index]/=scale;
    for(let row=0;row<8;row++)if(row!==column){const factor=rows[row][column];for(let index=column;index<=8;index++)rows[row][index]-=factor*rows[column][index];}
  }
  return rows.map(row=>row[8]);
}

function inverse3(matrix){
  const [a,b,c,d,e,f,g,h,i]=matrix;
  const determinant=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  if(Math.abs(determinant)<1e-10)fail('四点透视无法计算');
  return [(e*i-f*h)/determinant,(c*h-b*i)/determinant,(b*f-c*e)/determinant,(f*g-d*i)/determinant,(a*i-c*g)/determinant,(c*d-a*f)/determinant,(d*h-e*g)/determinant,(b*g-a*h)/determinant,(a*e-b*d)/determinant];
}

function inverseQuadMap(sourceWidth,sourceHeight,points){
  const source=[[0,0],[sourceWidth-1,0],[sourceWidth-1,sourceHeight-1],[0,sourceHeight-1]],rows=[];
  for(let index=0;index<4;index++){
    const [x,y]=source[index],{x:X,y:Y}=points[index];
    rows.push([x,y,1,0,0,0,-X*x,-X*y,X],[0,0,0,x,y,1,-Y*x,-Y*y,Y]);
  }
  return inverse3([...solveLinear(rows),1]);
}

function sampleRgba(data,width,height,x,y){
  if(x<0||y<0||x>width-1||y>height-1)return [0,0,0,0];
  const left=Math.floor(x),top=Math.floor(y),right=Math.min(width-1,left+1),bottom=Math.min(height-1,top+1),fx=x-left,fy=y-top;
  return [0,1,2,3].map(channel=>Math.round(data[(top*width+left)*4+channel]*(1-fx)*(1-fy)+data[(top*width+right)*4+channel]*fx*(1-fy)+data[(bottom*width+left)*4+channel]*(1-fx)*fy+data[(bottom*width+right)*4+channel]*fx*fy));
}

async function prepareQuadLogo(logoImage,target,imageWidth,imageHeight){
  const points=target.quad.map(point=>({x:point.x*imageWidth,y:point.y*imageHeight}));
  const left=Math.floor(Math.min(...points.map(point=>point.x))),top=Math.floor(Math.min(...points.map(point=>point.y))),right=Math.ceil(Math.max(...points.map(point=>point.x))),bottom=Math.ceil(Math.max(...points.map(point=>point.y)));
  if(right<=left||bottom<=top)fail(`目标 ${target.id} 的四点透视无效`);
  const {data,info}=await sharp(logoImage).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const width=right-left,height=bottom-top,relative=points.map(point=>({x:point.x-left,y:point.y-top})),inverse=inverseQuadMap(info.width,info.height,relative),output=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const denominator=inverse[6]*x+inverse[7]*y+inverse[8];
    if(Math.abs(denominator)<1e-10)continue;
    const sourceX=(inverse[0]*x+inverse[1]*y+inverse[2])/denominator,sourceY=(inverse[3]*x+inverse[4]*y+inverse[5])/denominator,rgba=sampleRgba(data,info.width,info.height,sourceX,sourceY),offset=(y*width+x)*4;
    output.set(rgba,offset);
  }
  return {input:await sharp(output,{raw:{width,height,channels:4}}).png().toBuffer(),bounds:{id:target.id,left,top,width,height}};
}

async function applySurfaceLighting(prepared,baseRaw,imageWidth,finish,target){
  if(finish==='flat')return prepared;
  const {data,info}=await sharp(prepared.input).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
    const offset=(y*info.width+x)*4;
    if(data[offset+3]===0)continue;
    const baseOffset=((prepared.bounds.top+y)*imageWidth+prepared.bounds.left+x)*4;
    const luma=(.2126*baseRaw[baseOffset]+.7152*baseRaw[baseOffset+1]+.0722*baseRaw[baseOffset+2])/255;
    const curved=target.surface==='cylinder'?.74+.26*Math.sin(Math.PI*(y+.5)/info.height)**2:1;
    const factor=(.82+luma*.28)*curved;
    data[offset]=Math.round(Math.min(255,data[offset]*factor));
    data[offset+1]=Math.round(Math.min(255,data[offset+1]*factor));
    data[offset+2]=Math.round(Math.min(255,data[offset+2]*factor));
  }
  return {...prepared,input:await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer()};
}

export async function renderLogoSet({baseImage,logoImage,targets,originalColor,schemes}){
  if(!baseImage||!logoImage)fail('必须提供产品/彩盒原图和透明Logo');
  const baseMeta=await sharp(baseImage).metadata();
  const logoMeta=await sharp(logoImage).metadata();
  const baseRaw=await sharp(baseImage).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  if(!baseMeta.width||!baseMeta.height)fail('原图尺寸无效');
  const normalized=normalizeTargets(targets,baseMeta.width,baseMeta.height);
  const selectedOriginalColor=hexColor(originalColor);
  const layout={width:baseMeta.width,height:baseMeta.height,targets:normalized,...(schemes?{schemes}:{})};
  const layoutFingerprint=fingerprint(layout);
  const outputs=[];
  const maskLayers=[];
  for(const variant of VARIANTS){
    const layers=[],foilLayers=[],goldLayers=[];
    const bounds=[];
    const variantTargets=normalizeTargets(schemeTargets({targets,schemes},variant.version),baseMeta.width,baseMeta.height);
    for(const target of variantTargets){
      const autoColor=target.autoContrast?chooseContrastColor({
        data:baseRaw.data,width:baseRaw.info.width,height:baseRaw.info.height,
        left:target.x*baseMeta.width-target.widthRatio*baseMeta.width/2,
        top:target.y*baseMeta.height-(target.widthRatio*baseMeta.width*logoMeta.height/logoMeta.width)/2,
        boxWidth:target.widthRatio*baseMeta.width,
        boxHeight:target.widthRatio*baseMeta.width*logoMeta.height/logoMeta.width
      }):null;
      const print=resolveTargetPrint(target,variant.version,originalColor,autoColor);
      const targetColor=hexColor(print.color)||(print.version==='ORIGINAL'&&!target.preserveOriginalColor?selectedOriginalColor:null);
      const variantLogo=await recolorLogo(logoImage,targetColor,print.finish);
      const prepared=await applySurfaceLighting(await prepareLogo(variantLogo,target,baseMeta.width,baseMeta.height),baseRaw.data,baseMeta.width,print.finish,target);
      layers.push({input:prepared.input,left:prepared.bounds.left,top:prepared.bounds.top});
      if(print.finish!=='flat')foilLayers.push(layers.at(-1));
      if(print.finish==='gold')goldLayers.push(layers.at(-1));
      maskLayers.push(layers.at(-1));
      bounds.push(prepared.bounds);
    }
    const bytes=await sharp(baseImage).ensureAlpha().composite(layers).png().toBuffer();
    const makeMask=async entries=>sharp({create:{width:baseMeta.width,height:baseMeta.height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(entries).extractChannel(3).png().toBuffer();
    outputs.push({version:variant.version,layoutFingerprint,bounds,bytes,mask:await makeMask(layers),foilMask:await makeMask(foilLayers),goldMask:await makeMask(goldLayers)});
  }
  const mask=await sharp({create:{width:baseMeta.width,height:baseMeta.height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(maskLayers).extractChannel(3).png().toBuffer();
  return {width:baseMeta.width,height:baseMeta.height,targetIds:normalized.map(t=>t.id),layoutFingerprint,mask,outputs};
}
