import {clampTargetCenter,pointerToNormalized,rotationFromPointer,widthRatioFromScalePointer} from './demo-geometry.mjs';
import {cloneTarget} from './target-state.mjs';
import {renderTintedLogoLayer} from './preview-logo-layer.mjs';
import {chooseContrastColor} from './contrast-color.mjs';
import {clearSavedLogo,loadSavedLogo,saveLogo} from './saved-logo.mjs';

const targets=document.querySelector('#targets');
const status=document.querySelector('#status');
const emptyState=document.querySelector('#empty-state');
const results=document.querySelector('#results');
const resultMeta=document.querySelector('#result-meta');
const canvas=document.querySelector('#placement-canvas');
const previewEmpty=document.querySelector('#preview-empty');
const processButton=document.querySelector('#process-logo');
const useSavedLogoButton=document.querySelector('#use-saved-logo');
const clearSavedLogoButton=document.querySelector('#clear-saved-logo');
const processingPanel=document.querySelector('#processing-panel');
const originalColorInput=document.querySelector('#original-color');
const originalColorValue=document.querySelector('#original-color-value');
const autoContrastInput=document.querySelector('#auto-contrast');
const imagePreview=document.querySelector('#image-preview');
const imagePreviewTitle=document.querySelector('#image-preview-title');
const imagePreviewImage=document.querySelector('#image-preview-image');
const imagePreviewViewport=document.querySelector('#image-preview-viewport');
const zoomReset=document.querySelector('#zoom-reset');
let previewScale=1;
let targetNumber=0;
let selectedTargetId='product';
let dragTarget=null;
let dragMode=null;
let baseData='',logoData='',logoSourceData='',finishReferenceData='';
let baseImage=null,logoImage=null;

const esc=value=>String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
function setStatus(message,type=''){status.textContent=message;status.className=`status ${type}`;}
function fileData(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({dataUrl:String(reader.result),data:String(reader.result).split(',')[1]});reader.onerror=reject;reader.readAsDataURL(file);});}
function loadImage(dataUrl){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('图片无法读取'));image.src=dataUrl;});}

function quadFromTarget(target){
  const width=target.widthRatio*canvas.width,height=logoImage?width*logoImage.naturalHeight/logoImage.naturalWidth:width,center={x:target.x*canvas.width,y:target.y*canvas.height};
  return [[-width/2,-height/2],[width/2,-height/2],[width/2,height/2],[-width/2,height/2]].map(([x,y])=>{const point=rotateLocal(center,x,y,target.rotation);return {x:point.x/canvas.width,y:point.y/canvas.height};});
}
function rowQuad(row){try{const quad=JSON.parse(row.dataset.quad||'');return Array.isArray(quad)&&quad.length===4?quad:null;}catch{return null;}}
function setRowQuad(row,quad){row.dataset.quad=JSON.stringify(quad);}

async function useSavedLogo(saved=loadSavedLogo(localStorage)){
  if(!saved)throw Error('没有可使用的已保存 Logo');
  logoData=saved.data;logoSourceData=saved.sourceData||'';logoImage=await loadImage(`data:image/png;base64,${saved.data}`);processButton.disabled=false;useSavedLogoButton.hidden=false;clearSavedLogoButton.hidden=false;document.querySelector('#logo-name').textContent=`已使用：${saved.name}`;processingPanel.hidden=true;drawPreview();
}

async function restoreSavedLogo(){
  try{
    const saved=loadSavedLogo(localStorage);
    if(!saved)return;
    await useSavedLogo(saved);document.querySelector('#logo-name').textContent=`已恢复：${saved.name}`;setStatus('已恢复上次加工完成的透明 Logo，无需再次生成。','success');
  }catch{clearSavedLogo(localStorage);}
}

function addTarget(value={}){
  targetNumber++;
  const id=value.id||`target-${targetNumber}`;
  const row=document.createElement('div');
  row.className='target-row';
  row.dataset.targetId=id;
  row.dataset.logoColor=value.color||'#000000';
  row.dataset.autoContrast=String(value.autoContrast!==false);
  if(value.quad)setRowQuad(row,value.quad);
  row.innerHTML=`<div class="target-head"><strong>目标 ${targetNumber}</strong><span class="target-actions"><button type="button" class="quad-target">四点透视</button><button type="button" class="duplicate-target">复制 Logo</button><button type="button" class="remove-target">删除</button></span></div><div class="target-grid"><label>ID<input data-key="id" value="${esc(id)}" spellcheck="false"></label><label>X<input data-key="x" type="number" min="0" max="1" step=".01" value="${value.x??.5}"></label><label>Y<input data-key="y" type="number" min="0" max="1" step=".01" value="${value.y??.5}"></label><label>宽度比例<input data-key="widthRatio" type="number" min=".01" max="1" step=".01" value="${value.widthRatio??.2}"></label><label>旋转角度<input data-key="rotation" type="number" min="-180" max="180" step="1" value="${value.rotation??0}"></label><label>曲面弯曲<input data-key="curve" type="number" min="0" max="1" step=".05" value="${value.curve??0}"></label><label>光泽参考<select data-key="surface"><option value="free" ${!value.surface||value.surface==='free'?'selected':''}>自由光泽（默认）</option><option value="flat" ${value.surface==='flat'?'selected':''}>平面轻光</option><option value="cylinder" ${value.surface==='cylinder'?'selected':''}>弧面高光</option></select></label></div>`;
  row.addEventListener('click',event=>{if(event.target.closest('button'))return;selectedTargetId=row.dataset.targetId;refreshTargetSelection();drawPreview();});
  row.querySelector('.duplicate-target').onclick=event=>{event.stopPropagation();const source=collectTargets().find(target=>target.id===row.dataset.targetId);if(!source)return;const aspectRatio=logoImage?logoImage.naturalHeight/logoImage.naturalWidth:1;const copy=cloneTarget(source,collectTargets().map(target=>target.id),.06,aspectRatio);addTarget(copy);selectedTargetId=copy.id;refreshTargetSelection();drawPreview();setStatus(`已复制 Logo：${copy.id}，请继续拖动定位。`,'success');};
  row.querySelector('.quad-target').onclick=event=>{event.stopPropagation();const target=collectTargets().find(item=>item.id===row.dataset.targetId);if(!target)return;setRowQuad(row,target.quad||quadFromTarget(target));selectedTargetId=target.id;refreshTargetSelection();drawPreview();setStatus('已启用四点透视：拖动预览中的四个蓝点贴合当前可见表面。','success');};
  row.querySelector('.remove-target').onclick=event=>{event.stopPropagation();if(targets.children.length===1){setStatus('至少保留一个上样目标','error');return;}const wasSelected=row.dataset.targetId===selectedTargetId;row.remove();if(wasSelected)selectedTargetId=targets.firstElementChild.dataset.targetId;refreshTargetSelection();drawPreview();};
  row.querySelectorAll('[data-key]').forEach(input=>input.addEventListener('input',()=>{
    if(input.dataset.key==='id'){if(row.dataset.targetId===selectedTargetId)selectedTargetId=input.value.trim();row.dataset.targetId=input.value.trim();}
    const edited=collectTargets().find(target=>target.id===row.dataset.targetId);if(edited&&!edited.quad){keepTargetInsideCanvas(edited);updateInputs(edited);}
    drawPreview();refreshTargetSelection();
  }));
  targets.append(row);refreshTargetSelection();drawPreview();
}

function collectTargets(){return [...targets.children].map(row=>({...Object.fromEntries([...row.querySelectorAll('[data-key]')].map(input=>[input.dataset.key,['id','surface'].includes(input.dataset.key)?input.value.trim():Number(input.value)])),quad:rowQuad(row)||undefined,color:row.dataset.logoColor||'#000000',autoContrast:row.dataset.autoContrast==='true'}));}
function refreshTargetSelection(){
  [...targets.children].forEach(row=>row.classList.toggle('selected',row.dataset.targetId===selectedTargetId));
  const selectedRow=[...targets.children].find(row=>row.dataset.targetId===selectedTargetId);
  const color=selectedRow?.dataset.logoColor||'#000000';
  const autoContrast=selectedRow?.dataset.autoContrast==='true';
  originalColorInput.value=color;
  originalColorInput.disabled=false;
  autoContrastInput.checked=autoContrast;
  originalColorValue.textContent=color.toUpperCase();
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
function updateQuad(target){const row=[...targets.children].find(item=>item.dataset.targetId===target.id);if(row&&target.quad)setRowQuad(row,target.quad);}
function keepTargetInsideCanvas(target){if(!logoImage||target.quad)return target;Object.assign(target,clampTargetCenter(target,logoImage.naturalHeight/logoImage.naturalWidth));return target;}
function curvePreviewLogo(layer,curve){
  if(!curve)return layer;
  const source=layer.getContext('2d').getImageData(0,0,layer.width,layer.height),output=document.createElement('canvas');
  output.width=layer.width;output.height=layer.height;
  const destination=output.getContext('2d').createImageData(layer.width,layer.height),half=(layer.width-1)/2,theta=curve*1.15,sine=Math.sin(theta);
  for(let y=0;y<layer.height;y++)for(let x=0;x<layer.width;x++){
    const relative=half?((x-half)/half):0,sourceX=Math.round(half+(Math.asin(Math.max(-1,Math.min(1,relative*sine)))/theta)*half),from=(y*layer.width+sourceX)*4,to=(y*layer.width+x)*4;
    destination.data[to]=source.data[from];destination.data[to+1]=source.data[from+1];destination.data[to+2]=source.data[from+2];destination.data[to+3]=source.data[from+3];
  }
  output.getContext('2d').putImageData(destination,0,0);return output;
}
function solveQuad(rows){
  const values=rows.map(row=>[...row]);
  for(let column=0;column<8;column++){
    let pivot=column;for(let row=column+1;row<8;row++)if(Math.abs(values[row][column])>Math.abs(values[pivot][column]))pivot=row;
    if(Math.abs(values[pivot][column])<1e-10)return null;
    [values[column],values[pivot]]=[values[pivot],values[column]];
    const divisor=values[column][column];for(let index=column;index<=8;index++)values[column][index]/=divisor;
    for(let row=0;row<8;row++)if(row!==column){const factor=values[row][column];for(let index=column;index<=8;index++)values[row][index]-=factor*values[column][index];}
  }
  return values.map(row=>row[8]);
}
function inverseQuad(matrix){
  const [a,b,c,d,e,f,g,h,i]=matrix,determinant=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  if(Math.abs(determinant)<1e-10)return null;
  return [(e*i-f*h)/determinant,(c*h-b*i)/determinant,(b*f-c*e)/determinant,(f*g-d*i)/determinant,(a*i-c*g)/determinant,(c*d-a*f)/determinant,(d*h-e*g)/determinant,(b*g-a*h)/determinant,(a*e-b*d)/determinant];
}
function drawQuadPreview(context,layer,quad){
  const points=quad.map(point=>({x:point.x*canvas.width,y:point.y*canvas.height})),left=Math.floor(Math.min(...points.map(point=>point.x))),top=Math.floor(Math.min(...points.map(point=>point.y))),right=Math.ceil(Math.max(...points.map(point=>point.x))),bottom=Math.ceil(Math.max(...points.map(point=>point.y)));
  if(right<=left||bottom<=top)return;
  const rows=[],source=[[0,0],[layer.width-1,0],[layer.width-1,layer.height-1],[0,layer.height-1]];
  for(let index=0;index<4;index++){const [x,y]=source[index],X=points[index].x-left,Y=points[index].y-top;rows.push([x,y,1,0,0,0,-X*x,-X*y,X],[0,0,0,x,y,1,-Y*x,-Y*y,Y]);}
  const solved=solveQuad(rows),inverse=solved&&inverseQuad([...solved,1]);if(!inverse)return;
  const input=layer.getContext('2d').getImageData(0,0,layer.width,layer.height),output=context.getImageData(left,top,right-left,bottom-top);
  for(let y=0;y<output.height;y++)for(let x=0;x<output.width;x++){
    const divisor=inverse[6]*x+inverse[7]*y+inverse[8];if(Math.abs(divisor)<1e-10)continue;
    const sourceX=Math.round((inverse[0]*x+inverse[1]*y+inverse[2])/divisor),sourceY=Math.round((inverse[3]*x+inverse[4]*y+inverse[5])/divisor);
    if(sourceX<0||sourceY<0||sourceX>=layer.width||sourceY>=layer.height)continue;
    const from=(sourceY*layer.width+sourceX)*4,to=(y*output.width+x)*4,alpha=input.data[from+3]/255;if(!alpha)continue;
    output.data[to]=Math.round(input.data[from]*alpha+output.data[to]*(1-alpha));output.data[to+1]=Math.round(input.data[from+1]*alpha+output.data[to+1]*(1-alpha));output.data[to+2]=Math.round(input.data[from+2]*alpha+output.data[to+2]*(1-alpha));output.data[to+3]=255;
  }
  context.putImageData(output,left,top);
}
function drawPreview(){
  if(!baseImage){canvas.width=1;canvas.height=1;previewEmpty.hidden=false;return;}
  canvas.width=baseImage.naturalWidth;canvas.height=baseImage.naturalHeight;previewEmpty.hidden=true;
  const context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(baseImage,0,0);
  if(!logoImage)return;
  const basePixels=context.getImageData(0,0,canvas.width,canvas.height).data;
  for(const target of collectTargets()){
    const width=target.widthRatio*canvas.width,height=width*logoImage.naturalHeight/logoImage.naturalWidth;
    const targetColor=target.color||'#000000';
    if(target.id===selectedTargetId){originalColorInput.value=targetColor;originalColorValue.textContent=targetColor;originalColorInput.disabled=false;}
    const logoLayer=renderTintedLogoLayer({
      createCanvas:(layerWidth,layerHeight)=>{const layer=document.createElement('canvas');layer.width=layerWidth;layer.height=layerHeight;return layer;},
      logoImage,width,height,color:targetColor
    });
    const curvedLayer=curvePreviewLogo(logoLayer,target.curve);
    if(target.quad)drawQuadPreview(context,curvedLayer,target.quad);else{context.save();context.translate(target.x*canvas.width,target.y*canvas.height);context.rotate(target.rotation*Math.PI/180);context.globalAlpha=target.id===selectedTargetId?.9:.68;context.drawImage(curvedLayer,-width/2,-height/2,width,height);context.globalAlpha=1;context.strokeStyle=target.id===selectedTargetId?'#5369d9':'#ffffff';context.lineWidth=Math.max(2,canvas.width/500);context.setLineDash(target.id===selectedTargetId?[]:[8,6]);context.strokeRect(-width/2,-height/2,width,height);context.restore();}
    if(target.id===selectedTargetId){const handles=handlePoints(target),size=Math.max(10,canvas.width/80);context.setLineDash([]);context.strokeStyle='#5369d9';context.lineWidth=Math.max(2,canvas.width/500);context.beginPath();context.moveTo(handles.center.x,handles.center.y);context.lineTo(handles.rotation.x,handles.rotation.y);context.stroke();context.fillStyle='#5369d9';context.fillRect(handles.scale.x-size/2,handles.scale.y-size/2,size,size);context.beginPath();context.arc(handles.rotation.x,handles.rotation.y,size*.55,0,Math.PI*2);context.fill();if(target.quad){const points=target.quad.map(point=>({x:point.x*canvas.width,y:point.y*canvas.height}));context.beginPath();context.moveTo(points[0].x,points[0].y);for(const point of points.slice(1))context.lineTo(point.x,point.y);context.closePath();context.stroke();for(const point of points)context.fillRect(point.x-size/2,point.y-size/2,size,size);}}
  }
}

canvas.addEventListener('pointerdown',event=>{
  if(!baseImage||!logoImage)return;
  const normalized=pointerToNormalized(event.clientX,event.clientY,canvas.getBoundingClientRect()),point={x:normalized.x*canvas.width,y:normalized.y*canvas.height};
  const selected=collectTargets().find(target=>target.id===selectedTargetId),handles=selected?handlePoints(selected):null,hitRadius=Math.max(18,canvas.width/35);
  const quadDistances=selected?.quad?.map(corner=>distance(point,{x:corner.x*canvas.width,y:corner.y*canvas.height}))||[];
  const quadIndex=quadDistances.findIndex(distanceToCorner=>distanceToCorner<=hitRadius);
  if(quadIndex>=0){dragTarget=selected;dragMode=`quad-${quadIndex}`;}
  else if(handles&&distance(point,handles.scale)<=hitRadius){dragTarget=selected;dragMode='scale';}
  else if(handles&&distance(point,handles.rotation)<=hitRadius){dragTarget=selected;dragMode='rotate';}
  else{dragTarget=targetAt(normalized);dragMode=dragTarget?'move':null;}
  if(!dragTarget)return;selectedTargetId=dragTarget.id;canvas.setPointerCapture(event.pointerId);canvas.classList.add('dragging');refreshTargetSelection();drawPreview();
});
canvas.addEventListener('pointermove',event=>{
  if(!dragTarget)return;
  const normalized=pointerToNormalized(event.clientX,event.clientY,canvas.getBoundingClientRect()),point={x:normalized.x*canvas.width,y:normalized.y*canvas.height};
  if(dragMode==='move'){const offsetX=normalized.x-dragTarget.x,offsetY=normalized.y-dragTarget.y;dragTarget.x=normalized.x;dragTarget.y=normalized.y;if(dragTarget.quad){dragTarget.quad=dragTarget.quad.map(corner=>({x:Math.min(1,Math.max(0,corner.x+offsetX)),y:Math.min(1,Math.max(0,corner.y+offsetY))}));updateQuad(dragTarget);}}
  if(dragMode==='scale')dragTarget.widthRatio=widthRatioFromScalePointer(dragTarget,point,canvas.width,canvas.height);
  if(dragMode==='rotate')dragTarget.rotation=rotationFromPointer({x:dragTarget.x*canvas.width,y:dragTarget.y*canvas.height},point);
  if(!dragTarget.quad)keepTargetInsideCanvas(dragTarget);
  if(dragMode?.startsWith('quad-')){const index=Number(dragMode.slice(5));dragTarget.quad[index]={x:normalized.x,y:normalized.y};updateQuad(dragTarget);}
  updateInputs(dragTarget);drawPreview();
});
function endDrag(event){if(!dragTarget)return;dragTarget=null;dragMode=null;canvas.classList.remove('dragging');if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);}
canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);

document.querySelector('#add-target').onclick=()=>addTarget();
originalColorInput.oninput=()=>{const selectedRow=[...targets.children].find(row=>row.dataset.targetId===selectedTargetId);if(!selectedRow)return;selectedRow.dataset.logoColor=originalColorInput.value;originalColorValue.textContent=originalColorInput.value.toUpperCase();drawPreview();};
autoContrastInput.onchange=()=>{const selectedRow=[...targets.children].find(row=>row.dataset.targetId===selectedTargetId);if(!selectedRow)return;selectedRow.dataset.autoContrast=String(autoContrastInput.checked);drawPreview();};
document.querySelector('#base-image').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{const loaded=await fileData(file);baseData=loaded.data;baseImage=await loadImage(loaded.dataUrl);document.querySelector('#base-name').textContent=file.name;drawPreview();}catch(error){setStatus(error.message,'error');}};
document.querySelector('#logo-image').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{const loaded=await fileData(file),saved=loadSavedLogo(localStorage);logoSourceData=loaded.data;if(saved?.sourceData===loaded.data){await useSavedLogo(saved);setStatus('已自动匹配并使用保存的透明 Logo，无需重新生成。','success');return;}logoData=loaded.data;logoImage=await loadImage(loaded.dataUrl);processButton.disabled=false;document.querySelector('#logo-name').textContent=file.name;drawPreview();}catch(error){setStatus(error.message,'error');}};
document.querySelector('#finish-reference-image').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{finishReferenceData=(await fileData(file)).data;document.querySelector('#finish-reference-name').textContent=`已选择：${file.name}（仅参考印刷/金属光泽）`;setStatus('已加入工艺质感参考图。','success');}catch(error){setStatus(error.message,'error');}};

useSavedLogoButton.onclick=async()=>{try{await useSavedLogo();setStatus('已使用保存的透明 Logo，无需重新生成。','success');}catch(error){setStatus(error.message,'error');}};
clearSavedLogoButton.onclick=()=>{clearSavedLogo(localStorage);useSavedLogoButton.hidden=true;clearSavedLogoButton.hidden=true;setStatus('已清除保存的透明 Logo；当前页面中的 Logo 仍可继续使用。','success');};

processButton.onclick=()=>{if(logoData)processingPanel.hidden=false;};
document.querySelector('#cancel-processing').onclick=()=>{processingPanel.hidden=true;};
document.querySelector('#apply-processing').onclick=async()=>{
  if(!logoData)return;
  const processingStatus=document.querySelector('#processing-status');processingStatus.textContent='正在调用 AI 图片模型…';
  try{
    const response=await fetch('/api/ai-process-logo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({logoImage:logoData})});
    const payload=await response.json();if(!response.ok)throw Error(payload.error||'Logo加工失败');
    logoData=payload.dataUrl.split(',')[1];logoImage=await loadImage(payload.dataUrl);saveLogo(localStorage,{data:logoData,name:'AI 已加工 Logo.png',sourceData:logoSourceData});useSavedLogoButton.hidden=false;clearSavedLogoButton.hidden=false;document.querySelector('#logo-name').textContent='AI 已加工 Logo（已保存）';processingStatus.textContent=`AI 加工完成：${payload.width} × ${payload.height}`;processingPanel.hidden=true;drawPreview();setStatus('AI Logo 已加工并保存为透明底黑字，下次打开会自动恢复。','success');
  }catch(error){processingStatus.textContent=error.message||'Logo加工失败';}
};

async function loadAiProviderStatus(){
  const hint=document.querySelector('#ai-provider-status');
  try{const response=await fetch('/api/ai-logo/status');const payload=await response.json();hint.textContent=payload.configured?`已连接 AI 图片模型：${payload.provider} / ${payload.model}`:'尚未配置 APIMart 图片模型，请先配置本机 APIMart 参数。';hint.className=`hint ${payload.configured?'provider-ready':'provider-missing'}`;}
  catch{hint.textContent='无法读取 AI 图片模型配置，请检查 S7 服务。';hint.className='hint provider-missing';}
}

function setPreviewScale(value){
  previewScale=Math.min(4,Math.max(.25,value));
  imagePreviewImage.style.transform=`scale(${previewScale})`;
  zoomReset.textContent=`${Math.round(previewScale*100)}%`;
}
function openImagePreview(version,dataUrl){
  imagePreviewTitle.textContent=`${version} · 图片预览`;
  imagePreviewImage.src=dataUrl;
  imagePreview.hidden=false;
  setPreviewScale(1);
}
function closeImagePreview(){imagePreview.hidden=true;imagePreviewImage.removeAttribute('src');}
function updateResultCard(card,output){
  const image=card.querySelector('.result-image'),link=card.querySelector('.download');
  image.src=output.dataUrl;link.href=output.dataUrl;
}
async function regenerateResult(version,card){
  const button=card.querySelector('.regenerate-result');
  if(!baseData||!logoData){setStatus('请先选择原图和透明 Logo。','error');return;}
  button.disabled=true;button.textContent='生成中…';
  try{
    const response=await fetch('/api/ai-render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({onlyVersion:version,baseImage:baseData,logoImage:logoData,finishReferenceImage:finishReferenceData,targets:collectTargets(),originalColor:originalColorInput.value})});
    const payload=await response.json();if(!response.ok)throw Error(payload.error||'重新生成失败');
    const output=payload.outputs.find(item=>item.version===version);if(!output)throw Error(`没有返回 ${version} 结果`);
    updateResultCard(card,output);setStatus(`${version} 已重新生成。`,'success');
  }catch(error){setStatus(error.message||'重新生成失败','error');}
  finally{button.disabled=false;button.textContent='重新生成';}
}
function renderResults(payload){
  emptyState.hidden=true;results.replaceChildren();resultMeta.textContent=`${payload.targetIds.length} 个目标 · 指纹 ${payload.layoutFingerprint.slice(0,10)}`;
  for(const output of payload.outputs){
    const card=document.createElement('article');card.className='result-card';
    const image=document.createElement('img');image.className='result-image';image.src=output.dataUrl;image.alt=output.version;image.tabIndex=0;image.title='点击查看大图';image.onclick=()=>openImagePreview(output.version,image.src);image.onkeydown=event=>{if(event.key==='Enter'||event.key===' ')openImagePreview(output.version,image.src);};
    const footer=document.createElement('footer');const title=document.createElement('strong');title.textContent=output.version;
    const actions=document.createElement('div');actions.className='result-actions';
    const link=document.createElement('a');link.className='download';link.href=output.dataUrl;link.download=`logo-mockup-${output.version.toLowerCase().replaceAll(' ','-')}.png`;link.textContent='下载 PNG';
    const regenerate=document.createElement('button');regenerate.type='button';regenerate.className='regenerate-result';regenerate.textContent='重新生成';regenerate.onclick=()=>regenerateResult(output.version,card);
    actions.append(link,regenerate);footer.append(title,actions);card.append(image,footer);results.append(card);
  }
}

document.querySelector('#zoom-in').onclick=()=>setPreviewScale(previewScale+.25);
document.querySelector('#zoom-out').onclick=()=>setPreviewScale(previewScale-.25);
document.querySelector('#zoom-reset').onclick=()=>setPreviewScale(1);
document.querySelector('#close-preview').onclick=closeImagePreview;
imagePreview.querySelector('[data-close-preview]').onclick=closeImagePreview;
imagePreviewViewport.addEventListener('wheel',event=>{
  if(imagePreview.hidden)return;
  event.preventDefault();
  setPreviewScale(previewScale+(event.deltaY<0?.15:-.15));
},{passive:false});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!imagePreview.hidden)closeImagePreview();
});

document.querySelector('#generate').onclick=async()=>{
  if(!baseData||!logoData){setStatus('请先选择原图和透明 Logo。','error');return;}
  setStatus('正在调用 GPT Image 2 生成四个自然上样版本，通常需要数分钟…','busy');
  try{
    const response=await fetch('/api/ai-render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({baseImage:baseData,logoImage:logoData,finishReferenceImage:finishReferenceData,targets:collectTargets(),originalColor:originalColorInput.value})});
    const payload=await response.json();if(!response.ok)throw Error(payload.error||'生成失败');renderResults(payload);setStatus('GPT Image 2 已生成四个自然上样版本，请检查产品、包装文字与 Logo 是否保持保真。','success');
  }catch(error){setStatus(error.message||'生成失败，请检查素材和目标设置。','error');}
};

addTarget({id:'product',x:.5,y:.5,widthRatio:.2,rotation:0,curve:0,surface:'free'});
loadAiProviderStatus();
restoreSavedLogo();
