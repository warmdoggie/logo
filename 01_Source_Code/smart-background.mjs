import {sharp} from './logo-pixels.mjs';
// Remove only edge-connected background. Interior artwork colours are untouched.
export async function transparentMaster(bytes){
 const {data,info}=await sharp(bytes).rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true}),{width,height}=info,n=width*height;
 if(n>16000000)throw Error('Logo 图片过大');
 let transparent=0,visible=0;for(let i=3;i<data.length;i+=4){if(data[i]<250)transparent++;if(data[i]>0)visible++;}
 if(!visible)return {status:'DESIGNER_REQUIRED',reason:'图片完全透明，没有可用 Logo 内容',confidence:'LOW'};
 if(transparent>n*.01)return {status:'READY',method:'KEEP_ALPHA',confidence:'HIGH',buffer:await sharp(data,{raw:info}).png().toBuffer(),width,height};
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
 // Conservative output: preserve every unclassified source pixel, including enclosed light/dark regions.
 const out=Buffer.from(data);for(let p=0;p<n;p++)if(mask[p])out[p*4+3]=0;
 return {status:'READY',method:'EDGE_CONNECTED_SOLID',confidence:'MEDIUM',needsReview:true,background:color,removedRatio:removed,width,height,buffer:await sharp(out,{raw:info}).png().toBuffer()};
}
export async function referenceColor(bytes,x,y,radius=2){
 if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1)throw Error('吸色坐标必须在0–1内');
 const {data,info}=await sharp(bytes).rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true}),cx=Math.round(x*(info.width-1)),cy=Math.round(y*(info.height-1)),sum=[0,0,0];let weight=0;
 for(let py=Math.max(0,cy-radius);py<=Math.min(info.height-1,cy+radius);py++)for(let px=Math.max(0,cx-radius);px<=Math.min(info.width-1,cx+radius);px++){const i=(py*info.width+px)*4,a=data[i+3]/255;weight+=a;sum.forEach((_,c)=>sum[c]+=data[i+c]*a);}
 if(!weight)throw Error('所选位置完全透明，请选择有颜色的位置');const rgb=sum.map(s=>Math.round(s/weight));return {sourceType:'REFERENCE',rgb,hex:'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase(),label:'视觉参考色',sampleRadius:radius};
}
