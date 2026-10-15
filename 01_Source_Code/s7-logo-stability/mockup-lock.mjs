import sharp from 'sharp';

export async function lockOutsideLogo({baseImage,generatedImage,guideImage,maskImage,feather=1,useGeneratedLighting=true,foilFinish}={}){
  const baseMeta=await sharp(baseImage).metadata();
  if(!baseMeta.width||!baseMeta.height)throw Error('原图尺寸无效');
  const [base,generated,mask,guide]=await Promise.all([
    sharp(baseImage).ensureAlpha().raw().toBuffer(),
    sharp(generatedImage).resize({width:baseMeta.width,height:baseMeta.height,fit:'fill'}).ensureAlpha().raw().toBuffer(),
    (feather>0?sharp(maskImage).grayscale().blur(feather):sharp(maskImage).grayscale()).resize({width:baseMeta.width,height:baseMeta.height,fit:'fill'}).raw().toBuffer(),
    guideImage?sharp(guideImage).resize({width:baseMeta.width,height:baseMeta.height,fit:'fill'}).ensureAlpha().raw().toBuffer():null
  ]);
  const gold=guide&&useGeneratedLighting&&foilFinish==='gold';
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
      const rawFactor=generatedLuma/Math.max(1,baseLuma);
      let factor=useGeneratedLighting?Math.min(1.18,Math.max(.82,1+(rawFactor-1)*.6)):1;
      if(gold){
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
