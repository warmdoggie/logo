// Separate discrete, flat-colour artwork from a uniform opaque background.
// A colour must have stable interior pixels. Intermediate tones must stay next
// to a matching solid colour; broad gradients/shadows never qualify as edges.
const distance=(data,i,c)=>Math.max(Math.abs(data[i]-c[0]),Math.abs(data[i+1]-c[1]),Math.abs(data[i+2]-c[2]));
const colorDistance=(a,b)=>Math.max(...a.map((v,k)=>Math.abs(v-b[k])));

function paletteFromInteriors(data,width,height,background){
 const bins=new Map();
 for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
  const i=(y*width+x)*4;if(distance(data,i,background)<45)continue;
  let stable=true;
  for(const j of [i-4,i+4,i-width*4,i+width*4])if(Math.max(Math.abs(data[j]-data[i]),Math.abs(data[j+1]-data[i+1]),Math.abs(data[j+2]-data[i+2]))>8){stable=false;break;}
  if(!stable)continue;
  const key=(Math.round(data[i]/12)<<10)|(Math.round(data[i+1]/12)<<5)|Math.round(data[i+2]/12);
  let b=bins.get(key);if(!b){b={count:0,sum:[0,0,0]};bins.set(key,b);}b.count++;for(let k=0;k<3;k++)b.sum[k]+=data[i+k];
 }
 const clusters=[];
 for(const b of [...bins.values()].filter(b=>b.count>=4).sort((a,b)=>b.count-a.count)){
  const color=b.sum.map(v=>v/b.count),existing=clusters.find(c=>colorDistance(c.anchor,color)<=18);
  if(existing){existing.count+=b.count;for(let k=0;k<3;k++)existing.sum[k]+=b.sum[k];}
  else clusters.push({...b,sum:[...b.sum],anchor:color});
 }
 return clusters.filter(c=>c.count>=8).map(c=>({color:c.sum.map(v=>Math.round(v/c.count)),interiorPixels:c.count}));
}

export function flatColorMatte(data,width,height,background,edgeMask,{jpeg=false}={}){
 const n=width*height,palette=paletteFromInteriors(data,width,height,background);
 if(palette.length<=1)return {single:true};
 const evidence={palette,contentPixels:0,unmatchedPixels:0,interiorTonePixels:0,enclosedBackgroundPixels:0,ambiguousEnclosedPixels:0,compressedEdgePixels:0,compressedNoisePixels:0};
 if(palette.length>8)return {reason:'图形包含连续色阶或较多颜色，需确认是否存在渐变、阴影或背景残留',evidence};
 const colors=palette.map(p=>p.color),vectors=colors.map(c=>c.map((v,k)=>v-background[k])),den=vectors.map(v=>v.reduce((s,c)=>s+c*c,0));
 const seeds=new Uint8Array(n),nearby=colors.map(()=>new Uint8Array(n).fill(16));
 for(let p=0;p<n;p++){
  const i=p*4;let best=14,which=-1;
  for(let k=0;k<colors.length;k++){const d=distance(data,i,colors[k]);if(d<best){best=d;which=k;}}
  if(which>=0){seeds[p]=which+1;nearby[which][p]=0;}
 }
 for(const near of nearby){
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=y*width+x;near[p]=Math.min(near[p],x?near[p-1]+1:16,y?near[p-width]+1:16,x&&y?near[p-width-1]+1:16,y&&x<width-1?near[p-width+1]+1:16);}
  for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--){const p=y*width+x;near[p]=Math.min(near[p],x<width-1?near[p+1]+1:16,y<height-1?near[p+width]+1:16,x<width-1&&y<height-1?near[p+width+1]+1:16,x&&y<height-1?near[p+width-1]+1:16);}
 }
 // Enclosed white areas in coloured artwork can be intentional fills. Keep
 // the conservative candidate for review rather than silently punching holes.
 // Neutral-ink letter counters retain the established text-hole behaviour.
 const seen=new Uint8Array(n),queue=new Int32Array(n);
 for(let first=0;first<n;first++){
  if(edgeMask[first]||seen[first]||distance(data,first*4,background)>30)continue;
  let head=0,tail=1;queue[0]=first;seen[first]=1;const surround=new Set();
  while(head<tail){const p=queue[head++],x=p%width,y=Math.floor(p/width);
   for(const q of [x?p-1:-1,x<width-1?p+1:-1,y?p-width:-1,y<height-1?p+width:-1]){
    if(q<0||edgeMask[q])continue;
    if(distance(data,q*4,background)<=30){if(!seen[q]){seen[q]=1;queue[tail++]=q;}}
    else {let best=Infinity,k=0;for(let j=0;j<colors.length;j++){const d=nearby[j][q];if(d<best){best=d;k=j;}}surround.add(k);}
   }
  }
  if(tail>=4&&([...surround].some(k=>Math.max(...colors[k])-Math.min(...colors[k])>20)||surround.size!==1))evidence.ambiguousEnclosedPixels+=tail;
  evidence.enclosedBackgroundPixels+=tail;
 }
 if(evidence.ambiguousEnclosedPixels)return {reason:'彩色图形内部有与背景相同的封闭区域，需确认这些区域是留白还是图案颜色',evidence};
 const out=Buffer.alloc(data.length),used=new Uint32Array(colors.length);
 for(let p=0;p<n;p++){
  const i=p*4,d=distance(data,i,background),close=Math.min(...nearby.map(a=>a[p]));
  if(d<=8||(d<=30&&close>4))continue;
  if(d>30)evidence.contentPixels++;
  let which=seeds[p]-1,alpha=1,best=Infinity;
  if(which<0){
   for(let k=0;k<colors.length;k++){
    const v=vectors[k],a=Math.max(0,Math.min(1,((data[i]-background[0])*v[0]+(data[i+1]-background[1])*v[1]+(data[i+2]-background[2])*v[2])/den[k]));
    const residual=Math.max(Math.abs(data[i]-background[0]-a*v[0]),Math.abs(data[i+1]-background[1]-a*v[1]),Math.abs(data[i+2]-background[2]-a*v[2]));
    const score=residual+Math.max(0,nearby[k][p]-4)*4;
    if(score<best){best=score;which=k;alpha=a;}
   }
   const v=vectors[which],residual=Math.max(Math.abs(data[i]-background[0]-alpha*v[0]),Math.abs(data[i+1]-background[1]-alpha*v[1]),Math.abs(data[i+2]-background[2]-alpha*v[2]));
   // Antialiasing between two opaque fills is a colour mixture, not alpha.
   let opaqueMix=false;
   if(residual>18)for(let a=0;a<colors.length&&!opaqueMix;a++)for(let b=a+1;b<colors.length;b++){
    if(nearby[a][p]>2||nearby[b][p]>2)continue;
    const c=colors[a],v=colors[b].map((x,k)=>x-c[k]),den=v.reduce((s,x)=>s+x*x,0),t=Math.max(0,Math.min(1,((data[i]-c[0])*v[0]+(data[i+1]-c[1])*v[1]+(data[i+2]-c[2])*v[2])/den));
    if(Math.max(...c.map((x,k)=>Math.abs(data[i+k]-x-t*v[k])))<=18){opaqueMix=true;break;}
   }
   if(opaqueMix){data.copy(out,i,i,i+4);out[i+3]=255;continue;}
   let compressedEdge=false;
   if(jpeg&&residual>18&&residual<=45&&nearby[which][p]<=3){
    const x=p%width,y=Math.floor(p/width);
    for(let yy=Math.max(0,y-3);yy<=Math.min(height-1,y+3)&&!compressedEdge;yy++)for(let xx=Math.max(0,x-3);xx<=Math.min(width-1,x+3);xx++)if(edgeMask[yy*width+xx]){compressedEdge=true;break;}
   }
   if(compressedEdge)evidence.compressedEdgePixels++;
   if(d>30&&residual>18&&!compressedEdge)evidence.unmatchedPixels++;
   if(d>30&&nearby[which][p]>4)evidence.interiorTonePixels++;
  }
  if(alpha<.025)continue;
  // Weak ringing in the already-confirmed exterior background is JPEG noise,
  // not a detached translucent mark. Do not apply this cleanup to PNG artwork
  // or enclosed interiors.
  if(jpeg&&alpha<=.085&&edgeMask[p]){evidence.compressedNoisePixels++;continue;}
  const c=colors[which];out[i]=c[0];out[i+1]=c[1];out[i+2]=c[2];out[i+3]=alpha>=.85?255:Math.round(alpha*255);used[which]++;
 }
 // A small differently-coloured accent must not be discarded just because the
 // main lettering is large. Unsupported colours cause review of intact pixels.
 if(evidence.unmatchedPixels>4)return {reason:'部分细节无法按实色边缘分离，需确认渐变或浅色图案是否保留',evidence};
 if(evidence.interiorTonePixels>4)return {reason:'检测到较宽的色阶变化或阴影，需确认图案与背景的边界',evidence};
 if(used.some(n=>n<4))return {reason:'部分颜色面积过小，需确认独立图形是否完整保留',evidence};
 return {out,evidence};
}
