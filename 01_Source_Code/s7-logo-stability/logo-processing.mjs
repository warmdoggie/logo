import sharp from 'sharp';

function nearWhite(data,index,threshold){
  const r=data[index],g=data[index+1],b=data[index+2],a=data[index+3];
  return a===0||(r>=255-threshold&&g>=255-threshold&&b>=255-threshold&&Math.max(r,g,b)-Math.min(r,g,b)<=threshold);
}

function removeEdgeWhite(data,width,height,threshold){
  const visited=new Uint8Array(width*height),queue=[];
  const add=(x,y)=>{if(x<0||x>=width||y<0||y>=height)return;const p=y*width+x;if(visited[p]||!nearWhite(data,p*4,threshold))return;visited[p]=1;queue.push(p);};
  for(let x=0;x<width;x++){add(x,0);add(x,height-1);}
  for(let y=0;y<height;y++){add(0,y);add(width-1,y);}
  for(let cursor=0;cursor<queue.length;cursor++){
    const p=queue[cursor],x=p%width,y=Math.floor(p/width),i=p*4;
    data[i+3]=0;
    add(x-1,y);add(x+1,y);add(x,y-1);add(x,y+1);
  }
}

export async function processLogo(source,{removeWhiteBackground=true,cropTransparentBounds=true,threshold=24}={}){
  if(!Number.isInteger(threshold)||threshold<0||threshold>255)throw Error('去底阈值必须是0到255');
  const {data,info}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  if(removeWhiteBackground)removeEdgeWhite(data,info.width,info.height,threshold);
  let left=info.width,top=info.height,right=-1,bottom=-1;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  if(right<0)throw Error('加工后Logo没有可见像素');
  const image=sharp(data,{raw:{width:info.width,height:info.height,channels:4}});
  if(cropTransparentBounds)return image.extract({left,top,width:right-left+1,height:bottom-top+1}).png().toBuffer();
  return image.png().toBuffer();
}
