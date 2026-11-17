import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
const require=createRequire(import.meta.url);
// Prefer project dependencies; keep compatibility with the original bundled Node runtime.
function loadSharp(){
 const candidates=['sharp',resolve(dirname(process.execPath),'../node_modules/sharp')];
 if(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES)candidates.push(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'sharp'));
 for(const candidate of candidates){
  let path;try{path=require.resolve(candidate);}catch(e){if(e.code==='MODULE_NOT_FOUND')continue;throw e;}
  return require(path);
 }
 throw new Error('缺少图片处理依赖 sharp，请在项目目录执行 npm install 后重新启动。');
}
export const sharp=loadSharp();
const fail=m=>{throw Object.assign(new Error(m),{status:400});};
export async function decodeOriginal(bytes,name=''){
 if(!bytes.length||bytes.length>32*1024*1024)fail('请选择 32 MB 以内的 Logo 文件');
 const svg=/\.svg$/i.test(name)||/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(bytes.toString('utf8',0,500));
 if(svg){const s=bytes.toString('utf8');if(/<!DOCTYPE|<!ENTITY|<script|<foreignObject|<animate|<set[\s>]|\bon\w+\s*=|(?:href|src)\s*=|url\(\s*[^#]/i.test(s))fail('SVG 包含外部引用或动态内容，请提供独立静态 SVG 或透明 PNG');}
 let data,info;
 try{const meta=await sharp(bytes,{limitInputPixels:64000000,animated:false}).metadata();if(meta.pages>1)fail('请使用单帧图片或静态 SVG');({data,info}=await sharp(bytes,{limitInputPixels:64000000,animated:false}).rotate().resize({width:4000,height:4000,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true}));}catch(e){if(e.status)throw e;if(/pixel limit/i.test(e.message))fail('Logo 分辨率超过 6400 万像素，请缩小后上传（例如 8000 × 8000）');fail('无法读取图片，请使用有效的 PNG、JPEG、WebP 或静态 SVG');}
 const format=svg?'svg':bytes[0]===137?'png':bytes[0]===255?'jpg':bytes.toString('ascii',0,4)==='RIFF'?'webp':null;
 if(!format)fail('仅支持 PNG、JPEG、WebP 和静态 SVG');
 const preview=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
 return {preview,width:info.width,height:info.height,ext:format,mimeType:format==='svg'?'image/svg+xml':format==='jpg'?'image/jpeg':'image/'+format};
}
const dist=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;
function narrowGapClassifier(data,width,height){
 // Closely spaced letters can leave a long, antialiased slit with no fully
 // transparent pixel in a local window. Follow that slit to clear background,
 // requiring opaque ink of the same colour beside every pixel on the path.
 // Do not let a broad or detached translucent shape borrow another glyph's ink.
 const checked=new Uint8Array(width*height);
 return first=>{
  if(checked[first])return checked[first]===2;
  const start=first*4,color=[data[start],data[start+1],data[start+2]],queue=[first],seen=new Set(queue);
  let head=0,clear=false,narrow=true;
  const matches=i=>color.every((v,k)=>Math.abs(data[i+k]-v)<=12);
  while(head<queue.length&&narrow){
   const p=queue[head++],x=p%width,y=Math.floor(p/width);let solid=false;
   for(let yy=Math.max(0,y-4);yy<=Math.min(height-1,y+4)&&!solid;yy++)for(let xx=Math.max(0,x-4);xx<=Math.min(width-1,x+4);xx++){
    const i=(yy*width+xx)*4;if(data[i+3]>=250&&matches(i)){solid=true;break;}
   }
   if(!solid){narrow=false;break;}
   for(const q of [x?p-1:-1,x<width-1?p+1:-1,y?p-width:-1,y<height-1?p+width:-1]){
    if(q<0||data[q*4+3]<=8){clear=true;continue;}
    if(data[q*4+3]>=250||!matches(q*4)||seen.has(q))continue;
    seen.add(q);queue.push(q);
   }
   if(queue.length>16384)narrow=false; // Uncertain/large components stay reviewable.
  }
  const value=narrow&&clear?2:1;for(const p of queue)checked[p]=value;
  return value===2;
 };
}
export function analyzePixels(data,width,height){
 const bins=new Map(),exactColors=new Map();let opaque=0,partial=0,visible=0;
 const stride=Math.max(1,Math.floor(width*height/150000));
 for(let p=0;p<width*height;p+=stride){const i=p*4,a=data[i+3];if(a===0)continue;visible++;if(a<250)partial++;if(a<200)continue;
  // Estimate dominant fills from stable interiors, excluding antialiased boundaries.
  const x=p%width,y=Math.floor(p/width);if(x>0&&x<width-1&&y>0&&y<height-1){const neighbors=[i-4,i+4,i-width*4,i+width*4];if(neighbors.some(n=>data[n+3]<200||Math.max(...[0,1,2].map(k=>Math.abs(data[n+k]-data[i+k])))>24))continue;}
  opaque++;const c=[data[i],data[i+1],data[i+2]],key=c.map(v=>Math.round(v/24)).join(',');const b=bins.get(key)||{n:0,sum:[0,0,0]};b.n++;c.forEach((v,k)=>b.sum[k]+=v);bins.set(key,b);
  if(exactColors.size<=3){const exact=c.join(',');exactColors.set(exact,(exactColors.get(exact)||0)+1);}}
 const significant=[...bins.values()].filter(b=>b.n>=Math.max(2,opaque*.015)).sort((a,b)=>b.n-a.n);
 const palette=[];for(const b of significant){const c=b.sum.map(v=>Math.round(v/b.n));if(!palette.some(p=>dist(c,p)<45**2))palette.push(c);}
 // A small solid accent is still an ink colour, even below 1.5% of the text.
 // This exception requires an exact, limited interior palette, not JPEG noise.
 if(exactColors.size<=3&&[...exactColors.values()].every(n=>n>=4))for(const key of exactColors.keys()){
  const c=key.split(',').map(Number);if(!palette.some(p=>dist(c,p)<45**2))palette.push(c);
 }
 // Thin antialiased outlines have both nearby clear background and opaque ink
 // of the same colour. Interior transparency must remain a separate finding.
 let edgePixels=0,contentPartial=0,stable=0,examined=0,gap=null;
 for(let p=0;p<width*height;p+=stride){const i=p*4,a=data[i+3];if(!a)continue;
  if(a>=200){examined++;if(palette.some(c=>[0,1,2].every(k=>Math.abs(c[k]-data[i+k])<=3)))stable++;}
  if(a>=250)continue;const x=p%width,y=Math.floor(p/width);let clear=false,solid=false;
  for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=width||yy>=height){clear=true;continue;}const n=(yy*width+xx)*4;if(data[n+3]<=8)clear=true;else if(data[n+3]>=250&&[0,1,2].every(k=>Math.abs(data[n+k]-data[i+k])<=Math.max(12,765/a)))solid=true;}
  if(clear&&!solid){
   // Thin strokes and serifs may extend beyond the four-pixel neighbourhood.
   // Follow only connected pixels of the same ink; a detached translucent mark
   // cannot borrow opacity from another nearby object.
   const queue=[[x,y]],seen=new Set([p]);let head=0;
   while(head<queue.length&&!solid){const [cx,cy]=queue[head++];for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]){const xx=cx+dx,yy=cy+dy;if(xx<0||yy<0||xx>=width||yy>=height||Math.abs(xx-x)>10||Math.abs(yy-y)>10)continue;const key=yy*width+xx,n=key*4;if(seen.has(key))continue;seen.add(key);if(data[n+3]<8||[0,1,2].some(k=>Math.abs(data[n+k]-data[i+k])>12))continue;if(data[n+3]>=250){solid=true;break;}queue.push([xx,yy]);}}
  }
  if(!clear&&solid){gap??=narrowGapClassifier(data,width,height);clear=gap(p);}
  if(clear&&solid)edgePixels++;else contentPartial++;
 }
 const count=palette.length||null,discrete=!!count&&count<=3&&examined>=8&&stable/examined>=.995;
 const complex=significant.length>8;
 const contentTransparency=contentPartial>2;
 const confidence=discrete?'HIGH':!count||complex?'LOW':'MEDIUM';
 const gradient=discrete?false:complex?true:null;
 return {estimatedColorCount:count,colorLevel:!count?'UNKNOWN':count===1?'ONE':count===2?'TWO':count===3?'THREE':'MORE_THAN_THREE',hasGradient:gradient,hasTransparency:contentTransparency,hasShadow:null,analysisConfidence:confidence,needsManualReview:!discrete||contentTransparency,palette:palette.slice(0,8).map(c=>'#'+c.map(v=>v.toString(16).padStart(2,'0')).join('')),analysisVersion:2,antialiasPixels:edgePixels,contentPartialPixels:contentPartial,notice:discrete&&!contentTransparency?'已识别实色 Logo；透明背景与文字平滑边缘不计为内容渐变或半透明。':'检测结果需核对；透明背景和文字平滑边缘与内容半透明分别判断。'};
}
export async function makeProduction(preview,elements,options){
 const {data:source,info}=await sharp(preview,{limitInputPixels:16000000}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const W=info.width,H=info.height;
 const rects=elements.map(z=>({l:Math.floor(z.x*W+1e-7),t:Math.floor(z.y*H+1e-7),r:Math.min(W,Math.ceil((z.x+z.width)*W-1e-7)),b:Math.min(H,Math.ceil((z.y+z.height)*H-1e-7))}));
 const left=Math.min(...rects.map(r=>r.l)),top=Math.min(...rects.map(r=>r.t)),right=Math.max(...rects.map(r=>r.r)),bottom=Math.max(...rects.map(r=>r.b)),width=right-left,height=bottom-top;
 if(!width||!height)fail('选区为空');const out=Buffer.alloc(width*height*4);let visible=0;
 for(const r of rects)for(let y=r.t;y<r.b;y++)for(let x=r.l;x<r.r;x++){
  const si=(y*W+x)*4,oi=((y-top)*width+x-left)*4;source.copy(out,oi,si,si+4);
  if(options.backgroundRemovalMode==='WHITE'){
   const m=Math.min(out[oi],out[oi+1],out[oi+2]),threshold=255-options.tolerance;
   if(m>=threshold)out[oi+3]=0;
  }
 }
 for(let i=3;i<out.length;i+=4)if(out[i])visible++;
 if(!visible)fail('处理结果完全透明，请检查所选元素或去白底容差');
 const composition=await sharp(out,{raw:{width,height,channels:4}}).png().toBuffer();
 const analysis=analyzePixels(out,width,height),parse=s=>[1,3,5].map(i=>parseInt(s.slice(i,i+2),16));
 if(options.colorMode==='SINGLE'){const c=parse(options.primaryColor);for(let i=0;i<out.length;i+=4)if(out[i+3]){out[i]=c[0];out[i+1]=c[1];out[i+2]=c[2];}}
 if(options.colorMode==='DOUBLE'){
  // Deterministic two-means clustering changes RGB only; alpha and coordinates stay intact.
  const points=[];const stride=Math.max(1,Math.floor(width*height/50000));for(let p=0;p<width*height;p+=stride){const i=p*4;if(out[i+3]>0)points.push([out[i],out[i+1],out[i+2]]);}
  let a=points[0],b=points.reduce((best,p)=>dist(p,a)>dist(best,a)?p:best,a);
  for(let it=0;it<8;it++){const sums=[[0,0,0,0],[0,0,0,0]];for(const p of points){const s=sums[dist(p,a)<=dist(p,b)?0:1];for(let k=0;k<3;k++)s[k]+=p[k];s[3]++;}if(sums[0][3])a=sums[0].slice(0,3).map(v=>v/sums[0][3]);if(sums[1][3])b=sums[1].slice(0,3).map(v=>v/sums[1][3]);}
  if(a.reduce((s,v)=>s+v,0)>b.reduce((s,v)=>s+v,0))[a,b]=[b,a];const ca=parse(options.primaryColor),cb=parse(options.secondaryColor);
  for(let i=0;i<out.length;i+=4)if(out[i+3]){const c=dist([out[i],out[i+1],out[i+2]],a)<=dist([out[i],out[i+1],out[i+2]],b)?ca:cb;out[i]=c[0];out[i+1]=c[1];out[i+2]=c[2];}
 }
 const colors=new Set();for(let i=0;i<out.length;i+=4)if(out[i+3]){colors.add(out[i]+','+out[i+1]+','+out[i+2]);if(colors.size>256)break;}
 const png=await sharp(out,{raw:{width,height,channels:4}}).png().toBuffer();
 return {png,composition,width,height,analysis,colorCount:options.colorMode==='ORIGINAL'?analysis.estimatedColorCount:colors.size,crop:{left,top,width,height}};
}
