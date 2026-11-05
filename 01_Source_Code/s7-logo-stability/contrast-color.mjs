export function chooseContrastColor({data,width,height,channels=4,left=0,top=0,boxWidth=width,boxHeight=height,logo,rotation=0,quad,curve=0}={}){
  if(!data||!width||!height||boxWidth<=0||boxHeight<=0)throw Error('无法判断 Logo 表面颜色');
  const startX=Math.max(0,Math.floor(left)),startY=Math.max(0,Math.floor(top));
  const endX=Math.min(width,Math.ceil(left+boxWidth)),endY=Math.min(height,Math.ceil(top+boxHeight));
  let luminance=0,count=0;
  function sample(x,y,weight=1){
    x=Math.floor(x);y=Math.floor(y);
    if(x<0||y<0||x>=width||y>=height||!weight)return;
    const index=(y*width+x)*channels;
    const alpha=(channels>=4?data[index+3]/255:1)*weight;
    luminance+=(.2126*data[index]+.7152*data[index+1]+.0722*data[index+2])*alpha;
    count+=alpha;
  }
  if(logo){
    let matrix;
    if(quad){
      const [p0,p1,p2,p3]=quad,dx1=p1.x-p2.x,dx2=p3.x-p2.x,dx3=p0.x-p1.x+p2.x-p3.x,dy1=p1.y-p2.y,dy2=p3.y-p2.y,dy3=p0.y-p1.y+p2.y-p3.y;
      const determinant=dx1*dy2-dx2*dy1;
      if(Math.abs(determinant)<1e-12)throw Error('无法判断 Logo 表面颜色');
      const g=(dx3*dy2-dx2*dy3)/determinant,h=(dx1*dy3-dx3*dy1)/determinant;
      matrix=[p1.x-p0.x+g*p1.x,p3.x-p0.x+h*p3.x,p0.x,p1.y-p0.y+g*p1.y,p3.y-p0.y+h*p3.y,p0.y,g,h];
    }
    const radians=rotation*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
    for(let y=0;y<logo.height;y++)for(let x=0;x<logo.width;x++){
      const alpha=logo.data[(y*logo.width+x)*4+3]/255;if(!alpha)continue;
      let u=matrix?x/Math.max(1,logo.width-1):(x+.5)/logo.width;
      if(curve){const theta=curve*1.15;u=(1+Math.sin((u*2-1)*theta)/Math.sin(theta))/2;}
      if(matrix){
        const v=y/Math.max(1,logo.height-1),divisor=matrix[6]*u+matrix[7]*v+1;
        if(Math.abs(divisor)<1e-12)continue;
        sample((matrix[0]*u+matrix[1]*v+matrix[2])/divisor*width,(matrix[3]*u+matrix[4]*v+matrix[5])/divisor*height,alpha);
      }else{
        const dx=(u-.5)*boxWidth,dy=((y+.5)/logo.height-.5)*boxHeight;
        sample(left+boxWidth/2+dx*cos-dy*sin,top+boxHeight/2+dx*sin+dy*cos,alpha);
      }
    }
  }else{
    for(let y=startY;y<endY;y+=2)for(let x=startX;x<endX;x+=2)sample(x,y);
  }
  if(!count)throw Error('无法判断 Logo 表面颜色');
  return luminance/count<145?'#FFFFFF':'#000000';
}
