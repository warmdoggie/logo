import {fetchDownloadFiles} from './download-archive.mjs';

export async function saveDownloadFolder(parent,folderName,files,{request,onProgress=()=>{}}={}){
 if(!Array.isArray(files)||!files.length||files.length>200)throw Error('请选择 1–200 张图片');
 if(files.some(file=>typeof file.name!=='string'||!file.name||file.name==='.'||file.name==='..'||/[<>:"/\\|?*\u0000-\u001f]/.test(file.name))||new Set(files.map(file=>file.name.normalize('NFC').toLowerCase())).size!==files.length)throw Error('图片文件名无效，请刷新后重试');
 let base=String(folderName||'客户效果图').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,120).replace(/[. ]+$/,'')||'客户效果图';
 if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base))base='_'+base;
 if(!globalThis.navigator?.locks?.request)throw Error('当前浏览器不支持安全保存文件夹，请用最新版 Chrome 或 Edge 打开后下载。');
 const directory=await navigator.locks.request('s7-customer-download-directory',async()=>{
  for(let number=1;;number++){
   const name=base+(number===1?'':` (${number})`);
   try{await parent.getDirectoryHandle(name);}
   catch(error){if(error.name==='NotFoundError')return parent.getDirectoryHandle(name,{create:true});if(error.name!=='TypeMismatchError')throw error;}
  }
 });
 let count=0;
 try{
  await fetchDownloadFiles(files,{request,onFile:async({name,bytes})=>{
   const file=await directory.getFileHandle(name,{create:true}),writable=await file.createWritable();
   try{await writable.write(bytes);await writable.close();}catch(error){await writable.abort().catch(()=>{});throw error;}
   count++;onProgress(count,files.length);
  }});
 }catch(error){throw Error(`文件夹“${directory.name}”已保存 ${count}/${files.length} 张图片：${error.message}`,{cause:error});}
 return {name:directory.name,count};
}
