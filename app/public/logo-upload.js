const TYPES=new Set(['image/png','image/jpeg','image/webp']);
const MAX_BYTES=32*1024*1024;

// One file selection shared by picker, drop and paste; it remains an ordinary
// multipart file field. Clipboard contents are read only from a user paste.
export function mountLogoUpload(form,{onChange=()=>{}}={}){
 const input=form.querySelector('#logo'),zone=input.closest('.dropzone'),preview=form.querySelector('#logo-preview'),submit=form.querySelector('#create-task');
 const abort=new AbortController(),urls=new Set();let current=null,previewUrl=null,revision=0,pending=false,disposed=false,dragDepth=0;
 zone.classList.add('logo-upload-zone');zone.tabIndex=0;zone.setAttribute('role','group');zone.setAttribute('aria-label','上传客户 Logo，可选择文件、拖拽或粘贴图片');
 const hint=document.createElement('p');hint.className='hint logo-upload-help';hint.textContent='选择文件，或将图片拖到这里；点击此区域后可按 Ctrl+V 粘贴图片。';
 input.before(hint);
 const status=document.createElement('p');status.className='logo-upload-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const error=document.createElement('p');error.className='error logo-upload-error';error.setAttribute('role','alert');error.hidden=true;
 const clear=document.createElement('button');clear.type='button';clear.className='btn small logo-upload-clear';clear.textContent='移除已选图片';clear.hidden=true;
 zone.append(status,error,clear);
 const listen=(el,event,fn)=>el.addEventListener(event,fn,{signal:abort.signal});
 function release(url){if(url){URL.revokeObjectURL(url);urls.delete(url);}}
 function syncFiles(file){if(!file){input.value='';return;}const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;}
 function notify(){onChange(current);clear.hidden=!current;status.textContent=current?current.name+' · '+(current.size>=1024*1024?(current.size/1024/1024).toFixed(1)+' MB':Math.max(1,Math.round(current.size/1024))+' KB'):'';}
 function ready(){pending=false;zone.removeAttribute('aria-busy');if(submit?.isConnected)submit.disabled=false;}
 function reset(){revision++;ready();current=null;syncFiles(null);release(previewUrl);previewUrl=null;preview.replaceChildren();error.hidden=true;notify();}
 function reject(message){syncFiles(current);error.textContent=message;error.hidden=false;notify();}
 async function choose(files){
  if(disposed||!form.isConnected||input.disabled||zone.hidden)return;
  const list=Array.from(files||[]),n=++revision;ready();error.hidden=true;
  if(!list.length){reset();return;}
  if(list.length!==1){reject('每次请选择一张 Logo 图片，已选图片保持不变。');return;}
  let file=list[0];
  if(!TYPES.has(file.type)){reject('请选择 PNG、JPG 或 WebP 图片。');return;}
  if(!file.size||file.size>MAX_BYTES){reject(file.size?'Logo 文件不能超过 32 MB。':'图片文件为空，请重新选择。');return;}
  if(!file.name)file=new File([file],'粘贴的Logo.'+({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[file.type]),{type:file.type,lastModified:Date.now()});
  pending=true;zone.setAttribute('aria-busy','true');submit.disabled=true;status.textContent='正在检查图片…';
  const url=URL.createObjectURL(file);urls.add(url);const img=new Image();img.src=url;
  try{
   await img.decode();
   if(disposed||n!==revision||!form.isConnected){release(url);return;}
   if(!img.naturalWidth||!img.naturalHeight)throw Error('empty image');
   syncFiles(file);current=file;release(previewUrl);previewUrl=url;img.className='preview-image';img.alt='已选客户 Logo 预览';preview.replaceChildren(img);notify();
  }catch{
   release(url);if(!disposed&&n===revision&&form.isConnected)reject('无法读取这张图片，请重新选择有效的 PNG、JPG 或 WebP。');
  }finally{if(!disposed&&n===revision)ready();}
 }
 listen(input,'change',()=>choose(input.files));
 listen(clear,'click',()=>{reset();zone.focus();});
 const isFileDrag=e=>Array.from(e.dataTransfer?.types||[]).includes('Files');
 listen(zone,'dragenter',e=>{if(input.disabled||!isFileDrag(e))return;e.preventDefault();dragDepth++;zone.classList.add('is-dragover');});
 listen(zone,'dragover',e=>{if(input.disabled||!isFileDrag(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';});
 listen(zone,'dragleave',e=>{if(!isFileDrag(e))return;e.preventDefault();if(--dragDepth<=0){dragDepth=0;zone.classList.remove('is-dragover');}});
 listen(zone,'drop',e=>{if(input.disabled||!isFileDrag(e))return;e.preventDefault();e.stopPropagation();dragDepth=0;zone.classList.remove('is-dragover');zone.focus();choose(e.dataTransfer.files);});
 listen(zone,'click',e=>{if(!e.target.closest('input,button,label,a'))zone.focus();});
 listen(document,'paste',e=>{
  if(disposed||!form.isConnected||input.disabled||zone.hidden||document.querySelector('dialog[open]'))return;
  const target=e.target instanceof Element?e.target:null;
  if(target?.closest('textarea,[contenteditable]:not([contenteditable="false"]),input:not([type="file"]):not([type="button"]):not([type="submit"])'))return;
  const files=Array.from(e.clipboardData?.items||[]).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
  if(!files.length)return;e.preventDefault();choose(files);
 });
 listen(form,'submit',e=>{if(pending){e.preventDefault();e.stopImmediatePropagation();status.textContent='图片检查中，请稍候再创建任务。';}});
 listen(form,'reset',()=>queueMicrotask(()=>{if(!disposed)reset();}));
 return {reset,dispose(){if(disposed)return;disposed=true;revision++;abort.abort();for(const url of urls)URL.revokeObjectURL(url);urls.clear();current=null;},get file(){return current;}};
}
