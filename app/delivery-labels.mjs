import {sharp} from './logo-pixels.mjs';
const esc=v=>String(v??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Append a label panel; never paint over the original preview or resize it.
export async function labelDelivery(bytes,output){
 const {data:original,info:{width,height}}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true}),W=Math.max(width,800),font=Math.max(16,Math.min(30,Math.floor(W/55)));
 const s=output.snapshot,round=s.requirementVersion?String(s.requirementVersion-1):'LEGACY';
 const fields=['PREVIEW - NOT FOR PRODUCTION',`SKU: ${s.sku}`,`SCHEME ID: ${s.schemeId}`,`ROUND: ${round}  /  IMAGE VERSION: ${output.version}`,`OUTPUT ID: ${output.id}`,...(s.surfaceChanges?.length?['SURFACE COLOUR: APPROXIMATE SCREEN PREVIEW']:[])];
 const limit=Math.floor((W-48)/(font*.68)),lines=[];
 for(const field of fields){let line='',units=0;for(const ch of field){const n=ch.codePointAt(0)>127?2:1;if(units+n>limit){lines.push(line);line='';units=0;}line+=ch;units+=n;}if(line)lines.push(line);}
 const H=(lines.length+1)*(font+10)+20;
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#f3f4f6"/><path d="M0 1H${W}" stroke="#64748b"/>${lines.map((line,i)=>`<text x="24" y="${30+(i+1)*(font+10)-font}" font-family="DejaVu Sans,Microsoft YaHei,sans-serif" font-size="${font}" fill="${i?'#1f2937':'#a31b1b'}">${esc(line)}</text>`).join('')}</svg>`;
 const footer=await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer(),canvas=Buffer.alloc(W*(height+H)*4);
 for(let y=0;y<height;y++)original.copy(canvas,y*W*4,y*width*4,(y+1)*width*4);footer.copy(canvas,height*W*4);
 return sharp(canvas,{raw:{width:W,height:height+H,channels:4}}).png().toBuffer();
}
