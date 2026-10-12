export function chooseContrastColor({data,width,height,channels=4,left=0,top=0,boxWidth=width,boxHeight=height}={}){
  if(!data||!width||!height||boxWidth<=0||boxHeight<=0)throw Error('无法判断 Logo 表面颜色');
  const startX=Math.max(0,Math.floor(left)),startY=Math.max(0,Math.floor(top));
  const endX=Math.min(width,Math.ceil(left+boxWidth)),endY=Math.min(height,Math.ceil(top+boxHeight));
  let luminance=0,count=0;
  for(let y=startY;y<endY;y+=2)for(let x=startX;x<endX;x+=2){
    const index=(y*width+x)*channels;
    const alpha=channels>=4?data[index+3]/255:1;
    if(alpha===0)continue;
    luminance+=(.2126*data[index]+.7152*data[index+1]+.0722*data[index+2])*alpha;
    count+=alpha;
  }
  if(!count)throw Error('无法判断 Logo 表面颜色');
  return luminance/count<145?'#FFFFFF':'#000000';
}
