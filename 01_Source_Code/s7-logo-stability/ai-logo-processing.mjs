import sharp from 'sharp';

const AI_LOGO_INSTRUCTIONS=`Use the input image as the only source of the logo. Recreate the complete logo as one isolated asset. Preserve every letter, glyph, mark, spacing, proportion and edge exactly; do not redraw, translate, simplify, add or remove any logo element. Change the entire visible logo to solid pure black (#000000). Remove the entire background, including the hollow/interior areas of letters, and return a true transparent-background PNG. No white background, checkerboard pattern, shadow, glow, outline, texture, watermark or extra text.`;

const APIMART_LOGO_INSTRUCTIONS=`Image 1 is the sole source of the logo. Generate one clean isolated logo asset from it. Preserve every letter, glyph, mark, spacing, proportion and edge exactly; do not redraw, translate, simplify, add or remove any element. Change the entire visible logo to solid pure black (#000000). Output a true transparent-background PNG: the outside background and all hollow/interior letter areas must be transparent. No white background, checkerboard pattern, shadow, glow, outline, texture, watermark or extra text.`;

export function buildAiLogoRequest(logoImage,{model,targetColor='#000000'}={}){
  if(typeof logoImage!=='string'||!logoImage)throw Error('缺少 Logo 原图');
  if(typeof model!=='string'||!model.trim())throw Error('缺少 AI 图片模型');
  if(targetColor!=='#000000')throw Error('当前 AI Logo 加工只支持黑色母版');
  return {contract:'JSON_IMAGE_EDIT_V1',model:model.trim(),logoImage,targetColor,outputFormat:'png',transparentBackground:true,prompt:AI_LOGO_INSTRUCTIONS};
}

export function buildApimartLogoRequest(logoDataUrl,{model}={}){
  if(typeof logoDataUrl!=='string'||!logoDataUrl.startsWith('data:image/'))throw Error('缺少 APIMart Logo 图片');
  if(typeof model!=='string'||!model.trim())throw Error('缺少 APIMart 图片模型');
  return {model:model.trim(),n:1,size:'2K',watermark:false,enable_sequential:false,prompt:APIMART_LOGO_INSTRUCTIONS,negative_prompt:'changed lettering, missing glyphs, altered logo, extra graphics, white background, opaque interior holes, shadow, watermark',image_urls:[logoDataUrl]};
}

export async function validateAiLogoOutput(bytes){
  const metadata=await sharp(bytes).metadata();
  if(!metadata.width||!metadata.height)throw Error('AI 未返回有效 Logo 图片');
  if(!metadata.hasAlpha)throw Error('AI Logo 加工必须返回透明 PNG');
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let visible=0,transparent=0;
  for(let i=3;i<data.length;i+=4){if(data[i])visible++;else transparent++;}
  if(!visible)throw Error('AI Logo 加工结果没有可见 Logo');
  if(!transparent)throw Error('AI Logo 加工结果没有透明背景');
  return {bytes,width:info.width,height:info.height};
}
