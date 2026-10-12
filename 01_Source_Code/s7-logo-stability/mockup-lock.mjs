import sharp from 'sharp';

export async function lockOutsideLogo({baseImage,generatedImage,guideImage,maskImage,feather=1}={}){
  const baseMeta=await sharp(baseImage).metadata();
  if(!baseMeta.width||!baseMeta.height)throw Error('原图尺寸无效');
  const [base,generated,mask,guide]=await Promise.all([
    sharp(baseImage).ensureAlpha().raw().toBuffer(),
    sharp(generatedImage).resize({width:baseMeta.width,height:baseMeta.height,fit:'fill'}).ensureAlpha().raw().toBuffer(),
    (feather>0?sharp(maskImage).grayscale().blur(feather):sharp(maskImage).grayscale()).resize({width:baseMeta.width,height:baseMeta.height,fit:'fill'}).raw().toBuffer(),
    guideImage?sharp(guideImage).resize({width:baseMeta.width,height:baseMeta.height,fit:'fill'}).ensureAlpha().raw().toBuffer():null
  ]);
  const output=Buffer.alloc(base.length);
  for(let i=0;i<baseMeta.width*baseMeta.height;i++){
    const offset=i*4,alpha=mask[i]/255;
    if(guide&&alpha>0){
      const baseLuma=.2126*base[offset]+.7152*base[offset+1]+.0722*base[offset+2];
      const generatedLuma=.2126*generated[offset]+.7152*generated[offset+1]+.0722*generated[offset+2];
      const factor=Math.min(1.3,Math.max(.7,generatedLuma/Math.max(1,baseLuma)));
      output[offset]=Math.round(guide[offset]*factor*alpha+base[offset]*(1-alpha));
      output[offset+1]=Math.round(guide[offset+1]*factor*alpha+base[offset+1]*(1-alpha));
      output[offset+2]=Math.round(guide[offset+2]*factor*alpha+base[offset+2]*(1-alpha));
    }else{
      output[offset]=Math.round(base[offset]*(1-alpha)+generated[offset]*alpha);
      output[offset+1]=Math.round(base[offset+1]*(1-alpha)+generated[offset+1]*alpha);
      output[offset+2]=Math.round(base[offset+2]*(1-alpha)+generated[offset+2]*alpha);
    }
    output[offset+3]=base[offset+3];
  }
  return sharp(output,{raw:{width:baseMeta.width,height:baseMeta.height,channels:4}}).png().toBuffer();
}
