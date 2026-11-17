import {sharp} from './logo-pixels.mjs';
import {corners} from './public/mockup-geometry.js';
import {pointInside} from './public/zone-geometry.js';
// Sample the actual Logo footprint, not the average color of the whole carton.
// Mixed tones deliberately require a user choice; no remote model is called.
export async function chooseCartonInk(base,placement,image,logo){
 const polygon=corners(placement,image,logo),W=160,H=Math.max(1,Math.round(160*image.height/image.width));
 const {data,info}=await sharp(base).rotate().resize(W,H,{fit:'fill'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const luminance=[],pixels=new Map();
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(pointInside({x:(x+.5)/info.width,y:(y+.5)/info.height},polygon)){
  const i=(y*info.width+x)*info.channels,linear=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};
  const l=.2126*linear(data[i])+.7152*linear(data[i+1])+.0722*linear(data[i+2]);luminance.push(l);pixels.set(y*info.width+x,l);
 }
 if(luminance.length<12)return {status:'CHOICE_REQUIRED',reason:'Logo 所在区域太小，需选择黑色或白色'};
 luminance.sort((a,b)=>a-b);const q=n=>luminance[Math.floor((luminance.length-1)*n)],low=q(.1),high=q(.9),middle=q(.5);
 const dark=luminance.filter(n=>n<.14).length/luminance.length,light=luminance.filter(n=>n>.4).length/luminance.length;
 // Small, separated high-contrast strokes can corroborate the background choice.
 // This is a conservative shape cue, not OCR; it never resolves an ambiguous background.
 const candidates=new Set([...pixels].filter(([,v])=>middle>.4?v<.14:middle<.14&&v>.7).map(([i])=>i)),seen=new Set();let strokeCount=0,strokePixels=0;
 for(const start of candidates){if(seen.has(start))continue;const stack=[start];seen.add(start);let n=0,minX=info.width,maxX=0,minY=info.height,maxY=0;
  while(stack.length){const i=stack.pop(),x=i%info.width,y=Math.floor(i/info.width);n++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
   for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){const k=ny*info.width+nx;if(nx>=0&&nx<info.width&&ny>=0&&ny<info.height&&candidates.has(k)&&!seen.has(k)){seen.add(k);stack.push(k);}}
  }
  const w=maxX-minX+1,h=maxY-minY+1;if(n>=2&&n<=luminance.length*.02&&h>=2&&h<=info.height*.18&&w<=info.width*.12&&w/h<=3){strokeCount++;strokePixels+=n;}
 }
 const textColorSupport=strokeCount>=3&&strokePixels/luminance.length<.12?{hex:middle>.4?'#000000':'#ffffff',strokeCount}:null,evidence={low,high,middle,textColorSupport};
 if(dark>.12&&light>.12||high-low>.36||middle>=.14&&middle<=.4)return {status:'CHOICE_REQUIRED',reason:'此处底色有深浅变化，请比较黑／白预览后选择',evidence};
 return {status:'READY',hex:middle>.4?'#000000':'#ffffff',source:textColorSupport?'LOCAL_BACKGROUND_AND_STROKES':'LOCAL_BACKGROUND',evidence};
}
