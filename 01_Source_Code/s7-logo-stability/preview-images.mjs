export const previewImageUrl=url=>/^\/(?:s7\/)?api\/my-space\/(?:tasks\/[^/]+\/)?image\//.test(url)?`${url}${url.includes('?')?'&':'?'}preview=1`:url;

export function createPreviewImages({request=(...args)=>fetch(...args),makeUrl=blob=>URL.createObjectURL(blob),dropUrl=url=>URL.revokeObjectURL(url),warm=async url=>{const image=new Image();image.src=url;await image.decode();}}={}){
 const cache=new Map();let revision=0,epoch=0,currentKey=null;
 function load(url){
  const hit=cache.get(url);if(hit){cache.delete(url);cache.set(url,hit);return hit.promise;}
  const entry={src:null},generation=epoch;
  entry.promise=(async()=>{
   const response=await request(url);if(!response.ok)throw Error('图片读取失败');const blob=await response.blob();
   if(generation!==epoch)throw Error('预览已关闭');
   entry.src=makeUrl(blob);await warm(entry.src);return entry.src;
  })().catch(error=>{if(entry.src)dropUrl(entry.src);if(cache.get(url)===entry)cache.delete(url);throw error;});
  cache.set(url,entry);
  while(cache.size>32){const key=cache.keys().next().value,item=cache.get(key);cache.delete(key);item.promise.then(dropUrl,()=>{});}
  return entry.promise;
 }
 function show(key,entries,{onLoading,onReady,onError}={}){
  if(currentKey===key)return;currentKey=key;const token=++revision;
  for(const {image}of entries)image.hidden=true;
  onLoading?.();
  return (async()=>{
   const sources=await Promise.all(entries.map(entry=>entry.url?load(entry.url):null));if(token!==revision)return;
   for(let i=0;i<entries.length;i++)if(sources[i])entries[i].image.src=sources[i];
   await Promise.all(entries.map((entry,i)=>sources[i]?entry.image.decode():null));if(token!==revision)return;
   for(let i=0;i<entries.length;i++)entries[i].image.hidden=!sources[i];onReady?.();
  })().catch(error=>{if(token===revision)onError?.(error);});
 }
 function clear(){revision++;epoch++;currentKey=null;for(const entry of cache.values())if(entry.src)dropUrl(entry.src);cache.clear();}
 return {show,retry(){currentKey=null;},preload:urls=>Promise.all(urls.map(url=>load(url).catch(()=>null))),clear};
}
