import {sharp} from './logo-pixels.mjs';
const luminance=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
// Advisory image heuristic, not a printing requirement. Never changes the chosen colour.
export async function visibilityCheck(background,logoBytes,placement,image,logo){
 const small=await sharp(logoBytes).rotate().resize({width:48,height:48,fit:'inside'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const w=placement.widthRatio*image.width,h=w*logo.height/logo.width,a=placement.rotation*Math.PI/180,ratios=[];
 for(let y=0;y<small.info.height;y++)for(let x=0;x<small.info.width;x++){
  const i=(y*small.info.width+x)*4,alpha=small.data[i+3]/255;if(alpha<.2)continue;
  const lx=((x+.5)/small.info.width-.5)*w,ly=((y+.5)/small.info.height-.5)*h;
  const px=Math.floor(placement.x*image.width+lx*Math.cos(a)-ly*Math.sin(a)),py=Math.floor(placement.y*image.height+lx*Math.sin(a)+ly*Math.cos(a));
  if(px<0||py<0||px>=background.info.width||py>=background.info.height)continue;
  const bi=(py*background.info.width+px)*4,ba=background.data[bi+3]/255,bg=[0,1,2].map(c=>background.data[bi+c]*ba+255*(1-ba)),fg=bg.map((v,c)=>small.data[i+c]*alpha+v*(1-alpha));
  const l1=luminance(bg),l2=luminance(fg);ratios.push((Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05));
 }
 ratios.sort((a,b)=>a-b);const lowFraction=ratios.length?ratios.filter(r=>r<3).length/ratios.length:0;
 return {method:'IMAGE_CONTRAST_HINT_V1',advisoryThreshold:3,sampleCount:ratios.length,lowFraction,medianRatio:ratios.length?ratios[Math.floor(ratios.length/2)]:null,warning:ratios.length>=5&&lowFraction>.5,message:ratios.length>=5&&lowFraction>.5?'Logo 与底图颜色接近，可能不够清晰。请查看预览；系统未自动改色。':null};
}
