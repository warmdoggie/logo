import {pointerToNormalized,rotationFromPointer,widthRatioFromScalePointer} from './demo-geometry.mjs';
import {cloneTarget} from './target-state.mjs';

const targets=document.querySelector('#targets');
const status=document.querySelector('#status');
const emptyState=document.querySelector('#empty-state');
const results=document.querySelector('#results');
const resultMeta=document.querySelector('#result-meta');
const canvas=document.querySelector('#placement-canvas');
const previewEmpty=document.querySelector('#preview-empty');
const processButton=document.querySelector('#process-logo');
const processingPanel=document.querySelector('#processing-panel');
let targetNumber=0;
let selectedTargetId='product';
let dragTarget=null;
let dragMode=null;
let baseData='',logoData='';
let baseImage=null,logoImage=null;

const esc=value=>String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
function setStatus(message,type=''){status.textContent=message;status.className=`status ${type}`;}
function fileData(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({dataUrl:String(reader.result),data:String(reader.result).split(',')[1]});reader.onerror=reject;reader.readAsDataURL(file);});}
function loadImage(dataUrl){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('图片无法读取'));image.src=dataUrl;});}

function addTarget(value={}){
  targetNumber++;
  const id=value.id||`target-${targetNumber}`;
  const row=document.createElement('div');
  row.className='target-row';
  row.dataset.targetId=id;
  row.innerHTML=`<div class="target-head"><strong>目标 ${targetNumber}</strong><span class="target-actions"><button type="button" class="duplicate-target">复制 Logo</button><button type="button" class="remove-target">删除</button></span></div><div class="target-grid"><label>ID<input data-key="id" value="${esc(id)}" spellcheck="false"></label><label>X<input data-key="x" type="number" min="0" max="1" step=".01" value="${value.x??.5}"></label><label>Y<input data-key="y" type="number" min="0" max="1" step=".01" value="${value.y??.5}"></label><label>宽度比例<input data-key="widthRatio" type="number" min=".01" max="1" step=".01" value="${value.widthRatio??.2}"></label><label>旋转角度<input data-key="rotation" type="number" min="-180" max="180" step="1" value="${value.rotation??0}"></label></div>`;
  row.addEventListener('click',event=>{if(event.target.closest('button'))return;selectedTargetId=row.dataset.targetId;refreshTargetSelection();drawPreview();});
  row.querySelector('.duplicate-target').onclick=event=>{event.stopPropagation();const source=collectTargets().find(target=>target.id===row.dataset.targetId);if(!source)return;const copy=cloneTarget(source,collectTargets().map(target=>target.id));addTarget(copy);selectedTargetId=copy.id;refreshTargetSelection();drawPreview();setStatus(`已复制 Logo：${copy.id}，请继续拖动定位。`,'success');};
  row.querySelector('.remove-target').onclick=event=>{event.stopPropagation();if(targets.children.length===1){setStatus('至少保留一个上样目标','error');return;}const wasSelected=row.dataset.targetId===selectedTargetId;row.remove();if(wasSelected)selectedTargetId=targets.firstElementChild.dataset.targetId;refreshTargetSelection();drawPreview();};
  row.querySelectorAll('[data-key]').forEach(input=>input.addEventListener('input',()=>{
    if(input.dataset.key==='id'){if(row.dataset.targetId===selectedTargetId)selectedTargetId=input.value.trim();row.dataset.targetId=input.value.trim();}
    drawPreview();refreshTargetSelection();
  }));
  targets.append(row);refreshTargetSelection();drawPreview();
}

function collectTargets(){return [...targets.children].map(row=>Object.fromEntries([...row.querySelectorAll('[data-key]')].map(input=>[input.dataset.key,input.dataset.key==='id'?input.value.trim():Number(input.value)])));}
function refreshTargetSelection(){
  [...targets.children].forEach(row=>row.classList.toggle('selected',row.dataset.targetId===selectedTargetId));
  document.querySelector('#selected-target').textContent=selectedTargetId?`当前：${selectedTargetId}`:'未选择目标';
}
function targetRect(target){
  const width=target.widthRatio*canvas.width;
  const height=logoImage?width*logoImage.naturalHeight/logoImage.naturalWidth:width;
  return {left:target.x*canvas.width-width/2,top:target.y*canvas.height-height/2,width,height};
}
function targetAt(point){
  const list=collectTargets();
  for(let i=list.length-1;i>=0;i--){const rect=targetRect(list[i]);if(point.x*canvas.width>=rect.left&&point.x*canvas.width<=rect.left+rect.width&&point.y*canvas.height>=rect.top&&point.y*canvas.height<=rect.top+rect.height)return list[i];}
  return null;
}
function canvasPoint(event){
  const normalized=pointerToNormalized(event.clientX,event.clientY,canvas.getBoundingClientRect());
  return {x:normalized.x*canvas.width,y:normalized.y*canvas.height};
}
function rotateLocal(center,x,y,degrees){const radians=degrees*Math.PI/180;return {x:center.x+x*Math.cos(radians)-y*Math.sin(radians),y:center.y+x*Math.sin(radians)+y*Math.cos(radians)};}
function handlePoints(target){
  const center={x:target.x*canvas.width,y:target.y*canvas.height};
  const width=target.widthRatio*canvas.width,height=logoImage?width*logoImage.naturalHeight/logoImage.naturalWidth:width;
  return {center,scale:rotateLocal(center,width/2,height/2,target.rotation),rotation:rotateLocal(center,0,-height/2-36,target.rotation)};
}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function updateInputs(target){
  const row=[...targets.children].find(item=>item.dataset.targetId===target.id);if(!row)return;
  for(const key of ['x','y','widthRatio','rotation']){const input=row.querySelector(`[data-key="${key}"]`);if(input)input.value=Number(target[key].toFixed(4));}
}
function drawPreview(){
  if(!baseImage){canvas.width=1;canvas.height=1;previewEmpty.hidden=false;return;}
  canvas.width=baseImage.naturalWidth;canvas.height=baseImage.naturalHeight;previewEmpty.hidden=true;
  const context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(baseImage,0,0);
  if(!logoImage)return;
  for(const target of collectTargets()){
    const width=target.widthRatio*canvas.width,height=width*logoImage.naturalHeight/logoImage.naturalWidth;
    context.save();context.translate(target.x*canvas.width,target.y*canvas.height);context.rotate(target.rotation*Math.PI/180);context.globalAlpha=target.id===selectedTargetId?.9:.68;context.drawImage(logoImage,-width/2,-height/2,width,height);context.globalAlpha=1;context.strokeStyle=target.id===selectedTargetId?'#5369d9':'#ffffff';context.lineWidth=Math.max(2,canvas.width/500);context.setLineDash(target.id===selectedTargetId?[]:[8,6]);context.strokeRect(-width/2,-height/2,width,height);context.restore();
    if(target.id===selectedTargetId){const handles=handlePoints(target),size=Math.max(10,canvas.width/80);context.setLineDash([]);context.strokeStyle='#5369d9';context.lineWidth=Math.max(2,canvas.width/500);context.beginPath();context.moveTo(handles.center.x,handles.center.y);context.lineTo(handles.rotation.x,handles.rotation.y);context.stroke();context.fillStyle='#5369d9';context.fillRect(handles.scale.x-size/2,handles.scale.y-size/2,size,size);context.beginPath();context.arc(handles.rotation.x,handles.rotation.y,size*.55,0,Math.PI*2);context.fill();}
  }
}

canvas.addEventListener('pointerdown',event=>{
  if(!baseImage||!logoImage)return;
  const normalized=pointerToNormalized(event.clientX,event.clientY,canvas.getBoundingClientRect()),point={x:normalized.x*canvas.width,y:normalized.y*canvas.height};
  const selected=collectTargets().find(target=>target.id===selectedTargetId),handles=selected?handlePoints(selected):null,hitRadius=Math.max(18,canvas.width/35);
  if(handles&&distance(point,handles.scale)<=hitRadius){dragTarget=selected;dragMode='scale';}
  else if(handles&&distance(point,handles.rotation)<=hitRadius){dragTarget=selected;dragMode='rotate';}
  else{dragTarget=targetAt(normalized);dragMode=dragTarget?'move':null;}
  if(!dragTarget)return;selectedTargetId=dragTarget.id;canvas.setPointerCapture(event.pointerId);canvas.classList.add('dragging');refreshTargetSelection();drawPreview();
});
canvas.addEventListener('pointermove',event=>{
  if(!dragTarget)return;
  const normalized=pointerToNormalized(event.clientX,event.clientY,canvas.getBoundingClientRect()),point={x:normalized.x*canvas.width,y:normalized.y*canvas.height};
  if(dragMode==='move'){dragTarget.x=normalized.x;dragTarget.y=normalized.y;}
  if(dragMode==='scale')dragTarget.widthRatio=widthRatioFromScalePointer(dragTarget,point,canvas.width,canvas.height);
  if(dragMode==='rotate')dragTarget.rotation=rotationFromPointer({x:dragTarget.x*canvas.width,y:dragTarget.y*canvas.height},point);
  updateInputs(dragTarget);drawPreview();
});
function endDrag(event){if(!dragTarget)return;dragTarget=null;dragMode=null;canvas.classList.remove('dragging');if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);}
canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);

document.querySelector('#add-target').onclick=()=>addTarget();
document.querySelector('#base-image').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{const loaded=await fileData(file);baseData=loaded.data;baseImage=await loadImage(loaded.dataUrl);document.querySelector('#base-name').textContent=file.name;drawPreview();}catch(error){setStatus(error.message,'error');}};
document.querySelector('#logo-image').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{const loaded=await fileData(file);logoData=loaded.data;logoImage=await loadImage(loaded.dataUrl);processButton.disabled=false;document.querySelector('#logo-name').textContent=file.name;drawPreview();}catch(error){setStatus(error.message,'error');}};

document.querySelector('#white-threshold').oninput=event=>{document.querySelector('#threshold-value').value=event.target.value;};
processButton.onclick=()=>{if(logoData)processingPanel.hidden=false;};
document.querySelector('#cancel-processing').onclick=()=>{processingPanel.hidden=true;};
document.querySelector('#apply-processing').onclick=async()=>{
  if(!logoData)return;
  const processingStatus=document.querySelector('#processing-status');processingStatus.textContent='正在加工…';
  try{
    const response=await fetch('/api/process-logo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({logoImage:logoData,removeWhiteBackground:document.querySelector('#remove-white').checked,cropTransparentBounds:document.querySelector('#crop-bounds').checked,threshold:Number(document.querySelector('#white-threshold').value)})});
    const payload=await response.json();if(!response.ok)throw Error(payload.error||'Logo加工失败');
    logoData=payload.dataUrl.split(',')[1];logoImage=await loadImage(payload.dataUrl);document.querySelector('#logo-name').textContent='已加工 Logo';processingStatus.textContent=`加工完成：${payload.width} × ${payload.height}`;processingPanel.hidden=true;drawPreview();setStatus('Logo 已加工，可以拖动定位。','success');
  }catch(error){processingStatus.textContent=error.message||'Logo加工失败';}
};

function renderResults(payload){
  emptyState.hidden=true;results.replaceChildren();resultMeta.textContent=`${payload.targetIds.length} 个目标 · 指纹 ${payload.layoutFingerprint.slice(0,10)}`;
  for(const output of payload.outputs){
    const card=document.createElement('article');card.className='result-card';const image=document.createElement('img');image.src=output.dataUrl;image.alt=output.version;const footer=document.createElement('footer');const title=document.createElement('strong');title.textContent=output.version;const link=document.createElement('a');link.className='download';link.href=output.dataUrl;link.download=`logo-mockup-${output.version.toLowerCase().replaceAll(' ','-')}.png`;link.textContent='下载 PNG';footer.append(title,link);card.append(image,footer);results.append(card);
  }
}

document.querySelector('#generate').onclick=async()=>{
  if(!baseData||!logoData){setStatus('请先选择原图和透明 Logo。','error');return;}
  setStatus('正在生成四个版本…','busy');
  try{
    const response=await fetch('/api/render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({baseImage:baseData,logoImage:logoData,targets:collectTargets()})});
    const payload=await response.json();if(!response.ok)throw Error(payload.error||'生成失败');renderResults(payload);setStatus('生成完成。四个版本使用同一布局。','success');
  }catch(error){setStatus(error.message||'生成失败，请检查素材和目标设置。','error');}
};

addTarget({id:'product',x:.5,y:.5,widthRatio:.2,rotation:0});
