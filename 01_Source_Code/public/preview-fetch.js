export async function fetchPreview(url,{signal}={}){
 let response;
 try{
  response=await fetch(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)});
  if(!response.ok&&response.redirected)throw Error('OSS preview unavailable');
  if(response.redirected&&!(Number(response.headers.get('x-oss-meta-image-width'))>0&&Number(response.headers.get('x-oss-meta-image-height'))>0))throw Error('OSS preview metadata unavailable');
  const bytes=await response.blob();response=new Response(bytes,{status:response.status,headers:response.headers});
 }catch(error){
  if(signal?.aborted)throw error;
  response=await fetch(url+(url.includes('?')?'&':'?')+'local=1',{signal});
 }
 if(response.headers.has('x-oss-meta-image-width')){
  const headers=new Headers(response.headers);
  headers.set('X-Image-Width',headers.get('x-oss-meta-image-width'));
  headers.set('X-Image-Height',headers.get('x-oss-meta-image-height'));
  return new Response(response.body,{status:response.status,headers});
 }
 return response;
}

export function installPreviewImageFallback(document,origin){
 document.addEventListener('error',event=>{
  const image=event.target;if(image?.tagName!=='IMG')return;
  const url=new URL(image.getAttribute('src')||'',origin);
  if(url.origin!==origin||!(/^\/files\//.test(url.pathname)||/^\/api\/logo-library\/[^/]+\/image$/.test(url.pathname))||url.searchParams.has('local')||!(url.searchParams.get('preview')==='1'||url.searchParams.get('thumbnail')==='1'))return;
  url.searchParams.set('local','1');image.src=url.pathname+url.search;
 },true);
}
