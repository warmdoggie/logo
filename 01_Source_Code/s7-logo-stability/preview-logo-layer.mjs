export function renderTintedLogoLayer({createCanvas,logoImage,width,height,color,finish='flat'}){
  const canvas=createCanvas(Math.max(1,Math.round(width)),Math.max(1,Math.round(height)));
  const context=canvas.getContext('2d');
  context.drawImage(logoImage,0,0,canvas.width,canvas.height);
  if(color){
    context.globalCompositeOperation='source-in';
    context.fillStyle=color;
    if(finish==='gold'||finish==='silver'){
      const gradient=context.createLinearGradient(0,0,canvas.width,canvas.height*.25);
      const tones=finish==='gold'?['#92703B','#E9D397','#C4A052','#92703B']:['#767C84','#E7EBEF','#BFC3C9','#767C84'];
      [0,.38,.62,1].forEach((position,index)=>gradient.addColorStop(position,tones[index]));
      context.fillStyle=gradient;
    }
    context.fillRect(0,0,canvas.width,canvas.height);
    context.globalCompositeOperation='source-over';
  }
  return canvas;
}
