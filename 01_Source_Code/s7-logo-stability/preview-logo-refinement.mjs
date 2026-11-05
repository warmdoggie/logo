import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import {validateAiLogoOutput} from './ai-logo-processing.mjs';
import {refineTransparentLogo} from './logo-refinement.mjs';

const [sourcePath,outputPath,mode='black']=process.argv.slice(2);
if(!sourcePath||!outputPath||!['black','original'].includes(mode))throw Error('用法：node s7-logo-stability/preview-logo-refinement.mjs 输入透明PNG 输出目录 [black|original]');
const dir=resolve(outputPath),source=await readFile(resolve(sourcePath));
const {width,height}=await validateAiLogoOutput(source);
const started=performance.now(),result=await refineTransparentLogo(source,{targetColor:mode==='black'?'#000000':'original'});
const elapsedMs=Math.round(performance.now()-started);
await validateAiLogoOutput(result);
await mkdir(dir,{recursive:true});
await writeFile(join(dir,'before.png'),source);
await writeFile(join(dir,'after.png'),result);
const raw=await sharp(source).ensureAlpha().raw().toBuffer();
let left=width,top=height,right=0,bottom=0;
for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(raw[(y*width+x)*4+3]>8){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
left=Math.max(0,left-4);top=Math.max(0,top-4);right=Math.min(width-1,right+4);bottom=Math.min(height-1,bottom+4);
const bounds={left,top,width:right-left+1,height:bottom-top+1};
const zoom={left:Math.min(width-1,left+Math.floor(bounds.width*.15)),top,width:Math.min(96,width),height:Math.min(64,height)};
zoom.left=Math.min(zoom.left,width-zoom.width);zoom.top=Math.min(zoom.top,height-zoom.height);
const panels=[];
for(const [index,bytes] of [source,result].entries()){
  const full=await sharp(bytes).extract(bounds).resize(520,180,{fit:'contain',background:'#eeeeee'}).flatten({background:'#eeeeee'}).png().toBuffer();
  const detail=await sharp(bytes).extract(zoom).resize(520,320,{fit:'contain',kernel:'nearest',background:'#eeeeee'}).flatten({background:'#eeeeee'}).png().toBuffer();
  panels.push({input:full,left:20+index*550,top:64},{input:detail,left:20+index*550,top:300});
}
const labels=Buffer.from(`<svg width="1110" height="650"><style>text{font-family:Microsoft YaHei,sans-serif;fill:#222}</style><text x="20" y="35" font-size="22">处理前</text><text x="570" y="35" font-size="22">处理后 · ${mode==='black'?'统一黑色':'主色归并'}</text><text x="20" y="280" font-size="18">局部放大（两侧使用相同倍率）</text><text x="20" y="644" font-size="14">${width} × ${height} · 本地算法耗时 ${elapsedMs} ms · 灰色仅作透明背景展示</text></svg>`);
await sharp({create:{width:1110,height:660,channels:3,background:'#ffffff'}}).composite([...panels,{input:labels,left:0,top:0}]).png().toFile(join(dir,'comparison.png'));
console.log(JSON.stringify({directory:dir,width,height,elapsedMs}));
