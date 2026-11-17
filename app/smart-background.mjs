import {sharp} from './logo-pixels.mjs';
import {flatColorMatte} from './flat-color-matte.mjs';

// A single solid ink on a uniform background can be separated without treating
// every antialiased edge as a new colour. All uncertain artwork uses the original
// edge-only candidate for review; it is never replaced by the inferred ink.
function solidInk(data,width,height,background,edgeMask){
 const n=width*height,bins=new Map(),distance=(i,c)=>Math.max(Math.abs(data[i]-c[0]),Math.abs(data[i+1]-c[1]),Math.abs(data[i+2]-c[2]));
 for(let p=0;p<n;p++){
  const i=p*4;if(distance(i,background)<60)continue;
  const key=[0,1,2].map(c=>Math.round(data[i+c]/8)).join(',');
  bins.set(key,(bins.get(key)||0)+1);
 }
 const dominant=[...bins.entries()].sort((a,b)=>b[1]-a[1])[0];
 if(!dominant||dominant[1]<12)return {reason:'Logo 与背景对比不足，无法可靠保留细线和原色'};
 const channels=Array.from({length:3},()=>new Uint32Array(256));
 for(let p=0;p<n;p++){const i=p*4;if(distance(i,background)>=60&&[0,1,2].map(c=>Math.round(data[i+c]/8)).join(',')===dominant[0])for(let c=0;c<3;c++)channels[c][data[i+c]]++;}
 const ink=channels.map(hist=>{let count=0;for(let c=0;c<256;c++){count+=hist[c];if(count>dominant[1]/2)return c;}return 0;});
 // Near-black JPEG quantisation noise is not part of the printed ink.
 if(ink.every(c=>c<=3))ink.fill(0);
 const vector=ink.map((c,k)=>c-background[k]),den=vector.reduce((s,c)=>s+c*c,0),alpha=new Float32Array(n),residual=new Float32Array(n),nearInk=new Uint8Array(n);
 for(let p=0;p<n;p++){
  const i=p*4,a=[0,1,2].reduce((s,c)=>s+(data[i+c]-background[c])*vector[c],0)/den;
  alpha[p]=Math.max(0,Math.min(1,a));residual[p]=Math.max(...[0,1,2].map(c=>Math.abs(data[i+c]-(background[c]+alpha[p]*vector[c]))));
  if(a>=.85&&residual[p]<=18)nearInk[p]=1;
 }
 // The intermediate tones must be close to solid ink, not a broad gradient,
 // shadow or picture. A small neighbourhood also covers thin antialiased lines.
 const nearby=new Uint8Array(n).fill(20);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=y*width+x;if(nearInk[p])nearby[p]=0;else nearby[p]=Math.min(nearby[p],x?nearby[p-1]+1:20,y?nearby[p-width]+1:20,x&&y?nearby[p-width-1]+1:20,y&&x<width-1?nearby[p-width+1]+1:20);}
 for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--){const p=y*width+x;nearby[p]=Math.min(nearby[p],x<width-1?nearby[p+1]+1:20,y<height-1?nearby[p+width]+1:20,x<width-1&&y<height-1?nearby[p+width+1]+1:20,x&&y<height-1?nearby[p+width-1]+1:20);}
 let content=0,unmatched=0,interiorTones=0,holes=0,visible=0;
 const out=Buffer.alloc(data.length);
 for(let p=0;p<n;p++){
  const i=p*4,d=distance(i,background),a=alpha[p];
  if(d>30){content++;if(residual[p]>18)unmatched++;if(a<.85&&nearby[p]>4)interiorTones++;}
  // Remove uniform background even inside letters and enclosed line art.
  if(d<=8||(nearby[p]>4&&d<=30)||a<.025){if(!edgeMask[p])holes++;continue;}
  if(a>=.85||distance(i,ink)<=8)out[i+3]=255;else out[i+3]=Math.round(a*255);
  out[i]=ink[0];out[i+1]=ink[1];out[i+2]=ink[2];if(out[i+3])visible++;
 }
 const evidence={ink,contentPixels:content,unmatchedPixels:unmatched,interiorTonePixels:interiorTones,enclosedBackgroundPixels:holes};
 if(!content||visible<12||visible/n>.9)return {reason:'Logo 与背景难以区分或有效内容不足',evidence};
 if(unmatched>Math.max(2,content*.01))return {reason:'图形包含多种颜色或复杂边缘，需确认内部颜色与背景的区分',evidence};
 if(interiorTones>Math.max(2,content*.01))return {reason:'图形可能包含渐变、阴影或较细的浅色内容，需确认细节没有被去除',evidence};
 return {out,evidence};
}

export async function transparentMaster(bytes,{sourceFormat}={}){
 const {data,info}=await sharp(bytes,{limitInputPixels:16000000}).rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true}),{width,height}=info,n=width*height;
 if(n>16000000)throw Error('Logo 图片过大');
 let transparent=0,visible=0;for(let i=3;i<data.length;i+=4){if(data[i]<250)transparent++;if(data[i]>0)visible++;}
 if(!visible)return {status:'DESIGNER_REQUIRED',reason:'图片完全透明，没有可用 Logo 内容',confidence:'LOW'};
 if(transparent>n*.01)return {status:'READY',method:'KEEP_ALPHA',confidence:'HIGH',buffer:await sharp(data,{raw:info}).png().toBuffer(),width,height};
 if(width<32||height<16)return {status:'DESIGNER_REQUIRED',reason:'图片分辨率太低，请提供更清晰的 Logo 或由设计师处理',confidence:'LOW'};
 const edge=[];for(let x=0;x<width;x++){edge.push(x);edge.push((height-1)*width+x);}for(let y=1;y<height-1;y++){edge.push(y*width);edge.push(y*width+width-1);}
 const bins=new Map();for(const p of edge){const i=p*4,k=[data[i],data[i+1],data[i+2]].map(v=>Math.floor(v/24)).join(',');const b=bins.get(k)||[];b.push(p);bins.set(k,b);}
 const dominant=[...bins.values()].sort((a,b)=>b.length-a.length)[0];
 if(!dominant||dominant.length/edge.length<.8)return {status:'DESIGNER_REQUIRED',reason:'背景颜色不均匀或边缘含复杂图案，请设计师分离背景',confidence:'LOW'};
 const color=[0,1,2].map(c=>Math.round(dominant.reduce((s,p)=>s+data[p*4+c],0)/dominant.length));
 const near=p=>{const i=p*4;return Math.max(...color.map((v,c)=>Math.abs(data[i+c]-v)))<=30;};
 const mask=new Uint8Array(n),queue=new Int32Array(n);let head=0,tail=0;
 const add=p=>{if(!mask[p]&&near(p)){mask[p]=1;queue[tail++]=p;}};edge.forEach(add);
 while(head<tail){const p=queue[head++],x=p%width,y=Math.floor(p/width);if(x)add(p-1);if(x<width-1)add(p+1);if(y)add(p-width);if(y<height-1)add(p+width);}
 const removed=tail/n;if(removed<.02||removed>.98)return {status:'DESIGNER_REQUIRED',reason:'Logo 与背景难以区分或有效内容过少，需要设计师检查',confidence:'LOW'};
 const multi=flatColorMatte(data,width,height,color,mask,{jpeg:sourceFormat==='jpeg'||sourceFormat==='jpg'||bytes[0]===255&&bytes[1]===216});
 if(multi.out&&dominant.length/edge.length>=.95)return {status:'READY',method:'FLAT_COLOR_MATTE',confidence:'HIGH',needsReview:false,background:color,removedRatio:removed,width,height,evidence:multi.evidence,buffer:await sharp(multi.out,{raw:info}).png().toBuffer()};
 const automatic=multi.single?solidInk(data,width,height,color,mask):multi;
 if(multi.single&&automatic.out&&dominant.length/edge.length>=.95){
  return {status:'READY',method:'SOLID_INK_MATTE',confidence:'HIGH',needsReview:false,background:color,removedRatio:removed,width,height,evidence:automatic.evidence,buffer:await sharp(automatic.out,{raw:info}).png().toBuffer()};
 }
 // Conservative review output preserves interior colours. This branch does not
 // apply the proposed single-ink reconstruction to ambiguous artwork.
 const out=Buffer.from(data);for(let p=0;p<n;p++)if(mask[p])out[p*4+3]=0;
 return {status:'READY',method:'EDGE_CONNECTED_SOLID',confidence:'MEDIUM',needsReview:true,reason:automatic.reason||'图片边缘颜色不够一致，请确认背景与图形边界',background:color,removedRatio:removed,width,height,evidence:automatic.evidence,buffer:await sharp(out,{raw:info}).png().toBuffer()};
}
export async function referenceColor(bytes,x,y,radius=2){
 if(!Number.isInteger(radius)||radius<0||radius>10)throw Error('取色半径必须为 0–10 的整数');
 if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1)throw Error('吸色坐标必须在0–1内');
 const {data,info}=await sharp(bytes).rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true}),cx=Math.round(x*(info.width-1)),cy=Math.round(y*(info.height-1)),sum=[0,0,0];let weight=0;
 if(data[(cy*info.width+cx)*4+3]===0)throw Error('所选位置完全透明，请选择有颜色的位置');
 for(let py=Math.max(0,cy-radius);py<=Math.min(info.height-1,cy+radius);py++)for(let px=Math.max(0,cx-radius);px<=Math.min(info.width-1,cx+radius);px++){const i=(py*info.width+px)*4,a=data[i+3]/255;weight+=a;sum.forEach((_,c)=>sum[c]+=data[i+c]*a);}
 if(!weight)throw Error('所选位置完全透明，请选择有颜色的位置');const rgb=sum.map(s=>Math.round(s/weight));return {sourceType:'REFERENCE',rgb,hex:'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase(),label:'视觉参考色',sampleRadius:radius};
}
