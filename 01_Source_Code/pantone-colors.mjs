import {existsSync,readFileSync} from 'node:fs';

const dataPath=new URL('./public/data/pantone-colors.json',import.meta.url);

function cleanName(value){
 return value.replace(/\bP\s+Urple\b/gi,'Purple').replace(/\bReal P\s+Urple\b/gi,'Real Purple').replace(/\s+/g,' ').trim().replace(/(\d)([CU])$/i,'$1 $2');
}

export function normalizePantoneCode(value){
 if(typeof value!=='string')return '';
 const name=cleanName(value.replace(/^\s*PANTONE\s+/i,''));
 return name?`PANTONE ${name.toUpperCase()}`:'';
}

export function rgbToHex(rgb){
 if(!Array.isArray(rgb)||rgb.length!==3||rgb.some(v=>!Number.isInteger(v)||v<0||v>255))throw new Error('RGB 必须是 0 到 255 的三个整数');
 return '#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
}

export function parsePantoneText(text){
 if(typeof text!=='string')throw new TypeError('潘通文本必须是字符串');
 const entries=[];let page=1;
 const lines=text.split(/\r?\n/);
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  page+=(line.match(/\f/g)||[]).length;
  const visible=line.replace(/\f/g,'');
  if(!visible.includes('PANTONE'))continue;
  const names=[...visible.matchAll(/PANTONE\s+(.+?)(?=\s{2,}PANTONE|$)/g)].map(m=>cleanName(m[1]));
  const rgbLine=(lines[i+1]||'').replace(/\f/g,'');
  const rgbs=[...rgbLine.matchAll(/RGB\s+(\d+)\s+(\d+)\s+(\d+)/g)].map(m=>[Number(m[1]),Number(m[2]),Number(m[3])]);
  if(names.length!==rgbs.length)throw new Error(`第 ${page} 页第 ${i+1} 行的色号与 RGB 数量不一致`);
  for(let j=0;j<names.length;j++){
   const name=names[j];
   entries.push({code:normalizePantoneCode(name),label:`PANTONE ${name}`,rgb:rgbs[j],hex:rgbToHex(rgbs[j]),sourceLabel:`PANTONE ${name}`,sourcePage:page});
  }
 }
 const counts=new Map();for(const entry of entries)counts.set(entry.code,(counts.get(entry.code)||0)+1);
 const seen=new Map();
 return entries.map(entry=>{
  const count=counts.get(entry.code);const variant=(seen.get(entry.code)||0)+1;seen.set(entry.code,variant);
  return {...entry,ambiguous:count>1,...(count>1?{variant}:{})};
 });
}

export function validatePantoneColors(colors){
 const invalid=colors.filter(entry=>{
  try{return typeof entry.code!=='string'||!entry.code.startsWith('PANTONE ')||rgbToHex(entry.rgb)!==entry.hex;}
  catch{return true;}
 }).length;
 const counts=new Map();for(const entry of colors)counts.set(entry.code,(counts.get(entry.code)||0)+1);
 const duplicateCodes=[...counts.values()].filter(count=>count>1).length;
 return {count:colors.length,invalid,duplicateCodes,ambiguousCodes:colors.filter(entry=>entry.ambiguous).map(entry=>entry.code).filter((code,index,array)=>array.indexOf(code)===index).length};
}

export function findPantoneColors(colors,query){
 const code=normalizePantoneCode(query);
 return colors.filter(entry=>entry.code===code);
}

const loaded=existsSync(dataPath)?JSON.parse(readFileSync(dataPath,'utf8')):{colors:[]};
export const pantoneColors=loaded.colors;
