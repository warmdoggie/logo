import {foilPalettes,laserFoilColor,foilBrightness} from './foil-finishes.mjs';
export function renderTintedLogoLayer({createCanvas,logoImage,width,height,color,finish='flat'}){
  const canvas=createCanvas(Math.max(1,Math.round(width)),Math.max(1,Math.round(height)));
  const context=canvas.getContext('2d');
  context.drawImage(logoImage,0,0,canvas.width,canvas.height);
  if(color&&finish==='laser'){
    const pixels=context.getImageData(0,0,canvas.width,canvas.height);
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
      const offset=(y*canvas.width+x)*4,tone=laserFoilColor((x+.5)/canvas.width,(y+.5)/canvas.height);
      const brightness=foilBrightness(x,y,canvas.width,canvas.height,finish);
      pixels.data[offset]=Math.round(tone.r*brightness);
      pixels.data[offset+1]=Math.round(tone.g*brightness);
      pixels.data[offset+2]=Math.round(tone.b*brightness);
    }
    context.putImageData(pixels,0,0);
    return canvas;
  }
  if(color){
    context.globalCompositeOperation='source-in';
    context.fillStyle=color;
    const tones=foilPalettes[finish];
    if(tones){
      const gradient=context.createLinearGradient(0,0,canvas.width,canvas.height*.25);
      const positions=[0,.38,.62,1];
      positions.forEach((position,index)=>gradient.addColorStop(position,tones[index]));
      context.fillStyle=gradient;
    }
    context.fillRect(0,0,canvas.width,canvas.height);
    context.globalCompositeOperation='source-over';
  }
  return canvas;
}
