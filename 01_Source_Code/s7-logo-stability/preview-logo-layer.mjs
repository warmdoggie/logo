import {foilPalettes} from './foil-finishes.mjs';
export function renderTintedLogoLayer({createCanvas,logoImage,width,height,color,finish='flat'}){
  const canvas=createCanvas(Math.max(1,Math.round(width)),Math.max(1,Math.round(height)));
  const context=canvas.getContext('2d');
  context.drawImage(logoImage,0,0,canvas.width,canvas.height);
  if(color){
    context.globalCompositeOperation='source-in';
    context.fillStyle=color;
    const tones=foilPalettes[finish];
    if(tones){
      const gradient=context.createLinearGradient(0,0,canvas.width,canvas.height*.25);
      const positions=finish==='laser'?[0,.25,.5,.75,1]:[0,.38,.62,1];
      positions.forEach((position,index)=>gradient.addColorStop(position,tones[index]));
      context.fillStyle=gradient;
    }
    context.fillRect(0,0,canvas.width,canvas.height);
    context.globalCompositeOperation='source-over';
  }
  return canvas;
}
