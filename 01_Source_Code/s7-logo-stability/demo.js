import {createSchemes,editScheme,copyTargetAppearance,restoreSharedGeometry,schemeSignature} from './schemes.mjs';
import {clampTargetCenter,pointerToNormalized,rotationFromPointer,widthRatioFromScalePointer} from './demo-geometry.mjs';
import {canMoveTarget,rotateTargetInPlace,setTargetMoveEnabled} from './target-state.mjs';
import {renderTintedLogoLayer} from './preview-logo-layer.mjs';
import {isCarton,resolveTargetPrint} from './target-print.mjs';
import {chooseContrastColor} from './contrast-color.mjs';
import {clearSavedLogo,loadSavedLogo,saveLogo} from './saved-logo.mjs';
import {masterTargetsFromTemplate} from './product-master.mjs';
import {triggerTransparentLogoDownload} from './transparent-logo-download.mjs';
import {rotationGestureMode,rotationHandleLocalPosition} from './rotation-handle.mjs';
import {createTaskDraft,normalizeTaskResult,restoredBaseProduct} from './task-draft.mjs';
import {createGenerationWatcher,previewStatus,productGeneration} from './generation-client.mjs';
import {downloadKey,syncDownloadSelection,selectedDownloadOutputs} from './download-selection.mjs';
import {createPreviewImages,previewImageUrl} from './preview-images.mjs';

const targets=document.querySelector('#targets');
const status=document.querySelector('#status');
const emptyState=document.querySelector('#empty-state');
const results=document.querySelector('#results');
const resultMeta=document.querySelector('#result-meta');
const downloadSelectedButton=document.querySelector('#download-selected');
const previewImages=createPreviewImages();let previewLoading=false,previewError='';
const multiProductTabs=document.querySelector('#multi-product-tabs');
const multiProductOutput=document.querySelector('#multi-product-output');
const previewSection=document.querySelector('.preview-section');
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
const imagePreview=document.querySelector('#image-preview');
const imagePreviewTitle=document.querySelector('#image-preview-title');
const imagePreviewImage=document.querySelector('#image-preview-image');
const imagePreviewViewport=document.querySelector('#image-preview-viewport');
const zoomReset=document.querySelector('#zoom-reset');
let schemeState=null,activeScheme='ORIGINAL',placementScope='shared',rebuildingTargets=false,schemePreviewFrame=null;
let submittedSignatures={},savedSignatures={},schemePhases={},showModifiedPreview=new Set();
let cachedAssetSource=[],cachedAssetKey='';
let thumbnailImages=[],thumbnailImageRevision=0;
const schemeNames={ORIGINAL:'原色方案',BLACK:'黑白方案','GOLD FOIL':'烫金搭配','SILVER FOIL':'烫银搭配'};
const carrierNames={BODY:'产品包材',CARTON_FRONT:'彩盒正面',CARTON_BACK:'彩盒背面'};
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
let multiPackageProducts=[],multiPackageBusy=false;
let multiProductResults=new Map(),selectedMultiProductId=null;
let multiProductViews=new Map(),loadedMultiProductId=null,multiProductLoadRevision=0,multiProductJob=null;
let logoLibraryItems=[];
const currentTaskId=new URLSearchParams(location.search).get('task');
let taskDraft=null,lastResultPayload=null,generationWatcher=null,generationId=null,taskActive=true;
let downloadSelection={},downloadingSelected=false,downloadSelectionReady=!currentTaskId;
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==window.parent||event.data?.type!=='s7-task-visibility'||event.data.taskId!==currentTaskId)return;taskActive=event.data.active;generationWatcher?.setActive(taskActive);});
function notifyTask(text,busy=false,updatedAt){if(currentTaskId&&window.parent!==window)window.parent.postMessage({type:'s7-task-status',taskId:currentTaskId,text,busy,updatedAt},location.origin);}

const esc=value=>String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const S7_BASE=location.pathname==='/s7'||location.pathname.startsWith('/s7/')?'/s7':'';
const s7Path=value=>S7_BASE&&typeof value==='string'&&value.startsWith('/')?`${S7_BASE}${value}`:value;
const logoLibraryPath=value=>S7_BASE?new URL(value,location.origin).href:s7Path(value);
const nativeFetch=window.fetch.bind(window);
let s7User=null;
let logoStorage=localStorage;
function requireLogin(){previewImages.clear();document.body.replaceChildren();const link=document.createElement('a');link.textContent='登录已失效，请返回主工作空间登录';link.href=S7_BASE?'/':`http://${location.hostname}:3210/`;link.target='_top';document.body.append(link);}
const fetch=async(input,init)=>{if(currentTaskId&&s7User&&init?.method==='POST'&&['/api/ai-render','/api/ai-render-multi','/api/ai-process-logo','/api/process-logo','/api/render'].includes(input)){init={...init,body:JSON.stringify({...JSON.parse(init.body),taskId:currentTaskId})};}const response=await nativeFetch(typeof input==='string'?s7Path(input):input,init);if(s7User){const session=await nativeFetch(s7Path('/api/session'));const value=session.ok?await session.json():null;if(session.status===401||(session.ok&&value?.user?.id!==s7User.id)){requireLogin();throw Error('登录已变更，请重新进入个人空间');}if(!session.ok)throw Error('认证服务暂时无法读取，请稍后重试');if(init?.method==='POST'&&response.ok)refreshHistory().catch(()=>{});}return response;};
{
 const response=await nativeFetch(s7Path('/api/session'));
 if(!response.ok){requireLogin();await new Promise(()=>{});}
 const session=await response.json();s7User=session.user;
 if(s7User){const prefix=`s7-user.${s7User.id}.${currentTaskId||'legacy'}.`;logoStorage={getItem:key=>localStorage.getItem(prefix+key),setItem:(key,value)=>localStorage.setItem(prefix+key,value),removeItem:key=>localStorage.removeItem(prefix+key)};
  setInterval(async()=>{if(!taskActive)return;try{const r=await nativeFetch(s7Path('/api/session'));const v=r.ok?await r.json():null;if(r.status===401||(r.ok&&v?.user?.id!==s7User.id))requireLogin();}catch{}},10000);
 }
}
async function refreshHistory(){
 if(!s7User)return;
 let section=document.querySelector('#personal-history');if(!section){section=document.createElement('section');section.id='personal-history';section.className='panel';document.querySelector('main').append(section);}
 const response=await nativeFetch(s7Path('/api/my-space/history'+(currentTaskId?'?taskId='+encodeURIComponent(currentTaskId):'')));if(!response.ok){section.textContent='个人生成历史暂时无法读取';return;}
 const history=(await response.json()).filter(record=>!['AI上样','多包材印刷效果','多 Logo 印刷效果'].includes(record.kind));section.hidden=!history.length;section.innerHTML=`<h2>我的 Logo 素材</h2>${history.map(record=>`<details><summary>${esc(new Date(record.createdAt).toLocaleString())} · ${esc(record.kind)} · ${esc(record.model||'')}</summary><div class="result-grid">${record.images.map(image=>`<article><p>${esc(image.label)}</p><a href="${esc(s7Path(image.url))}" download><img src="${esc(s7Path(image.url))}" alt="${esc(image.label)}" loading="lazy" width="180"><p>下载图片</p></a>${image.label==='透明Logo'?`<button class="button secondary" data-restore-logo="${esc(image.url)}">使用此 Logo</button>`:''}</article>`).join('')}</div></details>`).join('')}`;
 for(const button of section.querySelectorAll('[data-restore-logo]'))button.onclick=async()=>{try{const r=await fetch(button.dataset.restoreLogo);if(!r.ok)throw Error('Logo读取失败');const loaded=await fileData(await r.blob());const saved={data:loaded.data,name:'个人空间透明Logo.png'};saveLogo(logoStorage,saved);await useSavedLogo(saved);setStatus('已从个人空间恢复透明Logo','success');}catch(error){setStatus(error.message,'error');}};
}
function setStatus(message,type=''){status.textContent=message;status.className=`status ${type}`;taskDraft?.schedule();notifyTask(type==='busy'?'生成中…':type==='error'?'操作失败':type==='success'?'已完成':'编辑中',type==='busy');}
function fileData(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({dataUrl:String(reader.result),data:String(reader.result).split(',')[1]});reader.onerror=reject;reader.readAsDataURL(file);});}
function loadImage(dataUrl){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('图片无法读取'));image.src=dataUrl;});}
function setSelectedLogoPreview(dataUrl,name){if(!dataUrl){selectedLogoPreview.hidden=true;return;}multiProductResults=new Map();selectedLogoThumbnail.src=dataUrl;selectedLogoThumbnail.alt=`${name||'已选 Logo'}预览`;document.querySelector('#logo-name').textContent=name||'已选择 Logo';selectedLogoPreview.hidden=false;renderMultiProductResults();}
function renderProductLibrary(){
  const query=productLibrarySearch.value.trim().toUpperCase();
  if(!query){productLibraryList.innerHTML='<p class="hint">请输入 SKU 或产品名称后搜索。</p>';return;}
  const visible=productLibraryProducts.filter(product=>`${product.sku} ${product.name}`.toUpperCase().includes(query));
  productLibraryList.innerHTML=visible.length?visible.map(product=>`<article class="product-library-item"><img src="${esc(s7Path(product.imageUrl))}" alt="${esc(product.name)}标准图"><div><strong>${esc(product.sku)}</strong><span>${esc(product.name)}${product.category?` · ${esc(product.category)}`:''}${product.hasMaster?'':' · 缺少母版'}</span></div><label class="batch-product-check"><input type="checkbox" data-batch-product-id="${esc(product.id)}" aria-label="选择 ${esc(product.sku)} 的效果图" title="选择 ${esc(product.sku)} 的效果图" ${multiPackageProducts.some(item=>item.id===product.id)?'checked':''} ${product.hasMaster?'':'disabled'}></label></article>`).join(''):'<p class="hint">产品库中没有匹配的启用产品。</p>';
  productLibraryList.querySelectorAll('[data-batch-product-id]').forEach(input=>input.addEventListener('change',()=>{
    const product=productLibraryProducts.find(item=>item.id===input.dataset.batchProductId);
    if(input.checked&&product&&!multiPackageProducts.some(item=>item.id===product.id))multiPackageProducts.push({id:product.id,sku:product.sku,name:product.name,imageUrl:product.imageUrl});
    if(!input.checked){multiPackageProducts=multiPackageProducts.filter(item=>item.id!==input.dataset.batchProductId);multiProductResults.delete(input.dataset.batchProductId);if(selectedMultiProductId===input.dataset.batchProductId)selectedMultiProductId=multiPackageProducts[0]?.id||null;}
    renderMultiProductResults();updateGenerateButton();taskDraft?.schedule();
    if(selectedMultiProductId&&selectedMultiProductId!==loadedMultiProductId)showMultiProduct(selectedMultiProductId);
  }));
}

function saveMultiProductView(){
  if(!loadedMultiProductId)return;
  syncSchemeState();
  multiProductViews.set(loadedMultiProductId,{baseData,baseImage,targets:structuredClone(collectTargets()),schemeState:structuredClone(schemeState),activeScheme,placementScope,selectedTargetId,lastResultPayload,savedSignatures:{...savedSignatures},schemePhases:structuredClone(schemePhases)});
}
function captureMultiProductLayouts(){
  saveMultiProductView();
  return multiPackageProducts.flatMap(product=>{
    const view=multiProductViews.get(product.id);if(!view?.schemeState)return [];
    return [{productId:product.id,targets:view.targets,schemeState:structuredClone(view.schemeState),activeScheme:view.activeScheme,placementScope:view.placementScope,selectedTargetId:view.selectedTargetId,savedSignatures:{...view.savedSignatures}}];
  });
}
async function showMultiProduct(id){
  const product=multiPackageProducts.find(item=>item.id===id);if(!product)return;
  selectedMultiProductId=id;renderMultiProductResults();
  const revision=++multiProductLoadRevision;
  queueSchemeCards();
  if(loadedMultiProductId===id)return;
  saveMultiProductView();
  setStatus(`正在加载 ${product.sku} 的四种方案预览…`,'busy');
  try{
    let view=multiProductViews.get(id);
    if(!view?.baseImage){
      const [imageResponse,templateResponse]=await Promise.all([fetch(product.imageUrl||`/api/product-library/image/${encodeURIComponent(id)}`),fetch(`/api/product-library/template/${encodeURIComponent(id)}`)]);
      if(!imageResponse.ok||!templateResponse.ok)throw Error('产品原图或母版读取失败');
      const [loaded,payload]=await Promise.all([fileData(await imageResponse.blob()),templateResponse.json()]);
      const image=await loadImage(loaded.dataUrl),masterTargets=masterTargetsFromTemplate(payload.template);
      if(!masterTargets.length)throw Error('该产品母版没有 Logo 区域');
      view={schemeState:createSchemes(masterTargets),targets:masterTargets,activeScheme:'ORIGINAL',placementScope:'shared',selectedTargetId:masterTargets[0].id,lastResultPayload:null,savedSignatures:{},schemePhases:{},...view,baseData:loaded.data,baseImage:image};
      multiProductViews.set(id,view);
    }
    if(revision!==multiProductLoadRevision||selectedMultiProductId!==id)return;
    baseData=view.baseData;baseImage=view.baseImage;schemeState=structuredClone(view.schemeState);activeScheme=view.activeScheme;placementScope=view.placementScope;selectedTargetId=view.selectedTargetId;
    lastResultPayload=view.lastResultPayload||null;savedSignatures={...view.savedSignatures};schemePhases=structuredClone(view.schemePhases||{});submittedSignatures={};showModifiedPreview=new Set();
    loadedMultiProductId=id;document.querySelector('#preview-version').value=activeScheme;
    document.querySelector('#base-name').textContent=`产品库：${product.sku} · ${product.name}`;
    loadSchemeTargets();renderMultiProductResults();
    setStatus(`已显示 ${product.sku} 的四种方案预览。`,'success');
    if(multiProductJob)restoreMultiProductGeneration(multiProductJob);
  }catch(error){if(revision===multiProductLoadRevision)setStatus(error.message,'error');}
}

function renderMultiProductResults(){
  const previewProducts=multiPackageProducts;
  const active=previewProducts.length>0;
  if(active&&!previewProducts.some(product=>product.id===selectedMultiProductId))selectedMultiProductId=previewProducts[0].id;
  multiProductTabs.hidden=!active;
  multiProductOutput.hidden=true;
  results.hidden=false;
  previewSection.hidden=false;
  if(!active){multiProductTabs.replaceChildren();delete multiProductTabs.dataset.products;multiProductOutput.replaceChildren();resultMeta.textContent='选择方案查看和调整';return;}
  if(!previewProducts.some(product=>product.id===selectedMultiProductId))selectedMultiProductId=previewProducts[0].id;
  const tabKey=JSON.stringify(previewProducts.map(product=>[product.id,product.sku,product.imageUrl]));
  if(multiProductTabs.dataset.products!==tabKey){
    multiProductTabs.innerHTML=previewProducts.map(product=>{
      const imageUrl=s7Path(product.imageUrl||`/api/product-library/image/${encodeURIComponent(product.id)}`);
      return `<button type="button" class="multi-product-tab" data-multi-product-id="${esc(product.id)}"><img src="${esc(imageUrl+'?thumbnail=1')}" alt=""><span><strong>${esc(product.sku)}</strong><small></small></span></button>`;
    }).join('');
    multiProductTabs.dataset.products=tabKey;
    multiProductTabs.querySelectorAll('[data-multi-product-id]').forEach(button=>button.addEventListener('click',()=>showMultiProduct(button.dataset.multiProductId)));
  }
  for(const product of previewProducts){
    const result=multiProductResults.get(product.id);
    const progress=multiProductJob?productGeneration(multiProductJob,product.id):null;
    const completed=progress?Object.values(progress.stages).filter(value=>value.stage==='complete').length:0;
    const state=progress?completed===4?'已生成完成':`${completed}/4 已完成${multiPackageBusy?' · 生成中':''}`:result?.error?'生成失败':result?.images?(result.complete?'已生成完成':'部分完成'):multiPackageBusy?'处理中':'方案预览';
    const button=[...multiProductTabs.querySelectorAll('[data-multi-product-id]')].find(button=>button.dataset.multiProductId===product.id);
    button.classList.toggle('active',product.id===selectedMultiProductId);button.setAttribute('aria-pressed',String(product.id===selectedMultiProductId));button.querySelector('small').textContent=state;
  }
  const product=previewProducts.find(item=>item.id===selectedMultiProductId);
  resultMeta.textContent=product?`${product.sku} · ${product.name}`:'批量包材效果';
  multiProductOutput.replaceChildren();
}
async function openProductLibrary(){
  productLibraryPanel.hidden=!productLibraryPanel.hidden;if(productLibraryPanel.hidden)return;
  logoLibraryPanel.hidden=true;
  productLibraryList.textContent='正在读取产品库…';
  try{const response=await fetch('/api/product-library');const payload=await response.json();if(!response.ok)throw Error(payload.error||'产品库读取失败');productLibraryProducts=payload;renderProductLibrary();}
  catch(error){productLibraryList.innerHTML=`<p class="hint status error">${esc(error.message)}</p>`;}
}
productLibrarySearch.addEventListener('input',renderProductLibrary);

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

function syncSchemeState(){
  if(rebuildingTargets)return;
  const current=collectTargets();if(!current.length)return;
  schemeState=schemeState?editScheme(schemeState,activeScheme,current,placementScope==='shared'):createSchemes(current);
  updateSchemeHeading();
}
function updateSchemeHeading(){
  document.querySelector('#active-scheme-title').textContent=schemeNames[activeScheme];
  document.querySelector('#canvas-scheme-title').textContent=`${schemeNames[activeScheme]} · 编辑预览`;
  document.querySelectorAll('[data-scope]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.scope===placementScope)));
  document.querySelector('#restore-shared').hidden=!schemeState?.schemes.find(scheme=>scheme.version===activeScheme)?.independentGeometry;
}
function loadSchemeTargets(){
  rebuildingTargets=true;targets.replaceChildren();targetNumber=0;
  const current=schemeState.schemes.find(scheme=>scheme.version===activeScheme);
  if(!current.targets.some(target=>target.id===selectedTargetId))selectedTargetId=current.targets[0]?.id;
  current.targets.forEach(addTarget);rebuildingTargets=false;
  refreshTargetSelection();updateSchemeHeading();drawPreview();
}
function switchScheme(version){
  if(!schemeState)return;
  syncSchemeState();closePrintMenus();activeScheme=version;document.querySelector('#preview-version').value=version;
  placementScope=schemeState.schemes.find(scheme=>scheme.version===version).independentGeometry?'current':'shared';
  loadSchemeTargets();
}
function assetKey(){
  if(baseData!==cachedAssetSource[0]||logoData!==cachedAssetSource[1]||mockupModel.value!==cachedAssetSource[2]){cachedAssetSource=[baseData,logoData,mockupModel.value];cachedAssetKey=schemeSignature({version:'assets',targets:[{id:cachedAssetSource.join('|')}]});}
  return cachedAssetKey;
}
function currentSignatures(){return Object.fromEntries((schemeState?.schemes||[]).map(scheme=>[scheme.version,schemeSignature(scheme,assetKey())]));}
function schemeOutput(version){
 if(selectedMultiProductId!==loadedMultiProductId){
  if(!multiProductJob)return multiProductViews.get(selectedMultiProductId)?.lastResultPayload?.outputs?.find(output=>output.version===version);
  const output=multiProductJob.outputs.find(output=>output.productId===selectedMultiProductId&&output.version===version);return output?{...output,dataUrl:s7Path(output.dataUrl)}:undefined;
 }
 return lastResultPayload?.outputs?.find(output=>output.version===version);
}
function modifiedSchemes(){const signatures=currentSignatures();return Object.keys(schemeNames).filter(version=>schemeOutput(version)&&savedSignatures[version]!==signatures[version]);}
function queueSchemeCards(){
  if(schemePreviewFrame!==null)return;
  schemePreviewFrame=requestAnimationFrame(()=>{schemePreviewFrame=null;renderSchemeCards();});
}
function drawSchemeThumbnail(thumbnail,scheme){
  if(!baseImage){thumbnail.width=320;thumbnail.height=160;thumbnail.getContext('2d').clearRect(0,0,320,160);return;}
  thumbnail.width=Math.min(768,baseImage.naturalWidth);thumbnail.height=Math.round(thumbnail.width*baseImage.naturalHeight/baseImage.naturalWidth);
  const context=thumbnail.getContext('2d');context.drawImage(baseImage,0,0,thumbnail.width,thumbnail.height);if(!logoImage)return;
  const pixels=context.getImageData(0,0,thumbnail.width,thumbnail.height).data;
  for(const target of scheme.targets){
    const width=target.widthRatio*thumbnail.width,height=width*logoImage.naturalHeight/logoImage.naturalWidth;
    const contrast=chooseContrastColor({data:pixels,width:thumbnail.width,height:thumbnail.height,left:target.x*thumbnail.width-width/2,top:target.y*thumbnail.height-height/2,boxWidth:width,boxHeight:height});
    const print=resolveTargetPrint(target,scheme.version,target.color||'#000000',contrast);
    const layer=curvePreviewLogo(renderTintedLogoLayer({createCanvas:(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;},logoImage,width,height,color:print.color,finish:print.finish}),target.curve);
    if(target.quad)drawQuadPreview(context,layer,target.quad);else{context.save();context.translate(target.x*thumbnail.width,target.y*thumbnail.height);context.rotate((target.rotation||0)*Math.PI/180);context.drawImage(layer,-width/2,-height/2,width,height);context.restore();}
  }
}
function appearanceSummary(scheme){
  return scheme.targets.map(target=>{const print=resolveTargetPrint(target,scheme.version,target.color||'#000000');const effect=print.version==='BLACK'?(target.autoContrast?'自动黑/白':'黑色印刷'):print.finish==='gold'?'烫金':print.finish==='silver'?'烫银':`普通印刷 ${target.preserveOriginalColor?'Logo 原色':target.color||'原色'}`;return `${carrierNames[target.carrierType]||'产品包材'}：${effect}`;}).join(' · ');
}
function taskDownloadOutputs(){
 if(multiPackageProducts.length>1&&multiProductJob)return multiProductJob.outputs.filter(output=>multiPackageProducts.some(product=>product.id===output.productId)).map(output=>({...output,dataUrl:s7Path(output.dataUrl)}));
 return (lastResultPayload?.outputs||[]).map(output=>({...output,productId:output.productId||loadedMultiProductId||''}));
}
function updateDownloadSelection(){
 const outputs=taskDownloadOutputs(),next=syncDownloadSelection(downloadSelection,outputs);
 if(downloadSelectionReady&&next!==downloadSelection){downloadSelection=next;taskDraft?.schedule();}
 const count=selectedDownloadOutputs(downloadSelection,outputs).length;
 downloadSelectedButton.disabled=downloadingSelected||!count;
 downloadSelectedButton.textContent=downloadingSelected?'正在打包…':'下载选择图片';downloadSelectedButton.title=`已选择 ${count} 张图片（包含此任务所有产品）`;
}
downloadSelectedButton.onclick=async()=>{
 const selected=selectedDownloadOutputs(downloadSelection,taskDownloadOutputs());if(!selected.length||downloadingSelected)return;
 downloadingSelected=true;updateDownloadSelection();
 try{
  await taskDraft?.flush();
  let blob,filename='任务图片.zip';
  if(currentTaskId&&s7User){
   const response=await fetch(`/api/my-space/tasks/${currentTaskId}/download`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:selected.map(output=>output.dataUrl.replace(/^\/s7(?=\/api\/)/,''))})});
   if(!response.ok)throw Error((await response.json()).error||'图片下载失败');
   blob=await response.blob();const name=response.headers.get('content-disposition')?.match(/filename\*=UTF-8''(.+)$/)?.[1];if(name)filename=decodeURIComponent(name);
  }else{
   const {zipStore}=await import('./download-archive.mjs'),files=[];let total=0;
   if(selected.length>200)throw Error('每次最多下载 200 张');
   for(const [index,output]of selected.entries()){
    const response=await nativeFetch(output.dataUrl);if(!response.ok)throw Error('图片读取失败，请重试');
    const bytes=new Uint8Array(await response.arrayBuffer());total+=bytes.length;if(total>300*1024*1024)throw Error('本次下载超过 300 MB，请分批选择');
    const sku=multiPackageProducts.find(product=>product.id===output.productId)?.sku||'效果图';
    files.push({name:`${index+1}-${sku.replace(/[<>:"/\\|?*]/g,'_')}-${output.version}.png`,bytes});
   }
   blob=new Blob([zipStore(files)],{type:'application/zip'});
  }
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }catch(error){setStatus(error.message||'图片下载失败','error');}
 finally{downloadingSelected=false;updateDownloadSelection();}
};
function renderSchemeCards(){
  if(!schemeState)return;
  updateDownloadSelection();
  if(thumbnailImages[0]!==baseImage||thumbnailImages[1]!==logoImage){thumbnailImages=[baseImage,logoImage];thumbnailImageRevision++;}
  const signatures=currentSignatures(),switching=!!selectedMultiProductId&&selectedMultiProductId!==loadedMultiProductId;
  const switchingProgress=switching&&multiProductJob?productGeneration(multiProductJob,selectedMultiProductId):null,entries=[];
  for(const scheme of schemeState.schemes){
    const card=resultCards.get(scheme.version);if(!card)continue;
    const output=schemeOutput(scheme.version),phase=switchingProgress?switchingProgress.stages[scheme.version]:schemePhases[scheme.version],dirty=!switching&&!!output&&savedSignatures[scheme.version]!==signatures[scheme.version];
    card.classList.toggle('active',scheme.version===activeScheme);card.classList.toggle('modified',dirty);
    card.dataset.stage=phase?.stage|| (output?'complete':'preview');
    const useImage=!!output&&!(dirty&&showModifiedPreview.has(scheme.version));
    const image=card.querySelector('.result-image'),thumbnail=card.querySelector('canvas');thumbnail.hidden=useImage||switching;
    entries.push({image,url:useImage?previewImageUrl(output.dataUrl):null});
    const thumbnailKey=`${signatures[scheme.version]}:${thumbnailImageRevision}`;
    if(!switching&&!useImage&&thumbnail.dataset.signature!==thumbnailKey){drawSchemeThumbnail(thumbnail,scheme);thumbnail.dataset.signature=thumbnailKey;}
    card.querySelector('.scheme-summary').textContent=switching?'正在加载此产品的编辑素材…':appearanceSummary(scheme);
    card.querySelector('.edit-scheme').disabled=switching;
    card.querySelector('.scheme-image-kind').textContent=useImage?(dirty?'上次成图':'生成结果'):baseImage?'效果示意':'选择产品与 Logo 后预览';
    const progress=previewStatus(output,phase,dirty),overlay=card.querySelector('.generation-overlay');overlay.hidden=!progress.busy&&!(useImage&&(previewLoading||previewError));overlay.querySelector('.generation-label').textContent=progress.busy?progress.label:previewError||'正在加载预览';
    overlay.onclick=()=>{if(previewError){previewImages.retry();previewError='';queueSchemeCards();}};
    card.classList.toggle('generated-complete',progress.complete);card.querySelector('.result-stage').textContent=progress.label;
    if(progress.complete)card.querySelector('.scheme-image-kind').textContent='已生成完成';
    const selection=card.querySelector('.select-download'),download=output&&{...output,productId:output.productId||loadedMultiProductId||''};selection.disabled=!output;selection.checked=!!download&&!!downloadSelection[downloadKey(download)]?.selected;
    const retry=card.querySelector('.regenerate-result');retry.hidden=(multiPackageProducts.length>1&&!(currentTaskId&&s7User))||(!output&&phase?.stage!=='failed');retry.disabled=generationBusy||multiPackageBusy||switching;retry.textContent=phase?.stage==='failed'&&lastResultPayload?.remoteTasks?.[scheme.version]&&lastResultPayload?.schemeSignatures?.[scheme.version]===signatures[scheme.version]?'继续获取结果':'重新生成';
    const compare=card.querySelector('.compare-result');compare.hidden=!dirty;compare.textContent=useImage?'看修改预览':'看上次成图';
  }
  previewImages.show(JSON.stringify([selectedMultiProductId,entries.map(entry=>entry.url)]),entries,{onLoading:()=>{previewLoading=true;previewError='';queueSchemeCards();},onReady:()=>{previewLoading=false;queueSchemeCards();},onError:()=>{previewLoading=false;previewError='预览加载失败，点击重试';queueSchemeCards();}});
  updateGenerateButton();
}
function createSchemeCards(){
  results.replaceChildren();resultCards=new Map();
  for(const [version,name]of Object.entries(schemeNames)){
    const card=document.createElement('article');card.className='result-card scheme-card';card.dataset.version=version;
    card.innerHTML='<div class="scheme-card-head"><label></label><button type="button" class="text-button edit-scheme">编辑此方案</button></div><div class="scheme-image"><canvas></canvas><img class="result-image" hidden><span class="scheme-image-kind"></span><div class="generation-overlay" role="status" hidden><span class="progress-ring" aria-hidden="true"></span><strong class="generation-label"></strong></div></div><p class="scheme-summary"></p><footer><span class="result-stage"></span><div class="result-actions"><button type="button" class="text-button compare-result" hidden></button><button type="button" class="regenerate-result" hidden>重新生成</button><input type="checkbox" class="select-download" disabled></div></footer>';
    const input=versionInputs.find(input=>input.value===version);card.querySelector('label').append(input,document.createTextNode(name));
    card.querySelector('.edit-scheme').onclick=()=>switchScheme(version);
    const thumbnail=card.querySelector('canvas');thumbnail.setAttribute('aria-label',`${name}效果示意`);thumbnail.onclick=()=>switchScheme(version);
    const image=card.querySelector('img');image.alt=`${name}生成结果`;image.onclick=()=>{const output=schemeOutput(version);if(output)openImagePreview(name,output.dataUrl);};
    const selection=card.querySelector('.select-download');selection.setAttribute('aria-label',`选择下载${name}`);selection.title=`选择下载${name}`;
    selection.onchange=()=>{const output=schemeOutput(version);if(!output)return;const key=downloadKey({...output,productId:output.productId||loadedMultiProductId||''});downloadSelection={...downloadSelection,[key]:{dataUrl:output.dataUrl,selected:selection.checked}};taskDraft?.schedule();updateDownloadSelection();};
    card.querySelector('.regenerate-result').onclick=()=>regenerateResult(version,card);
    card.querySelector('.compare-result').onclick=()=>{showModifiedPreview.has(version)?showModifiedPreview.delete(version):showModifiedPreview.add(version);queueSchemeCards();};
    results.append(card);resultCards.set(version,card);
  }
}
for(const button of document.querySelectorAll('[data-scope]'))button.onclick=()=>{syncSchemeState();placementScope=button.dataset.scope;updateSchemeHeading();taskDraft?.schedule();};
document.querySelector('#restore-shared').onclick=()=>{schemeState=restoreSharedGeometry(schemeState,activeScheme);placementScope='shared';loadSchemeTargets();};
document.querySelector('#copy-appearance').onclick=()=>{
  syncSchemeState();const dialog=document.querySelector('#copy-scheme-dialog'),options=document.querySelector('#copy-scheme-options');options.replaceChildren();
  document.querySelector('#copy-region-name').textContent=`${schemeNames[activeScheme]} · ${targets.querySelector('.selected .target-head strong')?.textContent||'当前区域'}的颜色和工艺`;
  for(const [version,name]of Object.entries(schemeNames))if(version!==activeScheme){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=version;label.append(input,name);options.append(label);}
  dialog.showModal();
};
document.querySelector('#confirm-copy').onclick=event=>{
  const versions=[...document.querySelectorAll('#copy-scheme-options input:checked')].map(input=>input.value);
  if(!versions.length){event.preventDefault();return;}
  schemeState=copyTargetAppearance(schemeState,activeScheme,selectedTargetId,versions);queueSchemeCards();taskDraft?.schedule();
};

function closePrintMenus(){
  for(const menu of document.querySelectorAll('.print-select-menu:not([hidden])')){
    menu.hidden=true;menu.parentElement.querySelector('.print-select-trigger').setAttribute('aria-expanded','false');
  }
}
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.print-select'))closePrintMenus();});
window.addEventListener('blur',closePrintMenus);

function createPrintDropdown(select,onOpen){
  const wrapper=select.parentElement;wrapper.classList.add('print-select');
  const label=wrapper.firstChild.textContent.trim();select.hidden=true;
  const trigger=document.createElement('button');trigger.type='button';trigger.className='print-select-trigger';
  trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
  const menu=document.createElement('div');menu.className='print-select-menu';menu.hidden=true;
  menu.id=`print-options-${select.closest('.target-row').dataset.targetId}-${select.dataset.key}`;
  menu.setAttribute('role','listbox');menu.setAttribute('aria-label',label);trigger.setAttribute('aria-controls',menu.id);
  const options=[...select.options].map(option=>{
    const button=document.createElement('button');button.type='button';button.className='print-select-option';
    button.textContent=option.textContent;button.setAttribute('role','option');
    button.onclick=event=>{event.stopPropagation();if(option.disabled)return;select.value=option.value;refresh();closePrintMenus();select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));trigger.focus();};
    menu.append(button);return {option,button};
  });
  function refresh(){
    trigger.textContent=select.selectedOptions[0]?.textContent||'';trigger.setAttribute('aria-label',`${label}：${trigger.textContent}`);
    for(const {option,button} of options){button.disabled=option.disabled;button.setAttribute('aria-selected',String(option.selected));}
  }
  function open(){closePrintMenus();onOpen();refresh();menu.hidden=false;trigger.setAttribute('aria-expanded','true');}
  trigger.onclick=event=>{event.stopPropagation();if(menu.hidden)open();else closePrintMenus();};
  trigger.onkeydown=event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open();(options.find(({option})=>option.selected&&!option.disabled)||options.find(({option})=>!option.disabled))?.button.focus();}};
  wrapper.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();closePrintMenus();trigger.focus();}
    if(event.target===trigger)return;
    const enabled=options.filter(({button})=>!button.disabled).map(({button})=>button),index=enabled.indexOf(document.activeElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?enabled.length-1:(index+(event.key==='ArrowDown'?1:-1)+enabled.length)%enabled.length;enabled[next]?.focus();}
  });
  wrapper.addEventListener('focusout',event=>{if(!wrapper.contains(event.relatedTarget))closePrintMenus();});
  select.addEventListener('input',refresh);wrapper.append(trigger,menu);refresh();return refresh;
}

function addTarget(value={}){
  targetNumber++;
  const existingIds=new Set([...targets.children].map(row=>row.dataset.targetId));
  while(!value.id&&existingIds.has(`target-${targetNumber}`))targetNumber++;
  const id=value.id||`target-${targetNumber}`;
  const row=document.createElement('div');
  row.className='target-row';
  row.dataset.targetId=id;
  row.dataset.masterLocked=String(value.masterLocked===true);
  row.dataset.masterZoneId=String(value.masterZoneId||'');
  row.dataset.moveEnabled=String(value.moveEnabled===true||value.masterLocked!==true);
  row.dataset.logoColor=value.color||'#000000';
  row.dataset.keepOriginal=String(value.preserveOriginalColor??!value.color);
  row.dataset.autoContrast=String(value.autoContrast!==false);
  if(value.quad)setRowQuad(row,value.quad);
  row.innerHTML=`<div class="target-head"><strong>${carrierNames[value.carrierType]||'产品包材'}</strong><span class="target-actions"><button type="button" class="rotate-target">旋转90°</button><button type="button" class="remove-target">删除</button></span></div><div class="target-grid"><input type="hidden" data-key="id" value="${esc(id)}"><input type="hidden" data-key="x" value="${value.x??.5}"><input type="hidden" data-key="y" value="${value.y??.5}"><input type="hidden" data-key="widthRatio" value="${value.widthRatio??.2}"><input type="hidden" data-key="rotation" value="${value.rotation??0}"><input type="hidden" data-key="curve" value="${value.curve??0}"><input type="hidden" data-key="surface" value="${esc(value.surface||'free')}"></div>`;
  const printControls=document.createElement('div');printControls.className='target-grid print-controls';
  printControls.innerHTML='<label>Logo 载体<select data-key="carrierType"><option value="BODY">产品包材</option><option value="CARTON_FRONT">彩盒正面</option><option value="CARTON_BACK">彩盒背面</option></select></label><label>印刷工艺<select data-key="printFinish"><option value="VERSION">本方案默认工艺</option><option value="INK">普通油墨（所选颜色）</option><option value="BLACK">黑白印刷</option><option value="GOLD FOIL">固定烫金</option><option value="SILVER FOIL">固定烫银</option></select></label>';
  row.append(printControls);
  const carrierInput=row.querySelector('[data-key="carrierType"]'),finishInput=row.querySelector('[data-key="printFinish"]');
  carrierInput.value=value.carrierType||'BODY';finishInput.value=value.printFinish||'VERSION';
  const refreshDropdowns=[];
  const syncPrintOptions=()=>{const carton=isCarton({carrierType:carrierInput.value});if(carton&&!['INK','BLACK'].includes(finishInput.value))finishInput.value=activeScheme==='BLACK'?'BLACK':'INK';for(const option of finishInput.options)option.disabled=carton&&!['INK','BLACK'].includes(option.value);row.querySelector('.target-head strong').textContent=carrierNames[carrierInput.value];refreshDropdowns.forEach(refresh=>refresh());};
  syncPrintOptions();carrierInput.addEventListener('input',syncPrintOptions);
  for(const input of [carrierInput,finishInput])refreshDropdowns.push(createPrintDropdown(input,()=>{selectedTargetId=id;refreshTargetSelection();drawPreview();}));
  const moveButton=document.createElement('button');
  moveButton.type='button';moveButton.className='move-target';moveButton.textContent=canMoveTarget(value)?'锁定位置':'移动位置';
  row.querySelector('.target-actions').prepend(moveButton);
  if(value.masterLocked){
    row.querySelectorAll('[data-key="x"],[data-key="y"],[data-key="rotation"],[data-key="curve"],[data-key="surface"]').forEach(input=>input.disabled=true);
    row.querySelectorAll('.remove-target').forEach(button=>button.disabled=true);
  }
  moveButton.onclick=event=>{event.stopPropagation();const target=collectTargets().find(item=>item.id===row.dataset.targetId);if(!target)return;setTargetMoveEnabled(target,!canMoveTarget(target));row.dataset.moveEnabled=String(target.moveEnabled);moveButton.textContent=canMoveTarget(target)?'锁定位置':'移动位置';refreshTargetSelection();drawPreview();setStatus(target.moveEnabled?'已开启移动：现在可以拖动这个 Logo。':'已锁定位置：需要再次点击“移动位置”才可拖动。','success');};
  row.addEventListener('click',event=>{if(event.target.closest('button'))return;selectedTargetId=row.dataset.targetId;refreshTargetSelection();drawPreview();});
  row.querySelector('.rotate-target').onclick=event=>{event.stopPropagation();const target=collectTargets().find(item=>item.id===row.dataset.targetId);if(!target)return;rotateTargetInPlace(target,-90);updateInputs(target);updateQuad(target);selectedTargetId=target.id;refreshTargetSelection();drawPreview();setStatus('已将 Logo 原地逆时针旋转 90°，中心位置和大小保持不变。','success');};
  row.querySelector('.remove-target').onclick=event=>{event.stopPropagation();if(targets.children.length===1){setStatus('至少保留一个上样目标','error');return;}const wasSelected=row.dataset.targetId===selectedTargetId;row.remove();if(wasSelected)selectedTargetId=targets.firstElementChild.dataset.targetId;refreshTargetSelection();drawPreview();};
  row.querySelectorAll('[data-key]').forEach(input=>input.addEventListener('input',()=>{
    selectedTargetId=row.dataset.targetId;
    if(input.dataset.key==='id'){if(row.dataset.targetId===selectedTargetId)selectedTargetId=input.value.trim();row.dataset.targetId=input.value.trim();}
    const edited=collectTargets().find(target=>target.id===row.dataset.targetId);if(edited&&!edited.quad){keepTargetInsideCanvas(edited);updateInputs(edited);}
    drawPreview();refreshTargetSelection();
  }));
  targets.append(row);refreshTargetSelection();drawPreview();
}

function collectTargets(){return [...targets.children].map(row=>({...Object.fromEntries([...row.querySelectorAll('[data-key]')].map(input=>[input.dataset.key,['id','surface','carrierType','printFinish'].includes(input.dataset.key)?input.value.trim():Number(input.value)])),quad:rowQuad(row)||undefined,color:row.dataset.logoColor||'#000000',autoContrast:row.dataset.autoContrast==='true',preserveOriginalColor:row.dataset.keepOriginal==='true',masterZoneId:row.dataset.masterZoneId||undefined,masterLocked:row.dataset.masterLocked==='true',moveEnabled:row.dataset.moveEnabled==='true'}));}
function refreshTargetSelection(){
  [...targets.children].forEach(row=>row.classList.toggle('selected',row.dataset.targetId===selectedTargetId));
  const selectedRow=[...targets.children].find(row=>row.dataset.targetId===selectedTargetId);
  const color=selectedRow?.dataset.logoColor||'#000000';
  const autoContrast=selectedRow?.dataset.autoContrast==='true';
  originalColorInput.value=color;
  const keepOriginal=selectedRow?.dataset.keepOriginal==='true';
  const selected=collectTargets().find(target=>target.id===selectedTargetId);
  const print=selected?resolveTargetPrint(selected,activeScheme):null;
  document.querySelector('#original-colors-field').hidden=print?.version!=='ORIGINAL';
  originalColorInput.closest('.color-field').hidden=print?.version!=='ORIGINAL';
  document.querySelector('.auto-contrast-field').hidden=print?.version!=='BLACK';
  document.querySelector('#keep-original-colors').checked=keepOriginal;
  originalColorInput.disabled=print?.version!=='ORIGINAL'||keepOriginal;
  autoContrastInput.checked=autoContrast;
  autoContrastInput.disabled=isCarton({carrierType:selectedRow?.querySelector('[data-key="carrierType"]').value})||selectedRow?.querySelector('[data-key="printFinish"]').value==='INK';
  originalColorValue.textContent=print?.version==='ORIGINAL'&&keepOriginal?'Logo 原色':color.toUpperCase();
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
  const points=quad.map(point=>({x:point.x*context.canvas.width,y:point.y*context.canvas.height})),left=Math.floor(Math.min(...points.map(point=>point.x))),top=Math.floor(Math.min(...points.map(point=>point.y))),right=Math.ceil(Math.max(...points.map(point=>point.x))),bottom=Math.ceil(Math.max(...points.map(point=>point.y)));
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
  if(rebuildingTargets)return;
  syncSchemeState();queueSchemeCards();taskDraft?.schedule();
  if(!baseImage){canvas.width=1;canvas.height=1;previewEmpty.hidden=false;return;}
  canvas.width=baseImage.naturalWidth;canvas.height=baseImage.naturalHeight;previewEmpty.hidden=true;
  const context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(baseImage,0,0);
  if(!logoImage)return;
  const basePixels=context.getImageData(0,0,canvas.width,canvas.height).data;
  for(const target of collectTargets()){
    const width=target.widthRatio*canvas.width,height=width*logoImage.naturalHeight/logoImage.naturalWidth;
    const targetColor=target.color||'#000000';
    const rect=targetRect(target);
    const contrastColor=chooseContrastColor({data:basePixels,width:canvas.width,height:canvas.height,left:rect.left,top:rect.top,boxWidth:rect.width,boxHeight:rect.height});
    const print=resolveTargetPrint(target,document.querySelector('#preview-version').value,targetColor,contrastColor);

    const logoLayer=renderTintedLogoLayer({
      createCanvas:(layerWidth,layerHeight)=>{const layer=document.createElement('canvas');layer.width=layerWidth;layer.height=layerHeight;return layer;},
      logoImage,width,height,color:print.color,finish:print.finish
    });
    const curvedLayer=curvePreviewLogo(logoLayer,target.curve);
    if(target.quad)drawQuadPreview(context,curvedLayer,target.quad);else{context.save();context.translate(target.x*canvas.width,target.y*canvas.height);context.rotate(target.rotation*Math.PI/180);context.globalAlpha=1;context.drawImage(curvedLayer,-width/2,-height/2,width,height);context.strokeStyle=target.id===selectedTargetId?'#5369d9':'#ffffff';context.lineWidth=Math.max(2,canvas.width/500);context.setLineDash(target.id===selectedTargetId?[]:[8,6]);context.strokeRect(-width/2,-height/2,width,height);context.restore();}
    if(target.id===selectedTargetId){const handles=handlePoints(target),size=Math.max(10,canvas.width/80);context.setLineDash([]);context.strokeStyle='#5369d9';context.lineWidth=Math.max(2,canvas.width/500);context.beginPath();context.moveTo(handles.center.x,handles.center.y);context.lineTo(handles.rotation.x,handles.rotation.y);context.stroke();context.fillStyle='#5369d9';context.fillRect(handles.scale.x-size/2,handles.scale.y-size/2,size,size);drawRotationArrow(context,handles.rotation,size*1.55,target.rotation);if(target.quad){const points=target.quad.map(point=>({x:point.x*context.canvas.width,y:point.y*context.canvas.height}));context.beginPath();context.moveTo(points[0].x,points[0].y);for(const point of points.slice(1))context.lineTo(point.x,point.y);context.closePath();context.stroke();for(const point of points)context.fillRect(point.x-size/2,point.y-size/2,size,size);}}
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
document.querySelector('#preview-version').onchange=()=>switchScheme(document.querySelector('#preview-version').value);
originalColorInput.oninput=()=>{const selectedRow=[...targets.children].find(row=>row.dataset.targetId===selectedTargetId);if(!selectedRow)return;selectedRow.dataset.logoColor=originalColorInput.value;selectedRow.dataset.keepOriginal='false';originalColorValue.textContent=originalColorInput.value.toUpperCase();drawPreview();};
document.querySelector('#keep-original-colors').onchange=event=>{const row=[...targets.children].find(row=>row.dataset.targetId===selectedTargetId);if(!row)return;row.dataset.keepOriginal=String(event.target.checked);refreshTargetSelection();drawPreview();};
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
    mockupModel.disabled=false;
    renderMultiProductResults();
  }catch(error){
    mockupModel.replaceChildren(new Option('暂无可用模型',''));
    mockupModel.disabled=true;
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
async function regenerateResult(version,card){
  if(multiPackageProducts.length>1){await runMultiPackageGeneration({onlyProductId:loadedMultiProductId,selectedVersions:[version]});return;}
  await runGeneration([version],version);
}
const versionInputs=[...document.querySelectorAll('#generation-versions input')];
const selectedGenerationVersions=()=>versionInputs.filter(input=>input.checked).map(input=>input.value);
let generationBusy=false;
function updateGenerateButton(){
 const count=selectedGenerationVersions().length,button=document.querySelector('#generate');
 button.textContent=generationBusy||multiPackageBusy?'生成中...':multiPackageProducts.length>1?`为 ${multiPackageProducts.length} 个产品生成四种效果`:count?`生成选中的 ${count} 套方案`:'请至少选择一套方案';
 button.disabled=generationBusy||multiPackageBusy||!count;
 const modified=modifiedSchemes(),retry=document.querySelector('#generate-modified');
 retry.hidden=(multiPackageProducts.length>1&&!(currentTaskId&&s7User))||!modified.length;retry.textContent=`重新生成已修改的 ${modified.length} 套方案`;retry.disabled=generationBusy||multiPackageBusy;
}
for(const input of versionInputs)input.addEventListener('change',()=>{updateGenerateButton();taskDraft?.schedule();});
let resultCards=new Map();
function restoreMultiProductGeneration(record){
  multiProductJob=record;multiPackageBusy=record.status==='running';generationBusy=false;
  for(const product of multiPackageProducts){
    const progress=productGeneration(record,product.id),view=multiProductViews.get(product.id)||{};
    view.lastResultPayload={...progress,outputs:progress.outputs.map(output=>({...output,dataUrl:s7Path(output.dataUrl)}))};view.schemePhases=progress.stages;view.savedSignatures={...view.savedSignatures};
    for(const output of progress.outputs)if(output.schemeSignature)view.savedSignatures[output.version]=output.schemeSignature;
    multiProductViews.set(product.id,view);
  }
  const view=multiProductViews.get(loadedMultiProductId);
  if(view&&loadedMultiProductId===selectedMultiProductId){
    lastResultPayload=view.lastResultPayload;schemePhases=view.schemePhases;savedSignatures={...view.savedSignatures};
    const signatures=currentSignatures();for(const output of lastResultPayload.outputs)if(!savedSignatures[output.version]&&schemePhases[output.version]?.stage==='complete')savedSignatures[output.version]=signatures[output.version];
    view.savedSignatures={...savedSignatures};
  }
  const done=Object.values(record.stages).filter(value=>value.stage==='complete').length,total=Object.keys(record.stages).length;
  const failed=Object.values(record.stages).some(value=>value.stage==='failed');
  const text=multiPackageBusy?`正在生成 · ${done}/${total} 张已完成`:done===total?'已生成完成':`已完成 ${done}/${total} 张，未完成图片可重新生成。`;
  if(status.textContent!==text)setStatus(text,multiPackageBusy?'busy':failed?'error':'success');
  notifyTask(text,multiPackageBusy);renderMultiProductResults();queueSchemeCards();updateGenerateButton();
  const next=multiPackageProducts[(multiPackageProducts.findIndex(product=>product.id===selectedMultiProductId)+1)%multiPackageProducts.length];
  if(next&&taskActive)setTimeout(()=>previewImages.preload(record.outputs.filter(output=>output.productId===next.id).map(output=>previewImageUrl(s7Path(output.dataUrl)))),200);
}
function restoreGeneration(record){
  if(record.kind==='multi-product'){restoreMultiProductGeneration(record);return;}
  if(generationId!==record.id){generationId=record.id;beginResultProgress(record);}
  lastResultPayload.remoteTasks=record.remoteTasks||{};
  for(const output of record.outputs)completeResultProgress({...output,dataUrl:s7Path(output.dataUrl)},false);
  for(const [version,value]of Object.entries(record.stages))schemePhases[version]=value;
  const busy=record.status==='running',failed=Object.values(record.stages).filter(value=>value.stage==='failed').length;
  generationBusy=busy;queueSchemeCards();
  resultMeta.textContent=busy?'后台生成中 · 可继续编辑其他方案':failed?`${failed} 套方案可重试`:'生成结果已保存';
  const text=busy?'正在后台生成，完成一张就展示一张。':record.status==='interrupted'?'服务已重启，已完成图片保留，可重试未完成方案。':failed?'已保留成功结果，失败方案可单独重试。':'方案已保存，可继续调整。';
  if(status.textContent!==text)setStatus(text,busy?'busy':failed?'error':'success');
}
function generationRequest(versions,onlyVersion){
 syncSchemeState();submittedSignatures=currentSignatures();
 return {onlyVersion,selectedVersions:versions,preserveResults:true,schemeSignatures:{...submittedSignatures},model:mockupModel.value,baseImage:baseData,logoImage:logoData,targets:collectTargets(),schemes:structuredClone(schemeState.schemes),originalColor:'#000000'};
}
async function submitBackgroundGeneration(onlyVersion,versions=onlyVersion?[onlyVersion]:selectedGenerationVersions()){
  if(!baseData||!logoData)throw Error('请先选择产品和 Logo。');
  const request=generationRequest(versions,onlyVersion);
  taskDraft?.schedule();await taskDraft?.flush();
  const response=await fetch('/api/ai-render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...request,background:true})});
  const record=await response.json();if(!response.ok)throw Error(record.error||'提交生成失败');
  generationWatcher.track(record);
}
function beginResultProgress(payload={}){
  const versions=payload.selectedVersions|| (payload.onlyVersion?[payload.onlyVersion]:selectedGenerationVersions());
  for(const version of versions)schemePhases[version]={stage:'submitting'};
  if(!lastResultPayload)lastResultPayload={outputs:[]};
  lastResultPayload={...lastResultPayload,...payload,outputs:lastResultPayload.outputs||[]};
  queueSchemeCards();taskDraft?.schedule();
}
function updateResultProgress(version,stage,error){schemePhases[version]={stage,error};queueSchemeCards();}
function completeResultProgress(output,markComplete=true){
  if(!lastResultPayload)lastResultPayload={outputs:[]};
  const previous=schemeOutput(output.version);
  const changed=previous?.dataUrl!==output.dataUrl||previous?.schemeSignature!==output.schemeSignature;
  lastResultPayload.outputs=[...(lastResultPayload.outputs||[]).filter(item=>item.version!==output.version),output];
  if(output.schemeSignature)savedSignatures[output.version]=output.schemeSignature;
  if(markComplete)schemePhases[output.version]={stage:'complete'};
  if(changed){showModifiedPreview.delete(output.version);taskDraft?.schedule();}
  queueSchemeCards();
}
async function readProgressStream(response,onEvent){
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let boundary;
    while((boundary=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const event=block.match(/^event: (.+)$/m)?.[1],data=block.match(/^data: (.+)$/m)?.[1];if(event&&data)await onEvent(event,JSON.parse(data));}
    if(done)break;
  }
}
function renderResults(payload){
  payload=normalizeTaskResult(payload,s7Path);lastResultPayload=payload;
  for(const output of payload.outputs){if(output.schemeSignature)savedSignatures[output.version]=output.schemeSignature;schemePhases[output.version]={stage:'complete'};}
  queueSchemeCards();taskDraft?.schedule();
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

async function runGeneration(selectedVersions,onlyVersion){
  if(generationBusy)return;
  if(!baseData||!logoData){setStatus('请先选择产品和 Logo。','error');return;}
  if(!selectedVersions.length)return;
  generationBusy=true;updateGenerateButton();let backgroundAccepted=false;
  try{
    if(currentTaskId&&s7User){await submitBackgroundGeneration(onlyVersion,selectedVersions);backgroundAccepted=true;return;}
    const request=generationRequest(selectedVersions,onlyVersion);
    beginResultProgress({selectedVersions});setStatus(`正在生成 ${selectedVersions.length} 套方案，结果将逐张显示。`,'busy');
    const response=await fetch('/api/ai-render',{method:'POST',headers:{'content-type':'application/json','accept':'text/event-stream'},body:JSON.stringify(request)});
    if(!response.ok||!response.headers.get('content-type')?.includes('text/event-stream')){const payload=await response.json();throw Error(payload.error||'生成失败');}
    let failureCount=0;
    await readProgressStream(response,async(event,data)=>{
      if(event==='started'){lastResultPayload={...lastResultPayload,...data};taskDraft?.schedule();}
      else if(event==='stage')updateResultProgress(data.version,data.stage,data.error);
      else if(event==='output'){const image=data.savedImage;completeResultProgress({version:data.version,dataUrl:image?s7Path(image.url):data.dataUrl,schemeSignature:request.schemeSignatures[data.version]});}
      else if(event==='done')failureCount=data.failures||0;
      else if(event==='fatal')throw Error(data.error||'生成失败');
    });
    resultMeta.textContent=failureCount?`${failureCount} 套方案可重试`:'所选方案已保存';
    setStatus(failureCount?'部分方案失败，已保留成功结果，可单独重试。':'生成完成，可以继续调整或下载。',failureCount?'error':'success');
  }catch(error){for(const version of selectedVersions)if(schemePhases[version]?.stage!=='complete')schemePhases[version]={stage:'failed',error:error.message};setStatus(error.message||'生成失败','error');}
  finally{if(!backgroundAccepted)generationBusy=false;queueSchemeCards();updateGenerateButton();}
}
async function runMultiPackageGeneration(options={}){
  if(multiPackageBusy)return;
  if(!logoData){setStatus('请先选择一个 Logo。','error');return;}
  if(multiPackageProducts.length<2){setStatus('请至少勾选两个已建立母版的包材。','error');return;}
  if(selectedMultiProductId!==loadedMultiProductId){setStatus('产品预览仍在加载，请加载完成后生成。','error');return;}
  const productLayouts=captureMultiProductLayouts().map(layout=>{
    const view=multiProductViews.get(layout.productId),assets=schemeSignature({version:'assets',targets:[{id:[view.baseData,logoData,mockupModel.value].join('|')}]});
    return {productId:layout.productId,targets:layout.targets,schemes:layout.schemeState.schemes,schemeSignatures:Object.fromEntries(layout.schemeState.schemes.map(scheme=>[scheme.version,schemeSignature(scheme,assets)]))};
  });
  if(currentTaskId&&s7User){
    multiPackageBusy=true;updateGenerateButton();
    try{
      await taskDraft.flush();
      const response=await fetch('/api/ai-render-multi',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...options,background:true,productIds:multiPackageProducts.map(product=>product.id),productLayouts,logoImage:logoData,model:mockupModel.value,originalColor:'#000000'})});
      const record=await response.json();if(!response.ok)throw Error(record.error||'多包材生成失败');generationWatcher.track(record);
    }catch(error){multiPackageBusy=false;updateGenerateButton();setStatus(error.message||'多包材生成失败','error');}
    return;
  }
  multiPackageBusy=true;multiProductResults=new Map();renderMultiProductResults();updateGenerateButton();
  const products=multiPackageProducts.map(product=>({...product}));
  multiProductJob={kind:'multi-product',status:'running',outputs:[],stages:Object.fromEntries(products.flatMap(product=>Object.keys(schemeNames).map(version=>[`${product.id}:${version}`,{stage:'queued'}])))};
  restoreMultiProductGeneration(multiProductJob);
  try{
    const response=await fetch('/api/ai-render-multi',{method:'POST',headers:{'content-type':'application/json','accept':'text/event-stream'},body:JSON.stringify({productIds:products.map(product=>product.id),productLayouts,logoImage:logoData,model:mockupModel.value,originalColor:'#000000'})});
    if(!response.ok||!response.headers.get('content-type')?.includes('text/event-stream')){const payload=await response.json();throw Error(payload.error||'多包材生成失败');}
    await readProgressStream(response,async(event,data)=>{
      if(event==='product-error'){multiProductResults.set(data.product.id,{error:data.error});for(const version of Object.keys(schemeNames))multiProductJob.stages[`${data.product.id}:${version}`]={stage:'failed',error:data.error};}
      else if(event==='product-done'){
        multiProductResults.set(data.product.id,data);
        for(const version of Object.keys(schemeNames)){const image=data.images.find(image=>image.label===`${data.product.sku} · ${version}`);if(image){multiProductJob.outputs.push({productId:data.product.id,version,dataUrl:image.url||image.dataUrl});multiProductJob.stages[`${data.product.id}:${version}`]={stage:'complete'};}else multiProductJob.stages[`${data.product.id}:${version}`]={stage:'failed',error:data.failures?.find(failure=>failure.version===version)?.error||'未返回图片'};}
      }
      else if(event==='stage')multiProductJob.stages[`${data.product.id}:${data.version}`]={stage:data.stage,error:data.error};
      restoreMultiProductGeneration(multiProductJob);
      if(event==='stage'&&data.product.id===selectedMultiProductId)setStatus(`${data.product.sku} · ${data.version}：${({submitting:'提交中',generating:'生成中',saving:'保存中',failed:'失败'})[data.stage]||data.stage}`,'busy');
      if(event==='product-error'||event==='product-done')renderMultiProductResults();
    });
    const failed=products.filter(product=>!multiProductResults.get(product.id)?.complete);
    const firstFailure=failed.length?multiProductResults.get(failed[0].id):null;
    setStatus(failed.length?`${failed.length}/${products.length} 个产品未全部生成成功：${firstFailure?.error||firstFailure?.failures?.[0]?.error||'四种效果未全部返回'}。成功图片已保留。`:'所选产品的四种效果已生成。',failed.length?'error':'success');
    if(s7User)await refreshHistory();
  }catch(error){multiProductResults.set(selectedMultiProductId,{error:error.message||'多包材生成失败'});setStatus(error.message||'多包材生成失败','error');}
  finally{multiPackageBusy=false;multiProductJob.status=Object.values(multiProductJob.stages).every(value=>value.stage==='complete')?'complete':'partial';for(const [key,value]of Object.entries(multiProductJob.stages))if(!['complete','failed'].includes(value.stage))multiProductJob.stages[key]={stage:'failed',error:'生成连接中断，请重试'};restoreMultiProductGeneration(multiProductJob);}
}
document.querySelector('#generate').onclick=()=>multiPackageProducts.length>1?runMultiPackageGeneration():runGeneration(selectedGenerationVersions());
document.querySelector('#generate-modified').onclick=()=>multiPackageProducts.length>1?runMultiPackageGeneration({onlyProductId:loadedMultiProductId,selectedVersions:modifiedSchemes()}):runGeneration(modifiedSchemes());
renderMultiProductResults();
mockupModel.addEventListener('change',()=>{queueSchemeCards();taskDraft?.schedule();});
createSchemeCards();updateGenerateButton();

addTarget({id:'product',x:.5,y:.5,widthRatio:.2,rotation:0,curve:0,surface:'free'});
loadAiProviderStatus();
await loadMockupModels();
if(currentTaskId&&s7User){
 taskDraft=createTaskDraft({id:currentTaskId,
  request:async(url,data,method='GET')=>{const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});const value=await response.json();if(!response.ok)throw Error(value.error||'任务保存失败');return value;},
  capture:()=>{const multiProductLayouts=captureMultiProductLayouts();return {schemeState,activeScheme,placementScope,savedSignatures,downloadSelection,selectedVersions:selectedGenerationVersions(),baseData,baseProductId:loadedMultiProductId,logoData,logoSourceData,baseDataUrl:baseData?'':baseImage?.src||'',logoDataUrl:logoData?'':logoImage?.src||'',targets:collectTargets(),selectedTargetId,model:mockupModel.value,logoOutputColor:document.querySelector('input[name="logo-output-color"]:checked').value,baseName:document.querySelector('#base-name').textContent,logoName:document.querySelector('#logo-name').textContent,result:multiPackageProducts.length>1?null:lastResultPayload,multiPackageProducts,multiProductLayouts,selectedMultiProductId};},
  onSaved:record=>{const busy=status.classList.contains('busy');notifyTask(busy?'生成中…':'已保存',busy,record.updatedAt);},onError:error=>{status.textContent=error.message;status.className='status error';notifyTask('保存失败');}});
 try{
  const state=await taskDraft.load();
  downloadSelection=state.downloadSelection||{};
  if(Array.isArray(state.selectedVersions)){for(const input of versionInputs)input.checked=state.selectedVersions.includes(input.value);updateGenerateButton();}
  baseData=state.baseData||'';logoData=state.logoData||'';logoSourceData=state.logoSourceData||'';
  multiPackageProducts=Array.isArray(state.multiPackageProducts)?state.multiPackageProducts.filter(product=>product&&typeof product.id==='string'&&typeof product.sku==='string'&&typeof product.name==='string'):[];renderMultiProductResults();
  if(Array.isArray(state.multiProductLayouts))multiProductViews=new Map(state.multiProductLayouts.filter(layout=>layout?.schemeState?.schemes?.length).map(layout=>[layout.productId,layout]));
  const restoredProduct=multiPackageProducts.find(product=>state.selectedMultiProductId?product.id===state.selectedMultiProductId:state.baseName===`产品库：${product.sku} · ${product.name}`);
  if(restoredProduct)selectedMultiProductId=restoredProduct.id;
  const restoredBase=restoredBaseProduct(state,multiPackageProducts);
  if(restoredBase&&!multiProductViews.has(restoredBase.id)&&state.schemeState?.schemes?.length)multiProductViews.set(restoredBase.id,{targets:state.targets,schemeState:state.schemeState,activeScheme:state.activeScheme||'ORIGINAL',placementScope:state.placementScope||'shared',selectedTargetId:state.selectedTargetId});
  const baseUrl=state.baseData?`data:image/png;base64,${state.baseData}`:state.baseDataUrl,logoUrl=state.logoData?`data:image/png;base64,${state.logoData}`:state.logoDataUrl;
  baseImage=baseUrl?await loadImage(baseUrl):null;logoImage=logoUrl?await loadImage(logoUrl):null;
  if(restoredBase&&baseImage){multiProductViews.set(restoredBase.id,{...multiProductViews.get(restoredBase.id),baseData,baseImage});loadedMultiProductId=restoredBase.id;}
  if(state.schemeState?.schemes?.length){schemeState=state.schemeState;activeScheme=state.activeScheme||'ORIGINAL';placementScope=state.placementScope||'shared';savedSignatures=state.savedSignatures||{};document.querySelector('#preview-version').value=activeScheme;selectedTargetId=state.selectedTargetId;loadSchemeTargets();}
  else if(state.targets?.length){schemeState=null;rebuildingTargets=true;targets.replaceChildren();targetNumber=0;state.targets.forEach(addTarget);rebuildingTargets=false;selectedTargetId=state.selectedTargetId||state.targets[0].id;}
  for(const [id,key]of [['base-name','baseName'],['logo-name','logoName']])if(state[key])document.querySelector('#'+id).textContent=state[key];
  if(logoUrl)setSelectedLogoPreview(logoUrl,state.logoName||'已恢复 Logo');
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
  if(!taskActive)generationWatcher.setActive(false);
  window.addEventListener('pagehide',()=>{generationWatcher.stop();previewImages.clear();});
  document.addEventListener('input',()=>taskDraft.schedule());document.addEventListener('change',()=>taskDraft.schedule());
  window.addEventListener('beforeunload',event=>{if(taskDraft.isDirty()){event.preventDefault();event.returnValue='';}});
 }catch(error){setStatus(error.message,'error');document.querySelector('#generate').disabled=true;}
}else await restoreSavedLogo();
if(multiPackageProducts.length)await showMultiProduct(selectedMultiProductId||multiPackageProducts[0].id);
downloadSelectionReady=true;updateDownloadSelection();queueSchemeCards();
refreshHistory().catch(error=>setStatus(error.message,'error'));
