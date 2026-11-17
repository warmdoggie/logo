import {sharp} from './logo-pixels.mjs';
import {createHash} from 'node:crypto';
const cache=new Map();
// Measure visible pixels only; never alter the stored Logo or remove any foreground.
export async function logoContent(bytes,logo){
 const key=createHash('sha256').update(bytes).digest('hex');
 let bounds=cache.get(key);
 if(!bounds){
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let left=info.width,top=info.height,right=-1,bottom=-1;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*info.channels+info.channels-1]>0){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  bounds=right<left?{x:0,y:0,width:info.width,height:info.height}:{x:left,y:top,width:right-left+1,height:bottom-top+1};
  if(cache.size>100)cache.delete(cache.keys().next().value);cache.set(key,bounds);
 }
 return {...logo,contentBounds:bounds};
}
