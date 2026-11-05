const toolbar=document.querySelector('#target-toolbar');
const body=document.querySelector('#target-toolbar-body');
const toggle=document.querySelector('#toggle-target-toolbar');
const handle=document.querySelector('#target-toolbar-drag');
const canvas=document.querySelector('.canvas-wrap');
const targets=document.querySelector('#targets');
const summary=document.querySelector('#target-toolbar-summary');
let moved=false,drag=null;

function place(left,top){
  const rect=toolbar.getBoundingClientRect();
  toolbar.style.left=`${Math.max(12,Math.min(left,window.innerWidth-rect.width-12))}px`;
  toolbar.style.top=`${Math.max(12,Math.min(top,window.innerHeight-rect.height-12))}px`;
}
function position(){
  const rect=toolbar.getBoundingClientRect(),anchor=canvas.getBoundingClientRect();
  place(moved?rect.left:anchor.left+(anchor.width-rect.width)/2,moved?rect.top:anchor.top+16);
}
function setExpanded(expanded){
  closeMenus();
  body.hidden=!expanded;
  toolbar.classList.toggle('expanded',expanded);
  toggle.setAttribute('aria-expanded',String(expanded));
  toggle.innerHTML=expanded?'收起 <span aria-hidden="true">⌃</span>':'展开 <span aria-hidden="true">⌄</span>';
  position();
}
toggle.addEventListener('click',()=>setExpanded(body.hidden));
document.querySelector('#reset-target-toolbar').addEventListener('click',()=>{moved=false;position();});
toolbar.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!body.hidden){setExpanded(false);toggle.focus();}
});
handle.addEventListener('pointerdown',event=>{
  if(!event.isPrimary||event.button!==0)return;
  closeMenus();
  const rect=toolbar.getBoundingClientRect();
  drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
  handle.setPointerCapture(event.pointerId);
  toolbar.classList.add('dragging');
  event.preventDefault();
});
handle.addEventListener('pointermove',event=>{
  if(!drag||drag.id!==event.pointerId)return;
  moved=true;
  place(drag.left+event.clientX-drag.x,drag.top+event.clientY-drag.y);
});
function stopDrag(){drag=null;toolbar.classList.remove('dragging');}
handle.addEventListener('pointerup',stopDrag);
handle.addEventListener('pointercancel',stopDrag);
handle.addEventListener('lostpointercapture',stopDrag);
handle.addEventListener('keydown',event=>{
  const offsets={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]};
  const offset=offsets[event.key];if(!offset)return;
  event.preventDefault();moved=true;
  const rect=toolbar.getBoundingClientRect();place(rect.left+offset[0],rect.top+offset[1]);
});
function closeMenus(){
  toolbar.querySelectorAll('.print-select-trigger[aria-expanded="true"]').forEach(button=>button.click());
}
function positionMenu(){
  const trigger=toolbar.querySelector('.print-select-trigger[aria-expanded="true"]');
  if(!trigger)return;
  const menu=trigger.parentElement.querySelector('.print-select-menu'),rect=trigger.getBoundingClientRect();
  const width=Math.min(260,window.innerWidth-24);
  Object.assign(menu.style,{position:'fixed',width:`${width}px`,minWidth:'0',maxHeight:'240px',overflowY:'auto',right:'auto',left:`${Math.max(12,Math.min(rect.left,window.innerWidth-width-12))}px`});
  const height=menu.getBoundingClientRect().height;
  menu.style.top=`${rect.bottom+height+6<window.innerHeight-12?rect.bottom+6:Math.max(12,rect.top-height-6)}px`;
}
new MutationObserver(positionMenu).observe(targets,{subtree:true,attributes:true,attributeFilter:['aria-expanded']});
targets.addEventListener('scroll',closeMenus,{passive:true});
body.addEventListener('scroll',closeMenus,{passive:true});
new MutationObserver(()=>{
  const count=targets.children.length;
  const selected=Number(targets.dataset.selectedCount||0);
  summary.textContent=`${count} 个位置 · 已选 ${selected} 个 Logo`;
}).observe(targets,{childList:true,attributes:true,attributeFilter:['data-selected-count']});
window.addEventListener('resize',()=>{closeMenus();position();});
window.addEventListener('scroll',()=>{closeMenus();if(!moved)position();},{passive:true});
new ResizeObserver(position).observe(canvas);
new ResizeObserver(position).observe(toolbar);
position();
