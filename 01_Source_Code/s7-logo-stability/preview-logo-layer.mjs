export function renderTintedLogoLayer({createCanvas,logoImage,width,height,color}){
  const canvas=createCanvas(Math.max(1,Math.round(width)),Math.max(1,Math.round(height)));
  const context=canvas.getContext('2d');
  context.drawImage(logoImage,0,0,canvas.width,canvas.height);
  if(color){
    context.globalCompositeOperation='source-in';
    context.fillStyle=color;
    context.fillRect(0,0,canvas.width,canvas.height);
    context.globalCompositeOperation='source-over';
  }
  return canvas;
}
