import {createHash} from 'node:crypto';
import {sharp} from './logo-pixels.mjs';
import {normalizeLogoColor} from './carrier-colors.mjs';
import {polygonError} from './public/zone-geometry.js';
const fail=m=>{throw Object.assign(new Error(m),{status:400});};
const hash=b=>createHash('sha256').update(b).digest('hex');
export function normalizeSurfaceMask(value){
 if(value==null)return null;
 if(!value||!Array.isArray(value.regions)||!value.regions.length||value.regions.length>20)fail('底色蒙版需1–20个轮廓');
 if(typeof value.reviewed!=='boolean'||typeof value.reviewNote!=='string'||value.reviewNote.length>1000)fail('请填写蒙版复核状态及说明');
 if(value.reviewed&&!value.reviewNote.trim())fail('确认蒙版时需填写边界复核说明');
 const regions=value.regions.map(r=>{if(!r||!['INCLUDE','EXCLUDE'].includes(r.mode))fail('蒙版轮廓类型无效');const error=polygonError(r.points);if(error)fail(error);return {mode:r.mode,points:r.points.map(p=>({x:p.x,y:p.y}))};});
 if(!regions.some(r=>r.mode==='INCLUDE'))fail('蒙版至少需要一个改色轮廓');
 return {version:1,regions,reviewed:value.reviewed,reviewNote:value.reviewNote.trim()};
}
async function raster(mask,width,height){
 const polygon=r=>`<polygon points="${r.points.map(p=>`${p.x*width},${p.y*height}`).join(' ')}" fill="${r.mode==='INCLUDE'?'white':'black'}"/>`;
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/>${['INCLUDE','EXCLUDE'].flatMap(mode=>mask.regions.filter(r=>r.mode===mode).map(polygon)).join('')}</svg>`;
 const {data,info}=await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({resolveWithObject:true});const out=new Uint8Array(width*height);
 for(let i=0;i<out.length;i++)out[i]=data[i*info.channels]===255?1:0;
 return out;
}
export async function recolorSurfaces(bytes,carriers,overrides){
 const selected=overrides.filter(o=>o.surfaceColor);if(!selected.length)return {bytes,changes:[]};
 const {data,info}=await sharp(bytes,{limitInputPixels:16000000}).rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const occupied=new Uint8Array(info.width*info.height),changes=[];
 for(const setting of selected){
  const carrier=carriers.find(c=>c.id===setting.carrierId),mask=normalizeSurfaceMask(carrier?.surfaceMask);
  if(!mask?.reviewed)fail('载体底色改色需要已复核的独立蒙版');
  const color=normalizeLogoColor(setting.surfaceColor),rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)),pixels=await raster(mask,info.width,info.height);let count=0,sum=0;
  for(let i=0;i<pixels.length;i++){if(!pixels[i]||!data[i*4+3])continue;if(occupied[i])fail('不同载体的改色蒙版重叠，请修正后再生成');count++;sum+=.2126*data[i*4]+.7152*data[i*4+1]+.0722*data[i*4+2];}
  if(!count)fail('底色蒙版没有覆盖有效像素');const mean=sum/count;
  for(let i=0;i<pixels.length;i++){if(!pixels[i]||!data[i*4+3])continue;occupied[i]=1;const luminance=.2126*data[i*4]+.7152*data[i*4+1]+.0722*data[i*4+2],factor=mean>0?Math.max(.25,Math.min(1.75,luminance/mean)):1;for(let c=0;c<3;c++)data[i*4+c]=Math.round(Math.min(255,rgb[c]*factor));}
  changes.push({carrierId:carrier.id,carrierName:carrier.name,color,maskSha:hash(JSON.stringify(mask)),mask,changedAreaPixels:count,method:'SURFACE_LUMINANCE_V1'});
 }
 const output=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
 return {bytes:output,changes,sourceSha:hash(bytes),outputSha:hash(output)};
}
