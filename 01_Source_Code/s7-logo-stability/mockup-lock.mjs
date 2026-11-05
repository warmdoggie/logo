import sharp from 'sharp';

function silverPatch(x,y){
  const u=x/3,v=y/2,left=Math.floor(u),top=Math.floor(v);
  const noise=(a,b)=>{
    let hash=Math.imul(a+1,374761393)^Math.imul(b+1,668265263);
    hash=Math.imul(hash^(hash>>>13),1274126177);hash^=hash>>>16;
    return (hash>>>0)/4294967295-.5;
  };
  const fx=(u-left)**2*(3-2*(u-left)),fy=(v-top)**2*(3-2*(v-top));
  return (noise(left,top)*(1-fx)+noise(left+1,top)*fx)*(1-fy)+(noise(left,top+1)*(1-fx)+noise(left+1,top+1)*fx)*fy;
}

export async function lockOutsideLogo({baseImage,generatedImage,guideImage,maskImage,foilMaskImage,goldMaskImage,roseMaskImage,laserMaskImage,feather=1,useGeneratedLighting=true,foilFinish,surfaceResponse=false}={}){
  const baseMeta=await sharp(baseImage).metadata();
  if(!baseMeta.width||!baseMeta.height)throw Error('原图尺寸无效');
  const [base,generated,mask,guide]=await Promise.all([
    sharp(baseImage).ensureAlpha().raw().toBuffer(),
    sharp(generatedImage).resize({width:baseMeta.width,height:baseMeta.height,fit:'fill'}).ensureAlpha().raw().toBuffer(),
    (feather>0?sharp(maskImage).grayscale().blur(feather):sharp(maskImage).grayscale()).resize({width:baseMeta.width,height:baseMeta.height,fit:'fill'}).raw().toBuffer(),
    guideImage?sharp(guideImage).resize({width:baseMeta.width,height:baseMeta.height,fit:'fill'}).ensureAlpha().raw().toBuffer():null
  ]);
  const gold=guide&&useGeneratedLighting&&foilFinish==='gold';
  const decodeMask=image=>sharp(image).grayscale().resize({width:baseMeta.width,height:baseMeta.height,fit:'fill'}).raw().toBuffer();
  const [foilMask,goldMask,roseMask,laserMask]=await Promise.all([foilMaskImage?decodeMask(foilMaskImage):null,goldMaskImage?decodeMask(goldMaskImage):null,roseMaskImage?decodeMask(roseMaskImage):null,laserMaskImage?decodeMask(laserMaskImage):null]);
  const surfaceBase=surfaceResponse&&guide?await sharp(base,{raw:{width:baseMeta.width,height:baseMeta.height,channels:4}}).blur(Math.max(1,Math.min(16,baseMeta.width/160))).raw().toBuffer():null;
  const silverHeight=surfaceBase?await sharp(foilMask||mask,{raw:{width:baseMeta.width,height:baseMeta.height,channels:1}}).blur(.4).greyscale().raw().toBuffer():null;
  const [softMask,softGenerated]=gold?await Promise.all([
    sharp(mask,{raw:{width:baseMeta.width,height:baseMeta.height,channels:1}}).blur(.7).greyscale().raw().toBuffer(),
    sharp(generated,{raw:{width:baseMeta.width,height:baseMeta.height,channels:4}}).blur(2).raw().toBuffer()
  ]):[];
  const output=Buffer.alloc(base.length);
  for(let i=0;i<baseMeta.width*baseMeta.height;i++){
    const offset=i*4,alpha=mask[i]/255;
    if(guide&&alpha>0){
      const baseLuma=.2126*base[offset]+.7152*base[offset+1]+.0722*base[offset+2];
      const generatedLuma=.2126*generated[offset]+.7152*generated[offset+1]+.0722*generated[offset+2];
      const metallic=foilMask?foilMask[i]>0:!!foilFinish;
      const goldPixel=goldMask?goldMask[i]>0:foilFinish==='gold';
      const coloredFoil=(roseMask?roseMask[i]>0:foilFinish==='rose')||(laserMask?laserMask[i]>0:foilFinish==='laser');
      if(surfaceBase&&!goldPixel){
        const sceneLuma=.2126*surfaceBase[offset]+.7152*surfaceBase[offset+1]+.0722*surfaceBase[offset+2];
        const light=sceneLuma/255,texture=Math.max(-.035,Math.min(.035,(baseLuma-sceneLuma)/255));
        const x=i%baseMeta.width,y=Math.floor(i/baseMeta.width);
        let hash=Math.imul(x+1,374761393)^Math.imul(y+1,668265263);hash=Math.imul(hash^(hash>>>13),1274126177);hash^=hash>>>16;
        const grain=(hash>>>0)/4294967295-.5;
        // Recover the source ink at antialiased edges before compositing once.
        const core=[0,1,2].map(channel=>Math.max(0,Math.min(255,(guide[offset+channel]-base[offset+channel]*(1-alpha))/alpha)));
        if(metallic){
          // The package supplies the foil reflection; AI glyph-edge lighting is discarded.
          const peak=Math.max(1,...core),reflection=peak*(.97+light*.05+texture*.35);
          const silver=190+72*Math.tanh((reflection-205)/42),patch=silverPatch(x,y);
          // Fine irregular foil detail varies in density, while retaining bright silver reflections.
          const detail=grain*(6+10*(patch+.5))+patch*20+texture*40;
          const sample=(dx,dy)=>silverHeight[Math.max(0,Math.min(baseMeta.height-1,y+dy))*baseMeta.width+Math.max(0,Math.min(baseMeta.width-1,x+dx))]/255;
          const left=sample(-1,0),right=sample(1,0),top=sample(0,-1),bottom=sample(0,1);
          // A subpixel foil layer catches light on one edge and softly shades the opposite edge.
          // Keep both inside the glyph, without a broad bevel or an external drop shadow.
          const slope=Math.max(-1,Math.min(1,(right-left)*.65+(bottom-top)*.76));
          const rim=slope*(slope>0?28:22);
          const tone=silver+detail,highlight=tone>245?245+8*Math.tanh((tone-245)/8):tone;
          const layer=rim<0?rim*Math.min(1,Math.max(.35,(highlight-110)/80)):rim;
          // Keep silver reflections below a bright substrate, including the light-facing rim.
          const whiteSurface=Math.max(0,Math.min(1,(sceneLuma-210)/25));
          const highlightLimit=253+(sceneLuma-24-253)*whiteSurface;
          for(let channel=0;channel<3;channel++){
            const silverChannel=Math.max(0,Math.min(253,highlight+layer+(core[channel]-peak)*(coloredFoil?1:.15)));
            const visibleSilver=silverChannel-(253-highlightLimit)*Math.max(0,Math.min(1,(silverChannel-140)/80));
            output[offset+channel]=Math.round(visibleSilver*alpha+base[offset+channel]*(1-alpha));
          }
        }else{
          // An additive, restrained ink reflection remains visible even for RGB black.
          const reflection=Math.max(1,2+18*light**3+texture*28+grain*1.4);
          for(let channel=0;channel<3;channel++){
            const ink=Math.min(255,core[channel]*(.985+texture*.06)+reflection*(1-core[channel]/255));
            output[offset+channel]=Math.round(ink*alpha+base[offset+channel]*(1-alpha));
          }
        }
        output[offset+3]=base[offset+3];continue;
      }
      const rawFactor=generatedLuma/Math.max(1,baseLuma);
      let factor=useGeneratedLighting&&(!foilMask||foilMask[i]>0)?Math.min(1.18,Math.max(.82,1+(rawFactor-1)*.6)):1;
      if(gold&&(!goldMask||goldMask[i]>0)){
        const x=i%baseMeta.width,y=Math.floor(i/baseMeta.width);
        const sample=(dx,dy)=>softMask[Math.max(0,Math.min(baseMeta.height-1,y+dy))*baseMeta.width+Math.max(0,Math.min(baseMeta.width-1,x+dx))];
        // A subpixel pressed edge stays inside the source glyph; no outside shadow or dilation.
        const edge=(sample(1,0)-sample(-1,0)+sample(0,1)-sample(0,-1))/255*.09;
        let hash=Math.imul(x+1,374761393)^Math.imul(y+1,668265263);
        hash=Math.imul(hash^(hash>>>13),1274126177);hash^=hash>>>16;
        const grain=((hash>>>0)/4294967295-.5)*.05;
        const smoothLuma=.2126*softGenerated[offset]+.7152*softGenerated[offset+1]+.0722*softGenerated[offset+2];
        const detail=Math.max(-.04,Math.min(.04,(generatedLuma/Math.max(1,smoothLuma)-1)*.12));
        // Smooth compression retains tonal detail in darker foil instead of clipping it flat.
        factor=Math.max(.65,1+.24*Math.tanh((rawFactor-1)*1.3)+edge+grain+detail);
        factor=Math.min(factor,255/Math.max(1,guide[offset],guide[offset+1],guide[offset+2]));
      }
      output[offset]=Math.min(255,Math.round(guide[offset]*factor*alpha+base[offset]*(1-alpha)));
      output[offset+1]=Math.min(255,Math.round(guide[offset+1]*factor*alpha+base[offset+1]*(1-alpha)));
      output[offset+2]=Math.min(255,Math.round(guide[offset+2]*factor*alpha+base[offset+2]*(1-alpha)));
    }else{
      output[offset]=Math.round(base[offset]*(1-alpha)+generated[offset]*alpha);
      output[offset+1]=Math.round(base[offset+1]*(1-alpha)+generated[offset+1]*alpha);
      output[offset+2]=Math.round(base[offset+2]*(1-alpha)+generated[offset+2]*alpha);
    }
    output[offset+3]=base[offset+3];
  }
  return sharp(output,{raw:{width:baseMeta.width,height:baseMeta.height,channels:4}}).png().toBuffer();
}
