import sharp from 'sharp';
import {renderLogoSet} from './index.mjs';
import {pickAspectRatio} from './ai-mockup-generation.mjs';

const dataUrl=bytes=>`data:image/png;base64,${bytes.toString('base64')}`;
export async function prepareGenerationImage({baseImage,logoImage,targets,schemes,model,selectedVersions,originalColor='#000000',finishReferenceImage}){
 const base=await sharp(baseImage).png().toBuffer(),logo=await sharp(logoImage).metadata();
 const guideSet=await renderLogoSet({baseImage:base,logoImage,targets,schemes,originalColor});
 return {
  metadata:{width:guideSet.width,height:guideSet.height,targetIds:guideSet.targetIds,layoutFingerprint:guideSet.layoutFingerprint},
  input:{baseImage:dataUrl(base),logoImage:dataUrl(logoImage),model,targets,schemes,selectedVersions,originalColor,
   ...(finishReferenceImage?{finishReferenceImage:`data:image/png;base64,${finishReferenceImage}`}:{ }),
   maskImage:dataUrl(guideSet.mask),logoAspectRatio:logo.height/logo.width,size:pickAspectRatio(guideSet.width,guideSet.height),
   guides:guideSet.outputs.map(output=>({version:output.version,dataUrl:dataUrl(output.bytes),maskDataUrl:dataUrl(output.mask),foilMaskDataUrl:dataUrl(output.foilMask),goldMaskDataUrl:dataUrl(output.goldMask)}))}
 };
}
