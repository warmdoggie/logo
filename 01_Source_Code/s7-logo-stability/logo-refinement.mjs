import sharp from 'sharp';

const distance=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;

function isInkShade(rgb,ink){
  return [0,255].some(background=>{
    const direction=ink.map(c=>c-background),magnitude=direction.reduce((sum,c)=>sum+c*c,0);
    if(!magnitude)return distance(rgb,ink)<=32**2;
    const coverage=Math.max(0,Math.min(1,direction.reduce((sum,c,i)=>sum+c*(rgb[i]-background),0)/magnitude));
    return distance(rgb,direction.map(c=>background+c*coverage))<=32**2;
  });
}

function flatPalette(data){
  const bins=new Map();
  for(let i=0;i<data.length;i+=4){
    if(data[i+3]<240)continue;
    const key=(data[i]>>4)*256+(data[i+1]>>4)*16+(data[i+2]>>4);
    let bin=bins.get(key);
    if(!bin){bin={sum:[0,0,0],count:0,first:[...data.subarray(i,i+3)],exact:true};bins.set(key,bin);}
    if(distance(bin.first,data.subarray(i,i+3)))bin.exact=false;
    for(let c=0;c<3;c++)bin.sum[c]+=data[i+c];
    bin.count++;
  }
  const groups=[];
  for(const bin of [...bins.values()].sort((a,b)=>b.count-a.count)){
    const rgb=bin.sum.map(v=>v/bin.count);
    const group=groups.find(value=>distance(value.rgb,rgb)<=(value.exact&&bin.exact?24:64)**2);
    if(group){
      group.count+=bin.count;
      group.exact=group.exact&&bin.exact;
      for(let c=0;c<3;c++){group.sum[c]+=bin.sum[c];group.rgb[c]=group.sum[c]/group.count;}
    }else groups.push({rgb,sum:[...bin.sum],count:bin.count,exact:bin.exact});
  }
  // Ignore rare compression colors when deciding whether this is flat artwork.
  const total=groups.reduce((sum,group)=>sum+group.count,0);
  const dominant=groups[0];
  const significant=groups.filter(group=>group.count>=Math.max(1,total*.03)||dominant.count<total*.9||!isInkShade(group.rgb,dominant.rgb));
  if(significant.length>16)return [];
  return significant.map(group=>group.rgb.map(Math.round));
}

function clearSpecks(alpha,data,width,height){
  const seen=new Uint8Array(alpha.length);
  for(let p=0;p<alpha.length;p++){
    if(seen[p]||alpha[p]<32)continue;
    const pixels=[p];seen[p]=1;
    for(let cursor=0;cursor<pixels.length;cursor++){
      const x=pixels[cursor]%width,y=Math.floor(pixels[cursor]/width);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const nx=x+dx,ny=y+dy,next=ny*width+nx;
        if(nx<0||nx>=width||ny<0||ny>=height||seen[next]||alpha[next]<32)continue;
        seen[next]=1;pixels.push(next);
      }
    }
    if(pixels.length<=3){
      // Keep tiny letter dots aligned with a nearby vertical stroke.
      const letterDot=pixels.some(index=>{
        const x=index%width,y=Math.floor(index/width);
        for(const direction of [-1,1])for(let gap=2;gap<=6;gap++){
          const rows=[gap,gap+1,gap+2].map(offset=>y+direction*offset);
          if(!rows.every(row=>row>=0&&row<height&&alpha[row*width+x]>128&&distance(data.subarray(index*4,index*4+3),data.subarray((row*width+x)*4,(row*width+x)*4+3))<=48**2))continue;
          const spans=rows.map(row=>{
            let left=x,right=x;
            while(left>0&&alpha[row*width+left-1]>128)left--;
            while(right<width-1&&alpha[row*width+right+1]>128)right++;
            return [left,right];
          });
          if(spans.every(([left,right])=>left===spans[0][0]&&right===spans[0][1]))return true;
        }
        return false;
      });
      if(!letterDot)for(const index of pixels)alpha[index]=0;
    }
  }
  // Faint coverage belongs only to the immediate antialias fringe of retained ink.
  for(let p=0;p<alpha.length;p++){
    if(!alpha[p]||alpha[p]>=32)continue;
    const x=p%width,y=Math.floor(p/width);
    let supported=false;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const nx=x+dx,ny=y+dy;
      if(nx>=0&&nx<width&&ny>=0&&ny<height&&alpha[ny*width+nx]>=32)supported=true;
    }
    if(!supported)alpha[p]=0;
  }
}

function edgeColor(data,width,height,x,y){
  const index=(y*width+x)*4;
  if(data[index+3]>=240)return index;
  let best=data[index+3]?index:-1,score=Infinity;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    const px=x+dx,py=y+dy;
    if(px<0||px>=width||py<0||py>=height)continue;
    const candidate=(py*width+px)*4;
    if(data[candidate+3]<240)continue;
    if(data[index+3]){
      const rgb=[...data.subarray(index,index+3)],core=[...data.subarray(candidate,candidate+3)],a=data[index+3]/255;
      const whiteMatte=core.map(c=>c*a+255*(1-a));
      if(distance(rgb,core)>32**2&&distance(rgb,whiteMatte)>32**2)continue;
    }
    const next=dx*dx+dy*dy;
    if(next<score){best=candidate;score=next;}
  }
  return best;
}

export async function refineTransparentLogo(bytes,{targetColor='#000000'}={}){
  if(!['#000000','original'].includes(targetColor))throw Error('Logo 加工颜色选项无效');
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {width,height}=info,alpha=Buffer.alloc(width*height);
  for(let p=0;p<alpha.length;p++)alpha[p]=data[p*4+3]<=8?0:data[p*4+3];
  clearSpecks(alpha,data,width,height);
  const soft=await sharp(alpha,{raw:{width,height,channels:1}}).blur(.65).toColourspace('b-w').raw().toBuffer();
  const palette=targetColor==='original'?flatPalette(data):[],out=Buffer.alloc(data.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x,i=p*4;
    const filtered=Math.max(0,Math.min(255,(soft[p]-20)*255/215));
    // Retain some original coverage so a one-pixel stroke cannot be blurred away.
    const coverage=Math.abs(soft[p]-alpha[p])<=1?alpha[p]:Math.round(alpha[p]*.25+filtered*.75);
    if(!coverage)continue;
    out[i+3]=coverage;
    if(targetColor==='#000000')continue;
    const source=edgeColor(data,width,height,x,y);
    if(source<0){out[i+3]=0;continue;}
    let rgb=[...data.subarray(source,source+3)];
    if(palette.length){
      let closest=palette[0];
      for(const color of palette)if(distance(rgb,color)<distance(rgb,closest))closest=color;
      if(data[source+3]>=240||distance(rgb,closest)<=64**2||isInkShade(rgb,closest))rgb=closest;
    }
    out.set(rgb,i);
  }
  for(let p=0;p<alpha.length;p++)alpha[p]=out[p*4+3];
  clearSpecks(alpha,out,width,height);
  for(let p=0;p<alpha.length;p++)out[p*4+3]=alpha[p];
  return sharp(out,{raw:{width,height,channels:4}}).png().toBuffer();
}
