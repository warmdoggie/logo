import sharp from 'sharp';

function nearColor(data,index,background,threshold){
  return Math.max(Math.abs(data[index]-background[0]),Math.abs(data[index+1]-background[1]),Math.abs(data[index+2]-background[2]))<=threshold;
}

function edgeBackground(data,width,height){
  const points=[];
  for(let x=0;x<width;x++)points.push(x,0,x,height-1);
  for(let y=0;y<height;y++)points.push(0,y,width-1,y);
  for(let i=0;i<points.length;i+=2){const index=(points[i+1]*width+points[i])*4;if(data[index+3])return [data[index],data[index+1],data[index+2]];}
  return null;
}

function solidBackground(data,width,height){
  const band=Math.min(12,Math.max(1,Math.floor(Math.min(width,height)*.1))),bins=new Map();
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(x>=band&&x<width-band&&y>=band&&y<height-band)continue;
    const i=(y*width+x)*4,key=(data[i]>>4)*256+(data[i+1]>>4)*16+(data[i+2]>>4);
    let bin=bins.get(key);if(!bin){bin={sum:[0,0,0],count:0};bins.set(key,bin);}
    for(let c=0;c<3;c++)bin.sum[c]+=data[i+c];
    bin.count++;
  }
  const dominant=[...bins.values()].sort((a,b)=>b.count-a.count)[0];
  return dominant?dominant.sum.map(v=>Math.round(v/dominant.count)):null;
}

function recoverBackgroundBlend(data,width,height,background){
  const core=new Uint8Array(width*height);
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=(y*width+x)*4;
    if(!data[i+3])continue;
    let interior=true;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(!data[((y+dy)*width+x+dx)*4+3])interior=false;
    if(interior)core[y*width+x]=1;
  }
  // Recover coverage only when a pixel fits a mixture of the ink and removed background.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;
    if(!data[i+3]||core[y*width+x])continue;
    let nearest=-1,best=Infinity;
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
      const px=x+dx,py=y+dy,distance=dx*dx+dy*dy;
      if(px<0||py<0||px>=width||py>=height||!core[py*width+px]||distance>=best)continue;
      nearest=(py*width+px)*4;best=distance;
    }
    if(nearest<0)continue;
    const ink=[...data.subarray(nearest,nearest+3)],direction=ink.map((v,c)=>v-background[c]);
    const magnitude=direction.reduce((sum,v)=>sum+v*v,0);
    if(!magnitude)continue;
    const coverage=direction.reduce((sum,v,c)=>sum+(data[i+c]-background[c])*v,0)/magnitude;
    if(coverage<=0||coverage>1.05)continue;
    if(direction.some((v,c)=>Math.abs(data[i+c]-(background[c]+v*coverage))>18))continue;
    data.set(ink,i);data[i+3]=Math.min(255,Math.round(coverage*255));
  }
}

function removeEdgeBackground(data,width,height,threshold,connectedOnly=false){
  const background=edgeBackground(data,width,height),visited=new Uint8Array(width*height),queue=[];
  const add=(x,y,reference)=>{
    if(x<0||x>=width||y<0||y>=height)return;
    const p=y*width+x,index=p*4;
    if(visited[p])return;
    if(data[index+3]===0){visited[p]=1;if(!connectedOnly)queue.push(p);return;}
    if(!connectedOnly&&(!reference||!nearColor(data,index,reference,threshold)))return;
    visited[p]=1;queue.push(p);
  };
  if(!background)return;
  for(let x=0;x<width;x++){add(x,0,background);add(x,height-1,background);}
  for(let y=0;y<height;y++){add(0,y,background);add(width-1,y,background);}
  for(let cursor=0;cursor<queue.length;cursor++){
    const p=queue[cursor],x=p%width,y=Math.floor(p/width),i=p*4;
    data[i+3]=0;
    const reference=[data[i],data[i+1],data[i+2]];
    add(x-1,y,reference);add(x+1,y,reference);add(x,y-1,reference);add(x,y+1,reference);
  }
}

export async function processLogo(source,{removeWhiteBackground=true,cropTransparentBounds=true,removeInteriorBackground=false,threshold=24}={}){
  if(!Number.isInteger(threshold)||threshold<0||threshold>255)throw Error('去底阈值必须是0到255');
  const {data,info}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let hasTransparency=false;
  for(let i=3;i<data.length;i+=4)if(data[i]<255){hasTransparency=true;break;}
  if(removeWhiteBackground&&!(removeInteriorBackground&&hasTransparency)){
    const background=removeInteriorBackground?solidBackground(data,info.width,info.height):null;
    const outer=edgeBackground(data,info.width,info.height);
    const corners=[0,(info.width-1)*4,(info.height-1)*info.width*4,(info.width*info.height-1)*4];
    if(!removeInteriorBackground||outer&&corners.every(i=>nearColor(data,i,outer,threshold)))removeEdgeBackground(data,info.width,info.height,threshold);
    if(background){
      for(let i=0;i<data.length;i+=4)if(nearColor(data,i,background,threshold))data[i+3]=0;
      // A uniform screenshot frame can leave a differently colored UI fragment at its edge.
      if(outer&&corners.every(i=>nearColor(data,i,outer,threshold))&&!outer.every((v,c)=>Math.abs(v-background[c])<=threshold))removeEdgeBackground(data,info.width,info.height,threshold,true);
      recoverBackgroundBlend(data,info.width,info.height,background);
    }
  }
  let left=info.width,top=info.height,right=-1,bottom=-1;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  if(right<0)throw Error('加工后Logo没有可见像素');
  const image=sharp(data,{raw:{width:info.width,height:info.height,channels:4}});
  if(cropTransparentBounds)return image.extract({left,top,width:right-left+1,height:bottom-top+1}).png().toBuffer();
  return image.png().toBuffer();
}
