import {createHash} from 'node:crypto';
import {sharp,analyzePixels} from './logo-pixels.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function normalizeLogoColor(value){
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw Object.assign(new Error('Logo 单色改色需填写六位 HEX 颜色，例如 #ffffff'),{status:400});
 return value.toLowerCase();
}
// Only RGB changes. Geometry and every alpha byte remain identical.
export async function tintCarrierLogo(bytes,color){
 color=normalizeLogoColor(color);if(!color)throw Object.assign(new Error('缺少改色颜色'),{status:400});
 const {data,info}=await sharp(bytes,{limitInputPixels:16000000}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));let visible=0,hasTransparency=false;
 for(let i=0;i<data.length;i+=4){if(!data[i+3])continue;visible++;hasTransparency||=data[i+3]<255;for(let k=0;k<3;k++)data[i+k]=rgb[k];}
 if(!visible)throw Object.assign(new Error('Logo 全透明，无法改色'),{status:400});
 const png=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
 return {png,provenance:{method:'CARRIER_LOGO_SINGLE_RGB_V1',color,sourceSha:sha(bytes),outputSha:sha(png)},observation:{hasTransparency,contentTransparency:analyzePixels(data,info.width,info.height).hasTransparency,discreteColorCount:1,width:info.width,height:info.height}};
}
