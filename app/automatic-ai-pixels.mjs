import {sharp} from './logo-pixels.mjs';
import {zonePoints} from './public/zone-geometry.js';
import {tintCarrierLogo} from './carrier-colors.mjs';
import {makeBasis,quality,protectOutput} from './ai-pixels.mjs';

const png=(b,W,H)=>sharp(b,{raw:{width:W,height:H,channels:4}}).png().toBuffer();
// Use the exact SVG placement used by AutomaticOutput. AI must not choose geometry.
export async function automaticBasis(source,logo,snapshot,zones,surfaces,underlay){
 const {data:background,info}=await sharp(source,{limitInputPixels:16000000}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const W=info.width,H=info.height,mask=Buffer.alloc(W*H*4),layer=Buffer.alloc(W*H*4),parts=[];
 const transformed=surfaces.some(s=>s.surfaceType!=='FLAT');
 if(transformed&&!underlay)throw Error('表面转换缺少已核对的无 Logo 底图');
 let basis=background;
 if(transformed){const raw=await sharp(underlay).rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true});if(raw.info.width!==W||raw.info.height!==H)throw Error('转换底图尺寸不匹配');basis=raw.data;}
 const lm=await sharp(logo).metadata();
 for(const t of snapshot.targets){
  const surface=surfaces.find(s=>s.zoneId===t.zoneId);
  if(!['FLAT','PERSPECTIVE_FLAT','CYLINDER_FRONT'].includes(surface?.surfaceType)||!Number.isFinite(Number(surface.parameters?.perspective||0))||Math.abs(Number(surface.parameters?.perspective||0))>.25||!Number.isFinite(Number(surface.parameters?.curvature||0))||Number(surface.parameters?.curvature||0)<0||Number(surface.parameters?.curvature||0)>.6)throw Object.assign(Error('仅支持平面、轻透视和圆柱正面'),{code:'UNSUPPORTED_SURFACE'});
  const z=zones.find(z=>z.id===t.zoneId);if(!z||z.zoneType!=='logo')throw Error('Logo 区域不存在');
  const bytes=t.logoColor?(await tintCarrierLogo(logo,t.logoColor)).png:logo,p=t.placement;
  if(!p||![p.x,p.y,p.widthRatio,p.rotation].every(Number.isFinite)||p.widthRatio<=0)throw Error('摆放数据无效');
  const w=p.widthRatio*W,h=w*lm.height/lm.width;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><g transform="translate(${p.x*W},${p.y*H}) rotate(${p.rotation})"><image x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" href="data:image/png;base64,${bytes.toString('base64')}"/></g></svg>`;
  const localLayer=surface.surfaceType==='FLAT'?await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer():(await makeBasis(underlay,bytes,p,z,zones,surface)).layer;
  const poly=(z,fill)=>`<polygon points="${zonePoints(z,{width:W,height:H}).map(p=>`${p.x*W},${p.y*H}`).join(' ')}" fill="${fill}"/>`;
  const allowed=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="black"/>${poly(z,'white')}${zones.filter(z=>z.zoneType==='no-logo').map(z=>poly(z,'black')).join('')}</svg>`)).ensureAlpha().raw().toBuffer();
  const localMask=Buffer.alloc(W*H*4);let count=0;
  for(let i=0;i<W*H;i++){const k=i*4;if(!localLayer[k+3])continue;count++;
   if(allowed[k]<254||layer[k+3])throw Error('Logo 超出允许区、侵入禁区或与另一目标重叠');
   localLayer.copy(layer,k,k,k+4);const x=i%W,y=Math.floor(i/W);
   for(let yy=Math.max(0,y-2);yy<=Math.min(H-1,y+2);yy++)for(let xx=Math.max(0,x-2);xx<=Math.min(W-1,x+2);xx++){const q=(yy*W+xx)*4;if(allowed[q]>=254)localMask[q]=localMask[q+1]=localMask[q+2]=255;}
  }
  if(count<16)throw Error('Logo 像素过少，需设计师检查');
  if(transformed)for(let k=0;k<localLayer.length;k+=4){const a=localLayer[k+3]/255;if(a){for(let n=0;n<3;n++)basis[k+n]=Math.round(localLayer[k+n]*a+basis[k+n]*(1-a));basis[k+3]=Math.round((a+basis[k+3]/255*(1-a))*255);}}
  for(let k=0;k<mask.length;k+=4){if(localMask[k])mask[k]=mask[k+1]=mask[k+2]=255;localMask[k+3]=255;}
  parts.push({areaId:t.areaId,areaName:t.areaName,mask:localMask,layer:localLayer});
 }
 if(!parts.length)throw Error('缺少增强目标');const protect=Buffer.alloc(mask.length);
 for(let k=0;k<mask.length;k+=4){mask[k+3]=255;protect[k]=protect[k+1]=protect[k+2]=255-mask[k];protect[k+3]=255;}
 return {W,H,background:basis,basis,layer,mask,protect,parts,transformed,basisPng:transformed?await png(basis,W,H):source,maskPng:await png(mask,W,H),protectPng:await png(protect,W,H)};
}
export async function automaticQuality(candidate,b){
 await sharp(candidate,{limitInputPixels:16000000}).metadata();
 const whole=await quality(candidate,b),targets=[];
 if(whole.result==='DESIGNER_REQUIRED')return {...whole,targets};
 const raw=await sharp(candidate).ensureAlpha().raw().toBuffer();
 for(const p of b.parts){const isolated=Buffer.from(raw);for(let k=0;k<isolated.length;k+=4)if(!p.mask[k])b.basis.copy(isolated,k,k,k+4);targets.push({areaId:p.areaId,areaName:p.areaName,...await quality(await png(isolated,b.W,b.H),{...b,mask:p.mask,layer:p.layer})});}
 return {...whole,result:whole.result==='PASS'&&targets.every(t=>t.result==='PASS')?'PASS':'RETRY',targets};
}
export {protectOutput};
