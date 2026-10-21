export function createImagePreview({image,request=(...args)=>fetch(...args),loadImage=async src=>{const loaded=new Image();loaded.src=src;await loaded.decode();},makeUrl=blob=>URL.createObjectURL(blob),dropUrl=url=>URL.revokeObjectURL(url),onStatus=()=>{}}){
 let revision=0,pending=null,currentUrl=null;
 function close(){
  revision++;pending?.abort();pending=null;image.hidden=true;image.removeAttribute('src');
  if(currentUrl)dropUrl(currentUrl);currentUrl=null;
 }
 async function show(url,fallbackSrc){
  close();const token=revision,controller=new AbortController();pending=controller;
  if(fallbackSrc){image.src=fallbackSrc;image.hidden=false;}
  onStatus('loading','正在读取原图…');
  const timer=setTimeout(()=>controller.abort(),30000);let candidate=null;
  try{
   if(/^(?:data:|blob:)/.test(url)){await loadImage(url);if(token!==revision)return;image.src=url;image.hidden=false;onStatus('ready');return;}
   const response=await request(url,{signal:controller.signal});if(token!==revision)return;
   if(!response.ok)throw Error(response.status===401?'登录已失效，请重新登录后重试':'原图读取失败，请点击重试');
   const blob=await response.blob();if(token!==revision)return;
   candidate=makeUrl(blob);await loadImage(candidate);if(token!==revision)return;
   image.src=candidate;image.hidden=false;currentUrl=candidate;candidate=null;onStatus('ready');
  }catch(error){if(token===revision)onStatus('error',controller.signal.aborted?'原图读取超时，请点击重试':error.message||'原图读取失败，请点击重试');}
  finally{clearTimeout(timer);if(candidate)dropUrl(candidate);if(pending===controller)pending=null;}
 }
 return {show,close};
}
