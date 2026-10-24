import sharp from 'sharp';
import {createWorker,PSM} from 'tesseract.js';
import english from '@tesseract.js-data/eng';

const phrases=new Set(['YOURLOGO','PRIVATELABEL','LOGOHERE','CUSTOMLOGO']);
const clean=text=>String(text).toUpperCase().replace(/[^A-Z]/g,'');

export function matchPlaceholderWords(words,width,height,angle,rotatedWidth,rotatedHeight){
  const regions=[],radians=angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  for(let i=0;i<words.length;i++)for(let count=1;count<=3&&i+count<=words.length;count++){
    const sequence=words.slice(i,i+count);
    if(!phrases.has(sequence.map(word=>clean(word.text)).join(''))||sequence[0].confidence<60||sequence.reduce((sum,word)=>sum+word.confidence,0)/count<45)continue;
    if(sequence.some((word,index)=>{
      if(!index)return false;const a=sequence[index-1].bbox,b=word.bbox,h=Math.max(a.y1-a.y0,b.y1-b.y0);
      return Math.abs((a.y0+a.y1-b.y0-b.y1)/2)>h*.65||b.x0-a.x1>h*2||b.x0<a.x0;
    }))continue;
    const boxes=sequence.map(word=>word.bbox),padding=Math.max(3,Math.max(...boxes.map(box=>box.y1-box.y0))*.1);
    const left=Math.min(...boxes.map(box=>box.x0))-padding,top=Math.min(...boxes.map(box=>box.y0))-padding,right=Math.max(...boxes.map(box=>box.x1))+padding,bottom=Math.max(...boxes.map(box=>box.y1))+padding;
    const points=[[left,top],[right,top],[right,bottom],[left,bottom]].map(([x,y])=>({x:c*(x-rotatedWidth/2)+s*(y-rotatedHeight/2)+width/2,y:-s*(x-rotatedWidth/2)+c*(y-rotatedHeight/2)+height/2}));
    const x=Math.max(0,Math.min(...points.map(point=>point.x))),y=Math.max(0,Math.min(...points.map(point=>point.y))),x1=Math.min(width,Math.max(...points.map(point=>point.x))),y1=Math.min(height,Math.max(...points.map(point=>point.y)));
    if(x1>x&&y1>y&&(x1-x)*(y1-y)/(width*height)<=.15)regions.push({x:x/width,y:y/height,width:(x1-x)/width,height:(y1-y)/height,text:sequence.map(word=>word.text).join(' ')});
  }
  return regions;
}

export async function detectPlaceholders(source){
  const metadata=await sharp(source).metadata();
  const {data:base,info}=await sharp(source).resize({width:1800,height:1800,fit:'inside',withoutEnlargement:false}).flatten({background:'white'}).png().toBuffer({resolveWithObject:true});
  const worker=await createWorker('eng',1,{langPath:english.langPath,gzip:true,cacheMethod:'none'});
  const regions=[];
  try{
    await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,user_defined_dpi:'150'});
    const passes=[...[70,210].flatMap(threshold=>[0,90,270,180].map(angle=>({angle,threshold}))),...[0,90,270,180,45,135,225,315,10,350,80,100,260,280].map(angle=>({angle}))];
    for(const {angle,threshold} of passes){
      let pipeline=sharp(base);if(threshold)pipeline=pipeline.greyscale().threshold(threshold);
      const {data:rotated,info:dimensions}=await pipeline.rotate(angle,{background:'white'}).png().toBuffer({resolveWithObject:true});
      const result=await worker.recognize(rotated,{}, {blocks:true,text:true});
      const words=(result.data.blocks||[]).flatMap(block=>(block.paragraphs||[]).flatMap(paragraph=>(paragraph.lines||[]).flatMap(line=>line.words||[])));
      const candidates=matchPlaceholderWords(words,info.width,info.height,angle,dimensions.width,dimensions.height);
      // Reflective tube edges can join the word LOGO. Re-read a tight line crop
      // beside a clearly recognized YOUR rather than selecting the whole edge.
      for(const word of words.filter(word=>clean(word.text)==='YOUR'&&word.confidence>=70)){
        const box=word.bbox,h=box.y1-box.y0,left=Math.max(0,Math.floor(box.x0-h*.2)),top=Math.max(0,Math.floor(box.y0-h*.3));
        const width=Math.min(dimensions.width-left,Math.ceil((box.x1-box.x0)*2.35)),height=Math.min(dimensions.height-top,Math.ceil(h*1.6));
        const crop=await sharp(rotated).extract({left,top,width,height}).png().toBuffer();
        await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE});
        const reread=await worker.recognize(crop,{}, {blocks:true,text:true});
        await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
        const localWords=(reread.data.blocks||[]).flatMap(block=>(block.paragraphs||[]).flatMap(paragraph=>(paragraph.lines||[]).flatMap(line=>line.words||[]))).map(word=>({...word,bbox:{x0:word.bbox.x0+left,y0:word.bbox.y0+top,x1:word.bbox.x1+left,y1:word.bbox.y1+top}}));
        candidates.push(...matchPlaceholderWords(localWords,info.width,info.height,angle,dimensions.width,dimensions.height));
      }
      for(const region of candidates){
        const duplicate=regions.some(existing=>{
          const intersection=Math.max(0,Math.min(existing.x+existing.width,region.x+region.width)-Math.max(existing.x,region.x))*Math.max(0,Math.min(existing.y+existing.height,region.y+region.height)-Math.max(existing.y,region.y));
          return intersection/Math.min(existing.width*existing.height,region.width*region.height)>.55;
        });
        if(!duplicate)regions.push(region);
      }
    }
    const margin=Math.max(2,Math.min(6,Math.min(metadata.width,metadata.height)*.01));
    return regions.map(region=>{
      const x=Math.max(0,region.x-margin/metadata.width),y=Math.max(0,region.y-margin/metadata.height);
      return {...region,x,y,width:Math.min(1,region.x+region.width+margin/metadata.width)-x,height:Math.min(1,region.y+region.height+margin/metadata.height)-y};
    });
  }finally{await worker.terminate();}
}
