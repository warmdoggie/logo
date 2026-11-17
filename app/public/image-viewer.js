// Shared read-only viewer for result images, product photos and library Logos.
export function mountImageViewer(){
 const dialog=document.querySelector('#image-dialog');if(!dialog||dialog.dataset.viewer)return;dialog.dataset.viewer='';dialog.classList.add('image-viewer');dialog.setAttribute('aria-labelledby','image-title');
 const css=document.createElement('link');css.rel='stylesheet';css.href='/image-viewer.css';document.head.append(css);
 dialog.innerHTML='<header class="image-viewer-header"><strong id="image-title"></strong><div class="image-viewer-tools"><button type="button" class="btn small" data-zoom="out" aria-label="缩小">−</button><output data-zoom-label aria-live="polite"></output><button type="button" class="btn small" data-zoom="in" aria-label="放大">＋</button><button type="button" class="btn small" data-zoom="actual">100%</button><button type="button" class="btn small" data-zoom="fit">适合窗口</button><button type="button" class="btn small" id="close-image" autofocus>关闭</button></div></header><div class="image-viewer-viewport" tabindex="0" aria-label="图片预览，放大后可拖动查看"><div class="image-viewer-surface"><img id="large-image" alt="" draggable="false"></div></div><p data-preview-status role="status">正在读取图片…</p>';
 const img=dialog.querySelector('img'),viewport=dialog.querySelector('.image-viewer-viewport'),status=dialog.querySelector('[data-preview-status]'),label=dialog.querySelector('[data-zoom-label]');
 let zoom=1,fit=true,ready=false,trigger=null,drag=null;
 function setZoom(next,keepCenter=true){
  if(!ready)return;const old=zoom,cx=(viewport.scrollLeft+viewport.clientWidth/2-Math.max(0,viewport.clientWidth-img.width)/2)/old,cy=(viewport.scrollTop+viewport.clientHeight/2-Math.max(0,viewport.clientHeight-img.height)/2)/old;
  zoom=Math.max(.01,Math.min(4,next));img.width=Math.max(1,Math.round(img.naturalWidth*zoom));img.height=Math.max(1,Math.round(img.naturalHeight*zoom));label.textContent=Math.round(zoom*100)+'%';
  if(keepCenter){viewport.scrollLeft=cx*zoom-viewport.clientWidth/2;viewport.scrollTop=cy*zoom-viewport.clientHeight/2;}else{viewport.scrollLeft=0;viewport.scrollTop=0;}
  dialog.querySelector('[data-zoom="in"]').disabled=zoom>=4;dialog.querySelector('[data-zoom="out"]').disabled=zoom<=.01;viewport.classList.toggle('can-pan',img.width>viewport.clientWidth||img.height>viewport.clientHeight);
 }
 function fitImage(){fit=true;setZoom(Math.min(1,(viewport.clientWidth-24)/img.naturalWidth,(viewport.clientHeight-24)/img.naturalHeight),false);}
 function close(){if(dialog.open)dialog.close();}
 dialog.querySelector('#close-image').onclick=close;
 dialog.addEventListener('close',()=>{drag=null;ready=false;img.onload=img.onerror=null;img.removeAttribute('src');if(trigger?.isConnected)trigger.focus({preventScroll:true});trigger=null;});
 dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});
 dialog.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>{if(!ready)return;if(b.dataset.zoom==='fit')return fitImage();fit=false;setZoom(b.dataset.zoom==='actual'?1:zoom*(b.dataset.zoom==='in'?1.25:.8));});
 viewport.addEventListener('wheel',e=>{if(!ready||e.ctrlKey||e.metaKey)return;e.preventDefault();fit=false;setZoom(zoom*(e.deltaY<0?1.15:1/1.15));},{passive:false});
 viewport.addEventListener('pointerdown',e=>{if(e.button!==0||!ready||drag||!viewport.classList.contains('can-pan'))return;e.preventDefault();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.setPointerCapture(e.pointerId);viewport.classList.add('panning');});
 viewport.addEventListener('pointermove',e=>{if(drag?.id!==e.pointerId)return;viewport.scrollLeft=drag.left+drag.x-e.clientX;viewport.scrollTop=drag.top+drag.y-e.clientY;});
 const end=e=>{if(drag?.id!==e.pointerId)return;drag=null;viewport.classList.remove('panning');};viewport.addEventListener('pointerup',end);viewport.addEventListener('pointercancel',end);viewport.addEventListener('lostpointercapture',end);
 new ResizeObserver(()=>{if(dialog.open&&ready&&fit)fitImage();}).observe(viewport);
 window.addEventListener('hashchange',close);
 document.addEventListener('click',e=>{
  const target=e.target.closest('[data-image]');if(!target||target.disabled)return;e.preventDefault();trigger=target;ready=false;fit=true;drag=null;
  dialog.querySelector('#image-title').textContent=target.dataset.title||'图片预览';img.alt=target.dataset.title||'图片预览';viewport.classList.toggle('show-transparency',target.hasAttribute('data-preview-checker'));viewport.classList.remove('panning','can-pan');
  status.textContent='正在读取图片…';label.textContent='';img.hidden=true;dialog.querySelectorAll('[data-zoom]').forEach(b=>b.disabled=true);
  img.onload=()=>{ready=true;img.hidden=false;dialog.querySelectorAll('[data-zoom]').forEach(b=>b.disabled=false);fitImage();status.textContent='滚轮缩放 · 放大后拖动查看 · Esc 关闭';};
  img.onerror=()=>{ready=false;img.hidden=true;status.textContent='图片暂时无法读取，请关闭后重试。';};
  if(!dialog.open)dialog.showModal();img.src='/files/'+encodeURIComponent(target.dataset.image);
 });
}
