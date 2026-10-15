import {clampTargetCenter,pointerToNormalized,rotationFromPointer,widthRatioFromScalePointer} from './demo-geometry.mjs';
import {canMoveTarget,cloneTarget,rotateTargetInPlace,setTargetMoveEnabled} from './target-state.mjs';
import {renderTintedLogoLayer} from './preview-logo-layer.mjs';
import {chooseContrastColor} from './contrast-color.mjs';
import {clearSavedLogo,loadSavedLogo,saveLogo} from './saved-logo.mjs';
import {masterTargetsFromTemplate} from './product-master.mjs';
import {triggerTransparentLogoDownload} from './transparent-logo-download.mjs';
import {rotationGestureMode,rotationHandleLocalPosition} from './rotation-handle.mjs';
import {createTaskDraft,normalizeTaskResult} from './task-draft.mjs';
import {createGenerationWatcher} from './generation-client.mjs';

const targets=document.querySelector('#targets');
const status=document.querySelector('#status');
const emptyState=document.querySelector('#empty-state');
const results=document.querySelector('#results');
const resultMeta=document.querySelector('#result-meta');
const canvas=document.querySelector('#placement-canvas');
const previewEmpty=document.querySelector('#preview-empty');
const processButton=document.querySelector('#process-logo');
const chooseProductButton=document.querySelector('#choose-product');
const productLibraryPanel=document.querySelector('#product-library-panel');
const closeProductLibraryButton=document.querySelector('#close-product-library');
const productLibrarySearch=document.querySelector('#product-library-search');
const productLibraryList=document.querySelector('#product-library-list');
const chooseLogoLibraryButton=document.querySelector('#choose-logo-library');
const logoLibraryPanel=document.querySelector('#logo-library-panel');
const closeLogoLibraryButton=document.querySelector('#close-logo-library');
const logoLibrarySearch=document.querySelector('#logo-library-search');
const logoLibraryList=document.querySelector('#logo-library-list');
const useSavedLogoButton=document.querySelector('#use-saved-logo');
const clearSavedLogoButton=document.querySelector('#clear-saved-logo');
const selectedLogoPreview=document.querySelector('#selected-logo-preview');
const selectedLogoThumbnail=document.querySelector('#selected-logo-thumbnail');
const processingPanel=document.querySelector('#processing-panel');
const originalColorInput=document.querySelector('#original-color');
const originalColorValue=document.querySelector('#original-color-value');
const autoContrastInput=document.querySelector('#auto-contrast');
const mockupModel=document.querySelector('#mockup-model');
const mockupModelHint=document.querySelector('#mockup-model-hint');
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
let rotateTimer=null;
let rotateStartedAt=0;
let rotatePointerId=null;
const ROTATE_LONG_PRESS_MS=350;
let baseData='',logoData='',logoSourceData='';
let baseImage=null,logoImage=null;
let productLibraryProducts=[];
let logoLibraryItems=[];
const currentTaskId=new URLSearchParams(location.search).get('task');
let taskDraft=null,lastResultPayload=null,generationWatcher=null,generationId=null;
function notifyTask(text,busy=false,updatedAt){if(currentTaskId&&window.parent!==window)window.parent.postMessage({type:'s7-task-status',taskId:currentTaskId,text,busy,updatedAt},location.origin);}

const esc=value=>String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const S7_BASE=location.pathname==='/s7'||location.pathname.startsWith('/s7/')?'/s7':'';
const s7Path=value=>S7_BASE&&typeof value==='string'&&value.startsWith('/')?`${S7_BASE}${value}`:value;
const logoLibraryPath=value=>S7_BASE?new URL(value,location.origin).href:s7Path(value);
const nativeFetch=window.fetch.bind(window);
let s7User=null;
let logoStorage=localStorage;
function requireLogin(){document.body.replaceChildren();const link=document.createElement('a');link.textContent='登录已失效，请返回主工作空间登录';link.href=S7_BASE?'/':`http://${location.hostname}:3210/`;link.target='_top';document.body.append(link);}
const fetch=async(input,init)=>{if(currentTaskId&&s7User&&init?.method==='POST'&&['/api/ai-render','/api/ai-process-logo','/api/process-logo','/api/render'].includes(input)){init={...init,body:JSON.stringify({...JSON.parse(init.body),taskId:currentTaskId})};}const response=await nativeFetch(typeof input==='string'?s7Path(input):input,init);if(s7User){const session=await nativeFetch(s7Path('/api/session'));const value=session.ok?await session.json():null;if(value?.user?.id!==s7User.id){requireLogin();throw Error('登录已变更，请重新进入个人空间');}if(init?.method==='POST'&&response.ok)await refreshHistory();}return response;};
{
 const response=await nativeFetch(s7Path('/api/session'));
 if(!response.ok){requireLogin();await new Promise(()=>{});}
 const session=await response.json();s7User=session.user;
 if(s7User){const prefix=`s7-user.${s7User.id}.${currentTaskId||'legacy'}.`;logoStorage={getItem:key=>localStorage.getItem(prefix+key),setItem:(key,value)=>localStorage.setItem(prefix+key,value),removeItem:key=>localStorage.removeItem(prefix+key)};
  setInterval(async()=>{try{const r=await nativeFetch(s7Path('/api/session'));const v=r.ok?await r.json():null;if(v?.user?.id!==s7User.id)requireLogin();}catch{requireLogin();}},10000);
 }
}
async function refreshHistory(){
 if(!s7User)return;
 let section=document.querySelector('#personal-history');if(!section){section=document.createElement('section');section.id='personal-history';section.className='panel';document.querySelector('main').append(section);}
 const response=await nativeFetch(s7Path('/api/my-space/history'+(currentTaskId?'?taskId='+encodeURIComponent(currentTaskId):'')));if(!response.ok){section.textContent='个人生成历史暂时无法读取';return;}
 const history=await response.json();section.innerHTML=`<h2>我的素材与生成历史</h2>${history.length?history.map(record=>`<details><summary>${esc(new Date(record.createdAt).toLocaleString())} · ${esc(record.kind)} · ${esc(record.model||'')}</summary><div class="result-grid">${record.images.map(image=>`<article><p>${esc(image.label)}</p><a href="${esc(s7Path(image.url))}" download><img src="${esc(s7Path(image.url))}" alt="${esc(image.label)}" loading="lazy" width="180"><p>下载图片</p></a>${image.label==='透明Logo'?`<button class="button secondary" data-restore-logo="${esc(image.url)}">使用此 Logo</button>`:''}</article>`).join('')}</div></details>`).join(''):'<p>生成完成后，素材和结果会保存在你的个人空间。</p>'}`;
 for(const button of section.querySelectorAll('[data-restore-logo]'))button.onclick=async()=>{try{const r=await fetch(button.dataset.restoreLogo);if(!r.ok)throw Error('Logo读取失败');const loaded=await fileData(await r.blob());const saved={data:loaded.data,name:'个人空间透明Logo.png'};saveLogo(logoStorage,saved);await useSavedLogo(saved);setStatus('已从个人空间恢复透明Logo','success');}catch(error){setStatus(error.message,'error');}};
}
function setStatus(message,type=''){status.textContent=message;status.className=`status ${type}`;taskDraft?.schedule();notifyTask(type==='busy'?'生成中…':type==='error'?'操作失败':type==='success'?'已完成':'编辑中',type==='busy');}
function fileData(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({dataUrl:String(reader.result),data:String(reader.result).split(',')[1]});reader.onerror=reject;reader.readAsDataURL(file);});}
function loadImage(dataUrl){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('图片无法读取'));image.src=dataUrl;});}
function setSelectedLogoPreview(dataUrl,name){if(!dataUrl){selectedLogoPreview.hidden=true;return;}selectedLogoThumbnail.src=dataUrl;selectedLogoThumbnail.alt=`${name||'已选 Logo'}预览`;document.querySelector('#logo-name').textContent=name||'已选择 Logo';selectedLogoPreview.hidden=false;}
async function selectProductLegacy(product){
  const response=await fetch(product.imageUrl);if(!response.ok)throw Error('产品标准图读取失败');
  const loaded=await fileData(await response.blob());
  baseData=loaded.data;baseImage=await loadImage(loaded.dataUrl);
  document.querySelector('#base-name').textContent=`产品库：${product.sku} · ${product.name}`;
  productLibraryPanel.hidden=true;drawPreview();setStatus(`已从产品库选择 ${product.sku}，可以继续拖动 Logo 定位。`,'success');
}
async function selectProduct(product){
  if(!product.templateUrl)return selectProductLegacy(product);
  const [imageResponse,templateResponse]=await Promise.all([fetch(product.imageUrl),fetch(product.templateUrl)]);
  if(!imageResponse.ok)throw Error('产品标准图读取失败');
  const loaded=await fileData(await imageResponse.blob());
  const templatePayload=templateResponse.ok?await templateResponse.json():null;
  baseData=loaded.data;baseImage=await loadImage(loaded.dataUrl);
  const masterTargets=masterTargetsFromTemplate(templatePayload?.template);
  if(masterTargets.length){
    targets.replaceChildren();targetNumber=0;selectedTargetId=masterTargets[0].id;
    masterTargets.forEach(addTarget);
    document.querySelector('#selected-target').textContent=`当前：${selectedTargetId}`;
  }
  document.querySelector('#base-name').textContent=`产品库：${product.sku} · ${product.name}`;
  productLibraryPanel.hidden=true;drawPreview();
  setStatus(masterTargets.length?`已选择 ${product.sku}，已加载产品母版 V${templatePayload.template.version}：${masterTargets.length} 个 Logo 固定区域。`:`已选择 ${product.sku}，该产品尚未发布母版，可继续手动定位 Logo。`,'success');
}
function renderProductLibrary(){
  const query=productLibrarySearch.value.trim().toUpperCase();
  if(!query){productLibraryList.innerHTML='<p class="hint">请输入 SKU 或产品名称后搜索。</p>';return;}
  const visible=productLibraryProducts.filter(product=>`${product.sku} ${product.name}`.toUpperCase().includes(query));
  productLibraryList.innerHTML=visible.length?visible.map(product=>`<article class="product-library-item"><img src="${esc(s7Path(product.imageUrl))}" alt="${esc(product.name)}标准图"><div><strong>${esc(product.sku)}</strong><span>${esc(product.name)}${product.category?` · ${esc(product.category)}`:''}</span></div><button type="button" class="button secondary" data-product-id="${esc(product.id)}">选择</button></article>`).join(''):'<p class="hint">产品库中没有匹配的启用产品。</p>';
  productLibraryList.querySelectorAll('[data-product-id]').forEach(button=>button.addEventListener('click',async()=>{
    const product=productLibraryProducts.find(item=>item.id===button.dataset.productId);if(!product)return;
    button.disabled=true;button.textContent='读取中…';
    try{await selectProduct(product);}catch(error){button.disabled=false;button.textContent='选择';setStatus(error.message,'error');}
  }));
}
async function openProductLibrary(){
  productLibraryPanel.hidden=!productLibraryPanel.hidden;if(productLibraryPanel.hidden)return;
  logoLibraryPanel.hidden=true;
  productLibraryList.textContent='正在读取产品库…';
  try{const response=await fetch('/api/product-library');const payload=await response.json();if(!response.ok)throw Error(payload.error||'产品库读取失败');productLibraryProducts=payload;renderProductLibrary();}
  catch(error){productLibraryList.innerHTML=`<p class="hint status error">${esc(error.message)}</p>`;}
}

function renderLogoLibrary(){
  const query=logoLibrarySearch.value.trim().toUpperCase();
  const visible=logoLibraryItems.filter(item=>String(item.name||'').toUpperCase().includes(query));
  logoLibraryList.innerHTML=visible.length?visible.map(item=>`<article class="product-library-item"><img src="${esc(logoLibraryPath(item.imageUrl))}" alt="${esc(item.name)}"><div><strong>${esc(item.name)}</strong><span>${esc(new Date(item.createdAt).toLocaleString())}</span></div><button type="button" class="button secondary" data-logo-id="${esc(item.id)}">选择</button></article>`).join(''):'<p class="hint">Logo 库中没有匹配的图片。</p>';
  logoLibraryList.querySelectorAll('[data-logo-id]').forEach(button=>button.addEventListener('click',async()=>{
    const item=logoLibraryItems.find(value=>value.id===button.dataset.logoId);if(!item)return;
    button.disabled=true;button.textContent='读取中…';
    try{
      const response=await fetch(logoLibraryPath(item.imageUrl));if(!response.ok)throw Error('Logo 库图片读取失败');
      const loaded=await fileData(await response.blob());
      logoSourceData=loaded.data;logoData=loaded.data;logoImage=await loadImage(loaded.dataUrl);processButton.disabled=false;
      setSelectedLogoPreview(loaded.dataUrl,`Logo 库：${item.name}`);
      logoLibraryPanel.hidden=true;processingPanel.hidden=true;drawPreview();setStatus(`已从 Logo 库选择 ${item.name}，可以继续定位或进行 AI 加工。`,'success');
    }catch(error){button.disabled=false;button.textContent='选择';setStatus(error.message,'error');}
  }));
}

async function openLogoLibrary(){
  logoLibraryPanel.hidden=!logoLibraryPanel.hidden;if(logoLibraryPanel.hidden)return;
  productLibraryPanel.hidden=true;logoLibraryList.textContent='正在读取 Logo 库…';
  try{const response=await fetch(logoLibraryPath('/api/logo-library'));const payload=await response.json();if(!response.ok)throw Error(payload.error||'Logo 库读取失败');logoLibraryItems=payload;renderLogoLibrary();}
  catch(error){logoLibraryList.innerHTML=`<p class="hint status error">${esc(error.message)}</p>`;}
}

function quadFromTarget(target){
  const width=target.widthRatio*canvas.width,height=logoImage?width*logoImage.naturalHeight/logoImage.naturalWidth:width,center={x:target.x*canvas.width,y:target.y*canvas.height};
  return [[-width/2,-height/2],[width/2,-height/2],[width/2,height/2],[-width/2,height/2]].map(([x,y])=>{const point=rotateLocal(center,x,y,target.rotation);return {x:point.x/canvas.width,y:point.y/canvas.height};});
}
function rowQuad(row){try{const quad=JSON.parse(row.dataset.quad||'');return Array.isArray(quad)&&quad.length===4?quad:null;}catch{return null;}}
function setRowQuad(row,quad){row.dataset.quad=JSON.stringify(quad);}

async function useSavedLogo(saved=loadSavedLogo(logoStorage)){
  if(!saved)throw Error('没有可使用的已保存 Logo');
  logoData=saved.data;logoSourceData=saved.sourceData||'';const dataUrl=`data:image/png;base64,${saved.data}`;logoImage=await loadImage(dataUrl);processButton.disabled=false;useSavedLogoButton.hidden=false;clearSavedLogoButton.hidden=false;setSelectedLogoPreview(dataUrl,`已使用：${saved.name}`);processingPanel.hidden=true;drawPreview();
}

async function restoreSavedLogo(){
  try{
    const saved=loadSavedLogo(logoStorage);
    if(!saved)return;
    await useSavedLogo(saved);document.querySelector('#logo-name').textContent=`已恢复：${saved.name}`;setStatus('已恢复上次加工完成的透明 Logo，无需再次生成。','success');
  }catch{clearSavedLogo(logoStorage);}
}

function addTarget(value={}){
  targetNumber++;
  const id=value.id||`target-${targetNumber}`;
  const row=document.createElement('div');
  row.className='target-row';
  row.dataset.targetId=id;
  row.dataset.masterLocked=String(value.masterLocked===true);
  row.dataset.masterZoneId=String(value.masterZoneId||'');
  row.dataset.moveEnabled=String(value.moveEnabled===true||value.masterLocked!==true);
  row.dataset.logoColor=value.color||'#000000';
  row.dataset.autoContrast=String(value.autoContrast!==false);
  if(value.quad)setRowQuad(row,value.quad);
  row.innerHTML=`<div class="target-head"><strong>目标 ${targetNumber}</strong><span class="target-actions"><button type="button" class="rotate-target">旋转90°</button><button type="button" class="quad-target">四点透视</button><button type="button" class="duplicate-target">复制 Logo</button><button type="button" class="remove-target">删除</button></span></div><div class="target-grid"><label>ID<input data-key="id" value="${esc(id)}" spellcheck="false"></label><label>X<input data-key="x" type="number" min="0" max="1" step=".01" value="${value.x??.5}"></label><label>Y<input data-key="y" type="number" min="0" max="1" step=".01" value="${value.y??.5}"></label><label>宽度比例<input data-key="widthRatio" type="number" min=".01" max="1" step=".01" value="${value.widthRatio??.2}"></label><label>旋转角度<input data-key="rotation" type="number" min="-180" max="180" step="1" value="${value.rotation??0}"></label><label>曲面弯曲<input data-key="curve" type="number" min="0" max="1" step=".05" value="${value.curve??0}"></label><label>光泽参考<select data-key="surface"><option value="free" ${!value.surface||value.surface==='free'?'selected':''}>自由光泽（默认）</option><option value="flat" ${value.surface==='flat'?'selected':''}>平面轻光</option><option value="cylinder" ${value.surface==='cylinder'?'selected':''}>弧面高光</option></select></label></div>`;
  const moveButton=document.createElement('button');
  moveButton.type='button';moveButton.className='move-target';moveButton.textContent=canMoveTarget(value)?'锁定位置':'移动位置';
  row.querySelector('.target-actions').prepend(moveButton);
  if(value.masterLocked){
    row.querySelectorAll('[data-key="x"],[data-key="y"],[data-key="rotation"],[data-key="curve"],[data-key="surface"]').forEach(input=>input.disabled=true);
    row.querySelectorAll('.quad-target,.duplicate-target,.remove-target').forEach(button=>button.disabled=true);
  }
  moveButton.onclick=event=>{event.stopPropagation();const target=collectTargets().find(item=>item.id===row.dataset.targetId);if(!target)return;setTargetMoveEnabled(target,!canMoveTarget(target));row.dataset.moveEnabled=String(target.moveEnabled);moveButton.textContent=canMoveTarget(target)?'锁定位置':'移动位置';refreshTargetSelection();drawPreview();setStatus(target.moveEnabled?'已开启移动：现在可以拖动这个 Logo。':'已锁定位置：需要再次点击“移动位置”才可拖动。','success');};
  row.addEventListener('click',event=>{if(event.target.closest('button'))return;selectedTargetId=row.dataset.targetId;refreshTargetSelection();drawPreview();});
  row.querySelector('.rotate-target').onclick=event=>{event.stopPropagation();const target=collectTargets().find(item=>item.id===row.dataset.targetId);if(!target)return;rotateTargetInPlace(target,-90);updateInputs(target);updateQuad(target);selectedTargetId=target.id;refreshTargetSelection();drawPreview();setStatus('已将 Logo 原地逆时针旋转 90°，中心位置和大小保持不变。','success');};
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

function collectTargets(){return [...targets.children].map(row=>({...Object.fromEntries([...row.querySelectorAll('[data-key]')].map(input=>[input.dataset.key,['id','surface'].includes(input.dataset.key)?input.value.trim():Number(input.value)])),quad:rowQuad(row)||undefined,color:row.dataset.logoColor||'#000000',autoContrast:row.dataset.autoContrast==='true',masterZoneId:row.dataset.masterZoneId||undefined,masterLocked:row.dataset.masterLocked==='true',moveEnabled:row.dataset.moveEnabled==='true'}));}
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
  const rotationLocal=rotationHandleLocalPosition(width,height,Math.max(24,canvas.width/120));
  return {center,scale:rotateLocal(center,width/2,height/2,target.rotation),rotation:rotateLocal(center,rotationLocal.x,rotationLocal.y,target.rotation),rotationReferenceAngle:Math.atan2(rotationLocal.y,rotationLocal.x)*180/Math.PI};
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
function drawRotationArrow(context,point,size,rotation){
  context.save();context.translate(point.x,point.y);context.rotate(rotation*Math.PI/180);
  const radius=size*.72,start=-Math.PI*.3,end=Math.PI*1.12;
  context.strokeStyle='#5369d9';context.lineWidth=Math.max(2,size*.12);context.lineCap='round';context.beginPath();context.arc(0,0,radius,start,end);context.stroke();
  const tip={x:Math.cos(end)*radius,y:Math.sin(end)*radius},tangent=end+Math.PI/2,head=size*.38;
  context.fillStyle='#5369d9';context.beginPath();context.moveTo(tip.x,tip.y);context.lineTo(tip.x-Math.cos(tangent-.7)*head,tip.y-Math.sin(tangent-.7)*head);context.lineTo(tip.x-Math.cos(tangent+.7)*head,tip.y-Math.sin(tangent+.7)*head);context.closePath();context.fill();
  context.restore();
}
function drawPreview(){
  taskDraft?.schedule();
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
      logoImage,width,height
    });
    const curvedLayer=curvePreviewLogo(logoLayer,target.curve);
    if(target.quad)drawQuadPreview(context,curvedLayer,target.quad);else{context.save();context.translate(target.x*canvas.width,target.y*canvas.height);context.rotate(target.rotation*Math.PI/180);context.globalAlpha=1;context.drawImage(curvedLayer,-width/2,-height/2,width,height);context.strokeStyle=target.id===selectedTargetId?'#5369d9':'#ffffff';context.lineWidth=Math.max(2,canvas.width/500);context.setLineDash(target.id===selectedTargetId?[]:[8,6]);context.strokeRect(-width/2,-height/2,width,height);context.restore();}
    if(target.id===selectedTargetId){const handles=handlePoints(target),size=Math.max(10,canvas.width/80);context.setLineDash([]);context.strokeStyle='#5369d9';context.lineWidth=Math.max(2,canvas.width/500);context.beginPath();context.moveTo(handles.center.x,handles.center.y);context.lineTo(handles.rotation.x,handles.rotation.y);context.stroke();context.fillStyle='#5369d9';context.fillRect(handles.scale.x-size/2,handles.scale.y-size/2,size,size);drawRotationArrow(context,handles.rotation,size*1.55,target.rotation);if(target.quad){const points=target.quad.map(point=>({x:point.x*canvas.width,y:point.y*canvas.height}));context.beginPath();context.moveTo(points[0].x,points[0].y);for(const point of points.slice(1))context.lineTo(point.x,point.y);context.closePath();context.stroke();for(const point of points)context.fillRect(point.x-size/2,point.y-size/2,size,size);}}
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
  else if(handles&&distance(point,handles.rotation)<=hitRadius){
    dragTarget=selected;dragMode='rotate-pending';rotatePointerId=event.pointerId;rotateStartedAt=Date.now();
    if(rotateTimer!==null)clearTimeout(rotateTimer);
    rotateTimer=setTimeout(()=>{if(dragTarget===selected&&dragMode==='rotate-pending'&&rotatePointerId===event.pointerId)dragMode='rotate';},ROTATE_LONG_PRESS_MS);
  }
  else{dragTarget=targetAt(normalized);if(dragTarget&&!canMoveTarget(dragTarget)){selectedTargetId=dragTarget.id;refreshTargetSelection();drawPreview();setStatus('该 Logo 的母版位置已锁定，请先点击目标卡片中的“移动位置”。','success');dragTarget=null;return;}dragMode=dragTarget?'move':null;}
  if(!dragTarget)return;selectedTargetId=dragTarget.id;canvas.setPointerCapture(event.pointerId);canvas.classList.add('dragging');refreshTargetSelection();drawPreview();
});
canvas.addEventListener('pointermove',event=>{
  if(!dragTarget)return;
  if(dragMode==='rotate-pending')return;
  const normalized=pointerToNormalized(event.clientX,event.clientY,canvas.getBoundingClientRect()),point={x:normalized.x*canvas.width,y:normalized.y*canvas.height};
  if(dragMode==='move'){const offsetX=normalized.x-dragTarget.x,offsetY=normalized.y-dragTarget.y;dragTarget.x=normalized.x;dragTarget.y=normalized.y;if(dragTarget.quad){dragTarget.quad=dragTarget.quad.map(corner=>({x:Math.min(1,Math.max(0,corner.x+offsetX)),y:Math.min(1,Math.max(0,corner.y+offsetY))}));updateQuad(dragTarget);}}
  if(dragMode==='scale')dragTarget.widthRatio=widthRatioFromScalePointer(dragTarget,point,canvas.width,canvas.height);
  if(dragMode==='rotate')dragTarget.rotation=rotationFromPointer({x:dragTarget.x*canvas.width,y:dragTarget.y*canvas.height},point,handlePoints(dragTarget).rotationReferenceAngle);
  if(!dragTarget.quad)keepTargetInsideCanvas(dragTarget);
  if(dragMode?.startsWith('quad-')){const index=Number(dragMode.slice(5));dragTarget.quad[index]={x:normalized.x,y:normalized.y};updateQuad(dragTarget);}
  updateInputs(dragTarget);drawPreview();
});
function endDrag(event){
  if(!dragTarget)return;
  const target=dragTarget,step=dragMode==='rotate-pending'&&event.type!=='pointercancel'&&rotationGestureMode(Date.now()-rotateStartedAt)==='step';
  if(rotateTimer!==null){clearTimeout(rotateTimer);rotateTimer=null;}
  if(step){rotateTargetInPlace(target,-90);updateInputs(target);updateQuad(target);refreshTargetSelection();drawPreview();setStatus('已自动将 Logo 逆时针旋转 90°。长按旋转箭头可进行自由旋转。','success');}
  dragTarget=null;dragMode=null;rotatePointerId=null;canvas.classList.remove('dragging');if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
}
canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);
canvas.addEventListener('contextmenu',event=>{
  if(!baseImage||!logoImage||!logoData)return;
  const normalized=pointerToNormalized(event.clientX,event.clientY,canvas.getBoundingClientRect());
  if(!targetAt(normalized))return;
  event.preventDefault();
  triggerTransparentLogoDownload(logoData,{filename:'logo-transparent.png'});
  setStatus('已保存透明 Logo PNG，可直接复用，无需再次调用 AI。','success');
});

document.querySelector('#add-target').onclick=()=>addTarget();
chooseProductButton.onclick=openProductLibrary;
closeProductLibraryButton.onclick=()=>{productLibraryPanel.hidden=true;};
productLibrarySearch.oninput=renderProductLibrary;
chooseLogoLibraryButton.onclick=openLogoLibrary;
closeLogoLibraryButton.onclick=()=>{logoLibraryPanel.hidden=true;};
logoLibrarySearch.oninput=renderLogoLibrary;
originalColorInput.oninput=()=>{const selectedRow=[...targets.children].find(row=>row.dataset.targetId===selectedTargetId);if(!selectedRow)return;selectedRow.dataset.logoColor=originalColorInput.value;originalColorValue.textContent=originalColorInput.value.toUpperCase();drawPreview();};
autoContrastInput.onchange=()=>{const selectedRow=[...targets.children].find(row=>row.dataset.targetId===selectedTargetId);if(!selectedRow)return;selectedRow.dataset.autoContrast=String(autoContrastInput.checked);drawPreview();};
document.querySelector('#logo-image').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{const loaded=await fileData(file),saved=loadSavedLogo(logoStorage);logoSourceData=loaded.data;if(saved?.sourceData===loaded.data){await useSavedLogo(saved);setStatus('已自动匹配并使用保存的透明 Logo，无需重新生成。','success');return;}logoData=loaded.data;logoImage=await loadImage(loaded.dataUrl);processButton.disabled=false;setSelectedLogoPreview(loaded.dataUrl,file.name);drawPreview();}catch(error){setStatus(error.message,'error');}};

useSavedLogoButton.onclick=async()=>{try{await useSavedLogo();setStatus('已使用保存的透明 Logo，无需重新生成。','success');}catch(error){setStatus(error.message,'error');}};
clearSavedLogoButton.onclick=()=>{clearSavedLogo(logoStorage);useSavedLogoButton.hidden=true;clearSavedLogoButton.hidden=true;setStatus('已清除保存的透明 Logo；当前页面中的 Logo 仍可继续使用。','success');};

processButton.onclick=()=>{if(logoData)processingPanel.hidden=false;};
document.querySelector('#cancel-processing').onclick=()=>{processingPanel.hidden=true;};
document.querySelector('#apply-processing').onclick=async()=>{
  if(!logoData)return;
  const targetColor=document.querySelector('input[name="logo-output-color"]:checked').value==='original'?'original':'#000000';
  const processingStatus=document.querySelector('#processing-status');processingStatus.textContent='正在调用 AI 图片模型…';
  try{
    const response=await fetch('/api/ai-process-logo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({logoImage:logoData,targetColor})});
    const payload=await response.json();if(!response.ok)throw Error(payload.error||'Logo加工失败');
    const logoName=targetColor==='original'?'AI 加工 Logo（保留原色）.png':'AI 加工 Logo（黑色）.png';
    logoData=payload.dataUrl.split(',')[1];logoImage=await loadImage(payload.dataUrl);saveLogo(logoStorage,{data:logoData,name:logoName,sourceData:logoSourceData});useSavedLogoButton.hidden=false;clearSavedLogoButton.hidden=false;setSelectedLogoPreview(payload.dataUrl,logoName);processingStatus.textContent=`AI 加工完成：${payload.width} × ${payload.height}`;processingPanel.hidden=true;drawPreview();setStatus(payload.logoLibrary?`AI Logo 已加工并保存到 Logo 库（${payload.logoLibrary.name}）。`:`AI Logo 已加工，但 Logo 库保存失败：${payload.logoLibraryError||'请稍后重试'}` ,payload.logoLibrary?'success':'error');
  }catch(error){processingStatus.textContent=error.message||'Logo加工失败';}
};

async function loadAiProviderStatus(){
  const hint=document.querySelector('#ai-provider-status');
  try{const response=await fetch('/api/ai-logo/status');const payload=await response.json();hint.textContent=payload.configured?`已连接 AI 图片模型：${payload.provider} / ${payload.model}`:'尚未配置 APIMart 图片模型，请先配置本机 APIMart 参数。';hint.className=`hint ${payload.configured?'provider-ready':'provider-missing'}`;}
  catch{hint.textContent='无法读取 AI 图片模型配置，请检查 S7 服务。';hint.className='hint provider-missing';}
}

async function loadMockupModels(){
  try{
    const response=await fetch('/api/ai-models'),payload=await response.json();
    if(!response.ok||!payload.configured||!Array.isArray(payload.models)||!payload.models.length)throw Error('尚未配置可用的 AI 成图模型');
    mockupModel.replaceChildren(...payload.models.map(model=>{const option=document.createElement('option');option.value=model;option.textContent=model;return option;}));
    mockupModel.value=payload.models.includes('flux-3-image')?'flux-3-image':payload.defaultModel&&payload.models.includes(payload.defaultModel)?payload.defaultModel:payload.models[0];
    mockupModelHint.textContent=`可选模型：${payload.models.join('、')}；默认使用 ${mockupModel.value}。`;
    mockupModel.disabled=false;
  }catch(error){
    mockupModel.replaceChildren(new Option('暂无可用模型',''));
    mockupModel.disabled=true;
    mockupModelHint.textContent=error.message||'无法读取 AI 成图模型配置。';
  }
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
  image.hidden=false;image.src=output.dataUrl;link.href=output.dataUrl;
}
async function regenerateResult(version,card){
  if(currentTaskId&&s7User){try{await submitBackgroundGeneration(version);}catch(error){setStatus(error.message,'error');}return;}
  const button=card.querySelector('.regenerate-result');
  if(!baseData||!logoData){setStatus('请先选择原图和透明 Logo。','error');return;}
  button.disabled=true;button.textContent='生成中…';
  try{
    const response=await fetch('/api/ai-render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({onlyVersion:version,model:mockupModel.value,baseImage:baseData,logoImage:logoData,targets:collectTargets(),originalColor:originalColorInput.value})});
    const payload=await response.json();if(!response.ok)throw Error(payload.error||'重新生成失败');
    const output=payload.outputs.find(item=>item.version===version);if(!output)throw Error(`没有返回 ${version} 结果`);
    updateResultCard(card,output);if(lastResultPayload){const image=payload.savedRecord?.images.find(item=>item.label===version);lastResultPayload.outputs=lastResultPayload.outputs.map(item=>item.version===version?{...output,dataUrl:image?s7Path(image.url):output.dataUrl}:item);}taskDraft?.schedule();setStatus(`${version} 已重新生成。`,'success');
  }catch(error){setStatus(error.message||'重新生成失败','error');}
  finally{button.disabled=false;button.textContent='重新生成';}
}
const versionInputs=[...document.querySelectorAll('#generation-versions input')];
const selectedGenerationVersions=()=>versionInputs.filter(input=>input.checked).map(input=>input.value);
let generationBusy=false;
function updateGenerateButton(){
 const count=selectedGenerationVersions().length,button=document.querySelector('#generate');
 button.textContent=count?`AI 生成 ${count} 个版本`:'请至少选择一个版本';
 button.disabled=generationBusy||!count;
}
for(const input of versionInputs)input.addEventListener('change',updateGenerateButton);
updateGenerateButton();
let resultCards=new Map();
function restoreGeneration(record){
  if(generationId!==record.id){generationId=record.id;beginResultProgress(record);}
  for(const [version,value]of Object.entries(record.stages))if(value.stage!=='complete')updateResultProgress(version,value.stage,value.error);
  for(const output of record.outputs){const card=resultCards.get(output.version);if(card&&card.dataset.stage!=='complete')completeResultProgress({...output,dataUrl:s7Path(output.dataUrl)});}
  const busy=record.status==='running',failed=Object.values(record.stages).filter(value=>value.stage==='failed').length;
  generationBusy=busy;updateGenerateButton();
  for(const button of results.querySelectorAll('.regenerate-result'))button.disabled=busy;
  resultMeta.textContent=busy?`已保存 ${record.outputs.length}/${Object.keys(record.stages).length} 张 · 后台生成中`:`已保存 ${record.outputs.length}/${Object.keys(record.stages).length} 张${failed?` · ${failed} 张可重试`:''}`;
  const text=busy?'后台正在生成，切换模块或退出登录后仍会继续。':record.status==='interrupted'?'服务已重启，已完成图片已保留，未完成版本可重试。':failed?'已保存成功的图片，失败版本可单独重试。':'所选版本已全部保存。';
  if(status.textContent!==text)setStatus(text,busy?'busy':failed?'error':'success');
}
async function submitBackgroundGeneration(onlyVersion){
  if(!baseData||!logoData)throw Error('请先选择原图和透明 Logo。');
  taskDraft?.schedule();await taskDraft?.flush();
  const response=await fetch('/api/ai-render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({background:true,onlyVersion,selectedVersions:selectedGenerationVersions(),model:mockupModel.value,baseImage:baseData,logoImage:logoData,targets:collectTargets(),originalColor:originalColorInput.value})});
  const record=await response.json();if(!response.ok)throw Error(record.error||'提交生成失败');
  generationWatcher.track(record);
}
function beginResultProgress(payload={}){
  emptyState.hidden=true;results.replaceChildren();resultCards=new Map();
  resultMeta.textContent=payload.targetIds?.length?`${payload.targetIds.length} 个目标 · 生成中`:'正在提交所选版本…';
  for(const version of payload.stages?Object.keys(payload.stages):(payload.selectedVersions||selectedGenerationVersions())){
    const card=document.createElement('article');card.className='result-card';card.dataset.version=version;
    const image=document.createElement('img');image.className='result-image';image.alt=version;image.hidden=true;
    const footer=document.createElement('footer');const title=document.createElement('strong');title.textContent=version;
    const stage=document.createElement('span');stage.className='result-stage';stage.textContent='等待提交';footer.append(title,stage);card.append(image,footer);results.append(card);resultCards.set(version,card);
  }
  lastResultPayload={...payload,outputs:[]};taskDraft?.schedule();
}
function updateResultProgress(version,stage,error){
  const card=resultCards.get(version);if(!card)return;
  const label={submitting:'提交中',generating:'生成中',saving:'保存中',failed:`失败：${error||'请重试'}`}[stage]||stage;
  card.querySelector('.result-stage').textContent=label;card.dataset.stage=stage;
  if(stage==='failed'&&!card.querySelector('.regenerate-result')){const actions=document.createElement('div');actions.className='result-actions';const button=document.createElement('button');button.type='button';button.className='regenerate-result';button.textContent='重试';button.onclick=()=>regenerateResult(version,card);actions.append(button);card.querySelector('footer').append(actions);}
}
function completeResultProgress(output){
  const card=resultCards.get(output.version);if(!card)return;
  const image=card.querySelector('.result-image');image.hidden=false;image.src=output.dataUrl;image.tabIndex=0;image.title='点击查看大图';image.onclick=()=>openImagePreview(output.version,image.src);image.onkeydown=event=>{if(event.key==='Enter'||event.key===' ')openImagePreview(output.version,image.src);};
  const stage=card.querySelector('.result-stage');stage.textContent='已保存';card.dataset.stage='complete';
  const actions=document.createElement('div');actions.className='result-actions';
  const link=document.createElement('a');link.className='download';link.href=output.dataUrl;link.download=`logo-mockup-${output.version.toLowerCase().replaceAll(' ','-')}.png`;link.textContent='下载 PNG';
  const regenerate=document.createElement('button');regenerate.type='button';regenerate.className='regenerate-result';regenerate.textContent='重新生成';regenerate.onclick=()=>regenerateResult(output.version,card);
  actions.append(link,regenerate);card.querySelector('footer').append(actions);
  if(lastResultPayload&&!lastResultPayload.outputs.some(item=>item.version===output.version))lastResultPayload.outputs.push(output);
  taskDraft?.schedule();
}
async function readProgressStream(response,onEvent){
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let boundary;
    while((boundary=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const event=block.match(/^event: (.+)$/m)?.[1],data=block.match(/^data: (.+)$/m)?.[1];if(event&&data)await onEvent(event,JSON.parse(data));}
    if(done)break;
  }
}
function renderResults(payload){
  payload=normalizeTaskResult(payload,s7Path);
  lastResultPayload=payload;taskDraft?.schedule();
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
  if(currentTaskId&&s7User){try{await submitBackgroundGeneration();}catch(error){setStatus(error.message,'error');}return;}
  if(!baseData||!logoData){setStatus('请先选择原图和透明 Logo。','error');return;}
  const selectedVersions=selectedGenerationVersions();if(!selectedVersions.length)return;
  generationBusy=true;updateGenerateButton();
  beginResultProgress({selectedVersions});setStatus(`已提交 ${mockupModel.value||'AI 图片模型'}，${selectedVersions.length} 个版本将分别更新进度。`,'busy');
  try{
    const response=await fetch('/api/ai-render',{method:'POST',headers:{'content-type':'application/json','accept':'text/event-stream'},body:JSON.stringify({selectedVersions,model:mockupModel.value,baseImage:baseData,logoImage:logoData,targets:collectTargets(),originalColor:originalColorInput.value})});
    if(!response.ok||!response.headers.get('content-type')?.includes('text/event-stream')){const payload=await response.json();throw Error(payload.error||'生成失败');}
    let failureCount=0;
    await readProgressStream(response,async(event,data)=>{
      if(event==='started'){lastResultPayload={...lastResultPayload,...data,outputs:[]};resultMeta.textContent=`${data.targetIds.length} 个目标 · 逐张生成中`;taskDraft?.schedule();}
      else if(event==='stage')updateResultProgress(data.version,data.stage,data.error);
      else if(event==='output'){const image=data.savedImage;completeResultProgress({version:data.version,dataUrl:image?s7Path(image.url):data.dataUrl});}
      else if(event==='done')failureCount=data.failures||0;
      else if(event==='fatal')throw Error(data.error||'生成失败');
    });
    resultMeta.textContent=failureCount?`已完成 ${selectedVersions.length-failureCount}/${selectedVersions.length} 张，${failureCount} 张失败`:'所选版本已全部保存';
    await taskDraft?.flush();await refreshHistory();setStatus(failureCount?`已生成并保存 ${selectedVersions.length-failureCount} 张，${failureCount} 张失败，可对失败版本单独重新生成。`:`${mockupModel.value||'AI 图片模型'} 已生成并保存 ${selectedVersions.length} 个版本。` ,failureCount?'error':'success');
  }catch(error){setStatus(error.message||'生成失败，请检查素材和目标设置。','error');}
  finally{generationBusy=false;updateGenerateButton();}
};

addTarget({id:'product',x:.5,y:.5,widthRatio:.2,rotation:0,curve:0,surface:'free'});
loadAiProviderStatus();
await loadMockupModels();
if(currentTaskId&&s7User){
 taskDraft=createTaskDraft({id:currentTaskId,
  request:async(url,data,method='GET')=>{const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});const value=await response.json();if(!response.ok)throw Error(value.error||'任务保存失败');return value;},
  capture:()=>({selectedVersions:selectedGenerationVersions(),baseData,logoData,logoSourceData,baseDataUrl:baseImage?.src||'',logoDataUrl:logoImage?.src||'',targets:collectTargets(),selectedTargetId,model:mockupModel.value,logoOutputColor:document.querySelector('input[name="logo-output-color"]:checked').value,baseName:document.querySelector('#base-name').textContent,logoName:document.querySelector('#logo-name').textContent,result:lastResultPayload}),
  onSaved:record=>{const busy=status.classList.contains('busy');notifyTask(busy?'生成中…':'已保存',busy,record.updatedAt);},onError:error=>{status.textContent=error.message;status.className='status error';notifyTask('保存失败');}});
 try{
  const state=await taskDraft.load();
  if(Array.isArray(state.selectedVersions)){for(const input of versionInputs)input.checked=state.selectedVersions.includes(input.value);updateGenerateButton();}
  baseData=state.baseData||'';logoData=state.logoData||'';logoSourceData=state.logoSourceData||'';
  baseImage=state.baseDataUrl?await loadImage(state.baseDataUrl):null;logoImage=state.logoDataUrl?await loadImage(state.logoDataUrl):null;
  if(state.targets?.length){targets.replaceChildren();targetNumber=0;state.targets.forEach(addTarget);selectedTargetId=state.selectedTargetId||state.targets[0].id;}
  for(const [id,key]of [['base-name','baseName'],['logo-name','logoName']])if(state[key])document.querySelector('#'+id).textContent=state[key];
  if(state.logoDataUrl)setSelectedLogoPreview(state.logoDataUrl,state.logoName||'已恢复 Logo');
  if(state.logoOutputColor)document.querySelectorAll('input[name="logo-output-color"]').forEach(input=>{input.checked=input.value===state.logoOutputColor;});
  if([...mockupModel.options].some(option=>option.value===state.model))mockupModel.value=state.model;
  processButton.disabled=!logoData;refreshTargetSelection();drawPreview();if(state.result)renderResults(state.result);
  taskDraft.activate();notifyTask('已恢复');
  generationWatcher=createGenerationWatcher({
   request:async()=>{const response=await fetch(`/api/my-space/tasks/${currentTaskId}/generation`);const record=await response.json();if(!response.ok)throw Object.assign(Error(record.error||'生成进度读取失败'),{status:response.status});return record;},
   onChange:record=>{restoreGeneration(record);if(record.status!=='running')refreshHistory().catch(()=>{});},
   onError:error=>{if(error.status!==401)setStatus('进度暂时无法读取，后台生成会继续；稍后自动重连。','error');}
  });
  await generationWatcher.refresh();
  window.addEventListener('pagehide',()=>generationWatcher.stop());
  document.addEventListener('input',()=>taskDraft.schedule());document.addEventListener('change',()=>taskDraft.schedule());
  window.addEventListener('beforeunload',event=>{if(taskDraft.isDirty()){event.preventDefault();event.returnValue='';}});
 }catch(error){setStatus(error.message,'error');document.querySelector('#generate').disabled=true;}
}else await restoreSavedLogo();
refreshHistory().catch(error=>setStatus(error.message,'error'));
