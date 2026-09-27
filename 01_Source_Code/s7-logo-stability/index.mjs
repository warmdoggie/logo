import {createHash} from 'node:crypto';
import sharp from 'sharp';

const VARIANTS=[
  {version:'ORIGINAL',color:null},
  {version:'BLACK',color:{r:0,g:0,b:0}},
  {version:'GOLD FOIL',color:{r:196,g:160,b:82}},
  {version:'SILVER FOIL',color:{r:191,g:195,b:201}}
];

const fail=message=>{throw new Error(message);};
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function normalizeTargets(targets,width,height){
  if(!Array.isArray(targets)||targets.length===0)fail('至少需要一个上样目标');
  const ids=new Set();
  return targets.map((target,index)=>{
    if(!target||typeof target.id!=='string'||!target.id.trim())fail(`第 ${index+1} 个目标缺少目标ID`);
    if(ids.has(target.id))fail('目标ID不能重复');
    ids.add(target.id);
    for(const key of ['x','y','widthRatio'])if(typeof target[key]!=='number'||!Number.isFinite(target[key]))fail(`目标 ${target.id} 的 ${key} 无效`);
    const rotation=target.rotation??0;
    if(typeof rotation!=='number'||!Number.isFinite(rotation)||Math.abs(rotation)>180)fail(`目标 ${target.id} 的旋转角度无效`);
    if(target.widthRatio<=0||target.widthRatio>1||target.x<0||target.x>1||target.y<0||target.y>1)fail(`目标 ${target.id} 的位置或比例无效`);
    return {id:target.id,x:target.x,y:target.y,widthRatio:target.widthRatio,rotation};
  });
}

async function recolorLogo(logoImage,color){
  if(!color)return logoImage;
  const {data,info}=await sharp(logoImage).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let visible=0;
  for(let i=0;i<info.width*info.height;i++){
    const k=i*4;
    if(data[k+3]===0)continue;
    visible++;
    data[k]=color.r;
    data[k+1]=color.g;
    data[k+2]=color.b;
  }
  if(!visible)fail('Logo没有可见像素');
  return sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
}

async function prepareLogo(logoImage,target,imageWidth,imageHeight){
  const width=Math.max(1,Math.round(target.widthRatio*imageWidth));
  const {data,info}=await sharp(logoImage)
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

export async function renderLogoSet({baseImage,logoImage,targets}){
  if(!baseImage||!logoImage)fail('必须提供产品/彩盒原图和透明Logo');
  const baseMeta=await sharp(baseImage).metadata();
  if(!baseMeta.width||!baseMeta.height)fail('原图尺寸无效');
  const normalized=normalizeTargets(targets,baseMeta.width,baseMeta.height);
  const layout={width:baseMeta.width,height:baseMeta.height,targets:normalized};
  const layoutFingerprint=fingerprint(layout);
  const outputs=[];
  for(const variant of VARIANTS){
    const variantLogo=await recolorLogo(logoImage,variant.color);
    const layers=[];
    const bounds=[];
    for(const target of normalized){
      const prepared=await prepareLogo(variantLogo,target,baseMeta.width,baseMeta.height);
      layers.push({input:prepared.input,left:prepared.bounds.left,top:prepared.bounds.top});
      bounds.push(prepared.bounds);
    }
    const bytes=await sharp(baseImage).ensureAlpha().composite(layers).png().toBuffer();
    outputs.push({version:variant.version,layoutFingerprint,bounds,bytes});
  }
  return {width:baseMeta.width,height:baseMeta.height,targetIds:normalized.map(t=>t.id),layoutFingerprint,outputs};
}
