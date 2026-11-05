import {foilVersions,foilNames} from './foil-finishes.mjs';
import {applyFoilSelection,visibleSchemeVersions,allowedFoilVersions,canSelectMixedVersion} from './foil-selection.mjs';
import {mountFoilConfirmation,mountPrintCombinationDialog} from './foil-confirmation.mjs';
import {mixedVersion,isMixedVersion,mixedVersionName,mixedVersionFinishes} from './generation-versions.mjs';
import {createSchemes,editScheme,restoreSharedGeometry,schemeSignature,ensureCustomScheme as ensureLegacyCustomScheme,ensureFoilSchemes,ensureMixedSchemes,setCustomColors,editSelectedLogos} from './schemes.mjs';
import {clampTargetCenter,pointerToNormalized,rotationFromPointer,widthRatioFromScalePointer} from './demo-geometry.mjs';
import {canMoveTarget,rotateTargetInPlace,setTargetMoveEnabled} from './target-state.mjs';
import {renderTintedLogoLayer} from './preview-logo-layer.mjs';
import {isCarton,resolveTargetPrint} from './target-print.mjs';
import {chooseContrastColor} from './contrast-color.mjs';
import {clearSavedLogo,loadSavedLogo,saveLogo} from './saved-logo.mjs';
import {masterTargetsFromTemplate,rebindMasterZones} from './product-master.mjs';
import {buildProductCategories,categoryFields,bindCategoryFields} from './product-categories.js';
import {triggerTransparentLogoDownload} from './transparent-logo-download.mjs';
import {rotationGestureMode,rotationHandleLocalPosition} from './rotation-handle.mjs';
import {createTaskDraft,normalizeTaskResult,restoredBaseProduct} from './task-draft.mjs';
import {createGenerationWatcher,previewStatus,productGeneration} from './generation-client.mjs';
import {downloadKey,syncDownloadSelection,selectedDownloadOutputs} from './download-selection.mjs';
import {saveDownloadFolder} from './download-folder.mjs';
import {createPreviewImages,previewImageUrl} from './preview-images.mjs';
import {createImagePreview} from './image-preview.mjs';
import {copyScopedPreset,presetGroups,presetParameters} from './product-preset.mjs';
import {bindLogoImageTransfer} from './logo-image-transfer.mjs';

const targets=document.querySelector('#targets');
const status=document.querySelector('#status');
const emptyState=document.querySelector('#empty-state');
const results=document.querySelector('#results');
const selectAllSchemes=document.querySelector('#select-all-schemes');
const resultMeta=document.querySelector('#result-meta');
const downloadSelectedButton=document.querySelector('#download-selected');
const downloadStatus=document.querySelector('#download-status');
const previewImages=createPreviewImages();let previewLoading=false,previewError='';
const multiProductTabs=document.querySelector('#multi-product-tabs');
const multiProductOutput=document.querySelector('#multi-product-output');
const previewSection=document.querySelector('.preview-section');
const canvas=document.querySelector('#placement-canvas');
const previewEmpty=document.querySelector('#preview-empty');
const chooseProductButton=document.querySelector('#choose-product');
const productLibraryPanel=document.querySelector('#product-library-panel');
const closeProductLibraryButton=document.querySelector('#close-product-library');
const productLibrarySearch=document.querySelector('#product-library-search');
const productLibraryList=document.querySelector('#product-library-list');
const productLibraryFilters=document.querySelector('#product-library-filters');
const chooseLogoLibraryButton=document.querySelector('#choose-logo-library');
const logoLibraryPanel=document.querySelector('#logo-library-panel');
const closeLogoLibraryButton=document.querySelector('#close-logo-library');
const logoLibrarySearch=document.querySelector('#logo-library-search');
const logoLibraryList=document.querySelector('#logo-library-list');
const useSavedLogoButton=document.querySelector('#use-saved-logo');
const clearSavedLogoButton=document.querySelector('#clear-saved-logo');
const selectedLogoPreview=document.querySelector('#selected-logo-preview');
const selectedLogoThumbnail=document.querySelector('#selected-logo-thumbnail');
const aiRefineButton=document.querySelector('#ai-refine-logo');
const aiRefineStatus=document.querySelector('#ai-refine-status');
const aiRefineDownload=document.querySelector('#ai-refine-download');
let aiLogoBusy=false;
const originalColorInput=document.querySelector('#original-color');
const originalColorValue=document.querySelector('#original-color-value');
const autoContrastInput=document.querySelector('#auto-contrast');
const mockupModel=document.querySelector('#mockup-model');
const imagePreview=document.querySelector('#image-preview');
const imagePreviewTitle=document.querySelector('#image-preview-title');
const imagePreviewImage=document.querySelector('#image-preview-image');
const imagePreviewViewport=document.querySelector('#image-preview-viewport');
const imagePreviewStatus=document.querySelector('#image-preview-status');
const zoomReset=document.querySelector('#zoom-reset');
let schemeState=null,activeScheme='ORIGINAL',placementScope='shared',rebuildingTargets=false,schemePreviewFrame=null;
let submittedSignatures={},savedSignatures={},schemePhases={},showModifiedPreview=new Set();
let cachedAssetSource=[],cachedAssetKey='';
let thumbnailImages=[],thumbnailImageRevision=0;
const schemeThumbnails=new Map();
const ensureCustomScheme=state=>ensureFoilSchemes(ensureLegacyCustomScheme(state));
const confirmFoilReport=mountFoilConfirmation(document.querySelector('#foil-confirmation'));
const choosePrintCombination=mountPrintCombinationDialog(document.querySelector('#print-combination-dialog'));
const readFoilRegions=()=>[...document.querySelectorAll('[data-foil-region]:checked')].map(input=>input.dataset.foilRegion);
function scopedFoilState(state){return {...state,...applyFoilSelection(state.sharedTargets,state.schemes,readFoilRegions()),sharedTargets:state.sharedTargets};}
const schemeNames={ORIGINAL:'原色方案',BLACK:'黑白方案',CUSTOM:'自定义配色',...foilNames,'GOLD FOIL':'烫金搭配','SILVER FOIL':'烫银搭配'};
const carrierNames={BODY:'产品包材',CARTON_FRONT:'彩盒正面',CARTON_BACK:'彩盒背面'};
let previewScale=1;
let targetNumber=0;
let selectedTargetId='product';
const selectedTargetIds=new Set();
let targetSelectionContext='';
let dragTarget=null;
let dragMode=null;
let dragBatchGroup=null;
let rotateTimer=null;
let rotateStartedAt=0;
let rotatePointerId=null;
const ROTATE_LONG_PRESS_MS=350;
let baseData='',logoData='',logoSourceData='';
let baseImage=null,logoImage=null;
let previewBaseImage=null,previewBasePixels=null;
let contrastLogoImage=null,contrastLogoPixels=null;
let productLibraryProducts=[];
let readProductCategory=()=>({category:'',subcategory:''});
let multiPackageProducts=[],multiPackageBusy=false;
let multiProductResults=new Map(),selectedMultiProductId=null;
let multiProductViews=new Map(),multiProductLoads=new Map(),loadedMultiProductId=null,multiProductLoadRevision=0,multiProductJob=null;
let copyingProductPreset=false;
let logoLibraryItems=[];
let taskLogos=[],selectedTaskLogoId=null,loadedTaskLogoId=null,multiLogoViews=new Map(),multiLogoJob=null;
let multiLogoEnabled=false,logoSelectionBusy=false,logoLoadRevision=0,logoDecoding=false,logoImportBusy=false;
const currentTaskId=new URLSearchParams(location.search).get('task');
let taskDraft=null,lastResultPayload=null,generationWatcher=null,generationId=null,dismissedGenerationId=null,taskActive=true;
let downloadSelection={},downloadingSelected=false,downloadSelectionReady=!currentTaskId;
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==window.parent||event.data?.type!=='s7-task-visibility'||event.data.taskId!==currentTaskId)return;taskActive=event.data.active;generationWatcher?.setActive(taskActive);});
function notifyTask(text,busy=false,updatedAt,title){if(currentTaskId&&window.parent!==window)window.parent.postMessage({type:'s7-task-status',taskId:currentTaskId,text,busy,updatedAt,title},location.origin);}

const esc=value=>String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const S7_BASE=location.pathname==='/s7'||location.pathname.startsWith('/s7/')?'/s7':'';
const s7Path=value=>S7_BASE&&typeof value==='string'&&value.startsWith('/')?`${S7_BASE}${value}`:value;
const logoLibraryPath=value=>S7_BASE?new URL(value,location.origin).href:s7Path(value);
const nativeFetch=window.fetch.bind(window);
const fullImagePreview=createImagePreview({image:imagePreviewImage,request:nativeFetch,onStatus:(stage,message)=>{imagePreviewStatus.hidden=stage==='ready';imagePreviewStatus.disabled=stage!=='error';imagePreviewStatus.textContent=stage==='error'?`${message}（${imagePreviewImage.hidden?'暂无可用预览':'当前显示预览图'}）`:message;}});
let s7User=null;
let logoStorage=localStorage;
function requireLogin(){fullImagePreview.close();previewImages.clear();document.body.replaceChildren();const link=document.createElement('a');link.textContent='登录已失效，请返回主工作空间登录';link.href=S7_BASE?'/':`http://${location.hostname}:3210/`;link.target='_top';document.body.append(link);}
const fetch=async(input,init)=>{
 if(init?.method==='POST'&&['/api/ai-render','/api/ai-render-multi','/api/ai-render-logos','/api/render'].includes(input)){
  init={...init,body:JSON.stringify({...JSON.parse(init.body),processLogo:true,preserveLogoDetails:taskLogos.find(logo=>logo.id===loadedTaskLogoId)?.aiRefined===true})};
 }
 if(currentTaskId&&s7User&&init?.method==='POST'&&['/api/ai-render','/api/ai-render-multi','/api/ai-process-logo','/api/process-logo','/api/render'].includes(input)){
  const logo=taskLogos.find(logo=>logo.id===loadedTaskLogoId);
  init={...init,body:JSON.stringify({...JSON.parse(init.body),taskId:currentTaskId,...(logo?.logoAssetUrl?{logoAssetUrl:logo.logoAssetUrl,logoImage:undefined}:{})})};
 }
 if(init?.method==='POST'&&['/api/ai-render','/api/ai-render-multi','/api/ai-render-logos','/api/render'].includes(input)){
  const request={...JSON.parse(init.body),foilRegions:readFoilRegions(),foilMode:input==='/api/ai-render-multi'?'multi-product':input==='/api/ai-render-logos'?'multi-logo':'single'};
  if(!request.productIds&&!request.productId)request.productId=loadedMultiProductId;
  const preflight=await fetch('/api/foil-preflight',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)}),report=await preflight.json();
  if(!preflight.ok)throw Error(report.error||'母版工艺校验失败');
  if(report.blocked.length||report.warnings.length){
   const accepted=await confirmFoilReport(report);
   if(!accepted)throw Object.assign(Error('已返回修改，请调整工艺或烫印区域后再生成'),{cancelled:true});
   request.foilAcknowledgement=report.confirmationToken;
  }
  init={...init,body:JSON.stringify(request)};
 }
 const response=await nativeFetch(typeof input==='string'?s7Path(input):input,init);
 if(s7User){
  const owner=response.headers.get('X-Workspace-User');
  if(response.status===401||(owner&&owner!==s7User.id)){requireLogin();throw Error('登录已变更，请重新进入个人空间');}
  if(!owner){
   const session=await nativeFetch(s7Path('/api/session'),{signal:init?.signal}),value=session.ok?await session.json():null;
   if(session.status===401||(session.ok&&value?.user?.id!==s7User.id)){requireLogin();throw Error('登录已变更，请重新进入个人空间');}
   if(!session.ok)throw Error('认证服务暂时无法读取，请稍后重试');
  }
  if(init?.method==='POST'&&response.ok)refreshHistory().catch(()=>{});
 }
 return response;
};
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
 const response=await fetch('/api/my-space/history'+(currentTaskId?'?taskId='+encodeURIComponent(currentTaskId):''));if(!response.ok){section.textContent='个人生成历史暂时无法读取';return;}
 const history=(await response.json()).filter(record=>!['AI上样','多包材印刷效果','多 Logo 印刷效果'].includes(record.kind));section.hidden=!history.length;section.innerHTML=`<h2>我的 Logo 素材</h2>${history.map(record=>`<details><summary>${esc(new Date(record.createdAt).toLocaleString())} · ${esc(record.kind)} · ${esc(record.model||'')}</summary><div class="result-grid">${record.images.map(image=>`<article><p>${esc(image.label)}</p><a href="${esc(s7Path(image.url))}" download><img src="${esc(s7Path(image.url))}" alt="${esc(image.label)}" loading="lazy" width="180"><p>下载图片</p></a>${image.label==='透明Logo'?`<button class="button secondary" data-restore-logo="${esc(image.url)}">使用此 Logo</button>`:''}</article>`).join('')}</div></details>`).join('')}`;
 for(const button of section.querySelectorAll('[data-restore-logo]'))button.onclick=async()=>{try{const r=await fetch(button.dataset.restoreLogo);if(!r.ok)throw Error('Logo读取失败');const loaded=await fileData(await r.blob());const saved={data:loaded.data,name:'个人空间透明Logo.png'};saveLogo(logoStorage,saved);await useSavedLogo(saved);setStatus('已从个人空间恢复透明Logo','success');}catch(error){setStatus(error.message,'error');}};
}
function setStatus(message,type=''){status.textContent=message;status.className=`status ${type}`;taskDraft?.schedule();notifyTask(type==='busy'?'生成中…':type==='error'?'操作失败':type==='success'?'已完成':'编辑中',type==='busy');}
function fileData(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({dataUrl:String(reader.result),data:String(reader.result).split(',')[1]});reader.onerror=reject;reader.readAsDataURL(file);});}
function loadImage(dataUrl){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('图片无法读取'));image.src=dataUrl;});}
function setSelectedLogoPreview(dataUrl,name){if(!dataUrl){selectedLogoPreview.hidden=true;return;}const logo=taskLogos.find(logo=>logo.id===loadedTaskLogoId);if(logo){if(logo.logoImage!==logoData)delete logo.logoAssetUrl;logo.logoImage=logoData;logo.sourceData=logoSourceData;}multiProductResults=new Map();selectedLogoThumbnail.src=dataUrl;selectedLogoThumbnail.alt=`${name||'已选 Logo'}预览`;document.querySelector('#logo-name').textContent=name||'已选择 Logo';selectedLogoPreview.hidden=false;renderMultiProductResults();}
function renderProductLibrary(){
  const query=productLibrarySearch.value.trim().toUpperCase();
  const filter=readProductCategory();
  if(!query&&!filter.category){delete productLibraryList.dataset.products;productLibraryList.innerHTML='<p class="hint">请选择大类、细分类目，或输入 SKU／产品名称搜索。</p>';return;}
  const visible=productLibraryProducts.filter(product=>(!filter.category||product.category===filter.category)&&(!filter.subcategory||product.subcategory===filter.subcategory)).filter(product=>`${product.sku} ${product.name}`.toUpperCase().includes(query));
  const key=JSON.stringify(visible);
  if(productLibraryList.dataset.products!==key){
    productLibraryList.dataset.products=key;
    productLibraryList.innerHTML=visible.length?visible.map(product=>`<article class="product-library-item"><img src="${esc(s7Path(product.imageUrl+'?thumbnail=1'))}" alt="${esc(product.name)}标准图" loading="lazy" decoding="async"><div><strong>${esc(product.sku)}</strong><span>${esc(product.name)}${product.category?` · ${esc([product.category,product.subcategory].filter(Boolean).join(' / '))}`:''}${product.hasMaster?'':' · 缺少母版'}</span></div><label class="batch-product-check"><input type="checkbox" data-batch-product-id="${esc(product.id)}" aria-label="选择 ${esc(product.sku)} 的效果图" title="选择 ${esc(product.sku)} 的效果图"></label></article>`).join(''):'<p class="hint">没有匹配的产品，请调整分类或 SKU／名称关键词。</p>';
    productLibraryList.querySelectorAll('[data-batch-product-id]').forEach(input=>input.addEventListener('change',()=>{
      if(generationBusy||multiPackageBusy||logoSelectionBusy){renderProductLibrary();return;}
      const product=productLibraryProducts.find(item=>item.id===input.dataset.batchProductId);
      if(input.checked&&taskLogos.length>1&&multiPackageProducts.length&&!multiPackageProducts.some(item=>item.id===product?.id)){setStatus('多个 Logo 只能搭配一个产品','error');renderProductLibrary();return;}
      if(input.checked&&product&&!multiPackageProducts.some(item=>item.id===product.id))multiPackageProducts.push({id:product.id,sku:product.sku,name:product.name,imageUrl:product.imageUrl});
      if(!input.checked){multiPackageProducts=multiPackageProducts.filter(item=>item.id!==input.dataset.batchProductId);multiProductResults.delete(input.dataset.batchProductId);if(selectedMultiProductId===input.dataset.batchProductId)selectedMultiProductId=multiPackageProducts[0]?.id||null;}
      renderMultiProductResults();updateGenerateButton();taskDraft?.schedule();
      if(selectedMultiProductId&&selectedMultiProductId!==loadedMultiProductId)showMultiProduct(selectedMultiProductId);
      else if(input.checked&&product)return loadMultiProductView(product).then(()=>{updateGenerateButton();queueSchemeCards();taskDraft?.schedule();}).catch(error=>setStatus(error.message,'error'));
    }));
  }
  productLibraryList.querySelectorAll('[data-batch-product-id]').forEach(input=>{
    const product=productLibraryProducts.find(item=>item.id===input.dataset.batchProductId),selected=multiPackageProducts.some(item=>item.id===input.dataset.batchProductId);
    input.checked=selected;
    input.disabled=!product.hasMaster||(taskLogos.length>1&&multiPackageProducts.length>0&&!selected)||multiPackageBusy||generationBusy||logoSelectionBusy;
  });
}

async function removeTaskProduct(id){
  if(logoSelectionBusy||generationBusy||multiPackageBusy||!multiPackageProducts.some(product=>product.id===id))return;
  saveMultiProductView();++multiProductLoadRevision;
  multiPackageProducts=multiPackageProducts.filter(product=>product.id!==id);multiProductResults.delete(id);
  if(selectedMultiProductId===id)selectedMultiProductId=multiPackageProducts[0]?.id||null;
  if(!multiPackageProducts.length){
    if(generationId)dismissedGenerationId=generationId;
    selectedMultiProductId=null;loadedMultiProductId=null;baseData='';baseImage=null;lastResultPayload=null;savedSignatures={};schemePhases={};
    document.querySelector('#base-name').textContent='尚未选择产品';drawPreview();
  }else if(selectedMultiProductId!==loadedMultiProductId)await showMultiProduct(selectedMultiProductId);
  renderProductLibrary();renderMultiProductResults();queueSchemeCards();updateGenerateButton();taskDraft?.schedule();
}
function saveMultiProductView(){
  if(!loadedMultiProductId)return;
  syncSchemeState();
  multiProductViews.set(loadedMultiProductId,{selectedVersions:selectedGenerationVersions(),foilTemplate:multiProductViews.get(loadedMultiProductId)?.foilTemplate,baseData,baseImage,baseAssetUrl:multiProductViews.get(loadedMultiProductId)?.baseAssetUrl||'',masterTargets:multiProductViews.get(loadedMultiProductId)?.masterTargets,targets:structuredClone(collectTargets()),schemeState:structuredClone(schemeState),activeScheme,placementScope,selectedTargetId,lastResultPayload,savedSignatures:{...savedSignatures},schemePhases:structuredClone(schemePhases)});
}
function captureMultiProductLayouts(){
  saveMultiProductView();
  return multiPackageProducts.flatMap(product=>{
    const view=multiProductViews.get(product.id);if(!view?.schemeState)return [];
    return [{productId:product.id,selectedVersions:view.selectedVersions||['ORIGINAL','BLACK'],baseAssetUrl:view.baseAssetUrl||'',masterTargets:structuredClone(view.masterTargets),targets:view.targets,schemeState:structuredClone(view.schemeState),activeScheme:view.activeScheme,placementScope:view.placementScope,selectedTargetId:view.selectedTargetId,savedSignatures:{...view.savedSignatures}}];
  });
}
async function showMultiProduct(id){
  const product=multiPackageProducts.find(item=>item.id===id);if(!product)return;
  selectedMultiProductId=id;renderMultiProductResults();
  const revision=++multiProductLoadRevision;
  queueSchemeCards();
  if(loadedMultiProductId===id&&multiProductViews.get(id)?.foilTemplate){if(taskLogos.length&&selectedTaskLogoId&&selectedTaskLogoId!==loadedTaskLogoId)await showTaskLogo(selectedTaskLogoId);return;}
  saveMultiProductView();
  setStatus(`正在加载 ${product.sku} 的方案预览…`,'busy');
  try{
    const view=await loadMultiProductView(product);
    if(revision!==multiProductLoadRevision||selectedMultiProductId!==id)return;
    if(taskLogos.length>1&&loadedMultiProductId!==id){multiLogoViews.clear();if(multiLogoJob?.product.id!==id)multiLogoJob=null;}
    baseData=view.baseData;baseImage=view.baseImage;schemeState=structuredClone(view.schemeState);activeScheme=view.activeScheme;placementScope=view.placementScope;selectedTargetId=view.selectedTargetId;
    lastResultPayload=view.lastResultPayload||null;savedSignatures={...view.savedSignatures};schemePhases=structuredClone(view.schemePhases||{});submittedSignatures={};showModifiedPreview=new Set();
    if(taskLogos.length>1)for(const logo of taskLogos)if(!multiLogoViews.get(logo.id)?.schemeState)multiLogoViews.set(logo.id,{targets:structuredClone(view.targets||schemeState.schemes[0].targets),schemeState:structuredClone(schemeState),activeScheme,placementScope,selectedTargetId,lastResultPayload:null,savedSignatures:{},schemePhases:{},...multiLogoViews.get(logo.id)});
    loadedMultiProductId=id;restoreProductSelection(view);document.querySelector('#preview-version').value=activeScheme;
    document.querySelector('#base-name').textContent=`产品库：${product.sku} · ${product.name}`;
    loadSchemeTargets();renderMultiProductResults();updateGenerateButton();
    setStatus(`已显示 ${product.sku} 的方案预览，可按需启用烫印。`,'success');
    if(multiProductJob)restoreMultiProductGeneration(multiProductJob);
    if(taskLogos.length&&selectedTaskLogoId&&selectedTaskLogoId!==loadedTaskLogoId)await showTaskLogo(selectedTaskLogoId);
  }catch(error){if(revision===multiProductLoadRevision)setStatus(error.message,'error');}
}

async function loadMultiProductView(product){
    const id=product.id;let view=multiProductViews.get(id);
    if(!view?.baseImage){
      let loading=multiProductLoads.get(id);
      if(!loading){
        loading=(async()=>{
          try{
            const snapshot=view?.baseAssetUrl;
            const modern=!!(currentTaskId&&s7User),imageUrl=product.imageUrl||`/api/product-library/image/${encodeURIComponent(id)}`;
            const [imageResponse,templateResponse]=await Promise.all([fetch(snapshot?`${snapshot}?preview=1`:imageUrl+(modern?'?selection=1':''),!snapshot&&modern?{headers:{'X-S7-Task-Id':currentTaskId}}:undefined),fetch(`/api/product-library/template/${encodeURIComponent(id)}`)]);
            if(!imageResponse.ok||(templateResponse&&!templateResponse.ok))throw Error('产品原图或母版读取失败');
            if(modern&&!snapshot&&!imageResponse.headers?.get('X-S7-Task-Asset'))throw Error('产品原图未保存，请重试');
            const [loaded,payload]=await Promise.all([fileData(await imageResponse.blob()),templateResponse?.json()]);
            const image=await loadImage(loaded.dataUrl),masterTargets=snapshot?view.targets||view.schemeState.schemes[0].targets:masterTargetsFromTemplate(payload.template);
            if(!masterTargets.length)throw Error('该产品母版没有 Logo 区域');
            const loadedView={selectedVersions:['ORIGINAL','BLACK'],masterTargets:snapshot?view.masterTargets:structuredClone(masterTargets),schemeState:createSchemes(masterTargets),targets:masterTargets,activeScheme:'ORIGINAL',placementScope:'shared',selectedTargetId:masterTargets[0].id,lastResultPayload:null,savedSignatures:{},schemePhases:{},...view,foilTemplate:payload.template,baseData:loaded.data,baseImage:image,baseAssetUrl:snapshot||imageResponse.headers?.get('X-S7-Task-Asset')||''};
            multiProductViews.set(id,loadedView);return loadedView;
          }finally{multiProductLoads.delete(id);}
        })();
        multiProductLoads.set(id,loading);
      }
      view=await loading;
    }
    if(!view.foilTemplate){const response=await fetch(`/api/product-library/template/${encodeURIComponent(id)}`);if(!response.ok)throw Error('产品母版读取失败');view.foilTemplate=(await response.json()).template;}
    const previousState=view.schemeState;view.schemeState=rebindMasterZones(ensureCustomScheme(view.schemeState),view.foilTemplate);
    if(view.schemeState!==previousState){view.targets=view.schemeState.schemes.find(scheme=>scheme.version===view.activeScheme)?.targets||view.schemeState.sharedTargets;view.masterTargets=masterTargetsFromTemplate(view.foilTemplate);}
    return view;
}

async function applyPresetToOtherProducts(selection,referenceTargetId){
  if(copyingProductPreset||generationBusy||multiPackageBusy||logoSelectionBusy||selectedMultiProductId!==loadedMultiProductId||multiPackageProducts.length<2||!selection.length)return;
  saveMultiProductView();
  const sourceId=loadedMultiProductId,preset=structuredClone(schemeState),logoAspect=logoImage?logoImage.naturalHeight/logoImage.naturalWidth:null,products=multiPackageProducts.filter(product=>product.id!==sourceId||selection.some(key=>key.startsWith('product/')));
  copyingProductPreset=true;updateGenerateButton();queueSchemeCards();
  try{
    await Promise.all(products.filter(product=>product.id!==sourceId).map(product=>loadMultiProductView(product)));
    saveMultiProductView();
    const updates=[];
    for(const product of products){
      if(!multiPackageProducts.some(item=>item.id===product.id))continue;
      const view=multiProductViews.get(product.id),dimensions=logoAspect?{width:view.baseImage.naturalWidth,height:view.baseImage.naturalHeight,logoAspect}:undefined;
      const scope=product.id===sourceId?selection.filter(key=>key.startsWith('product/')):selection;
      const copied=copyScopedPreset(preset,view.schemeState,scope,dimensions,referenceTargetId);
      if(JSON.stringify(copied)===JSON.stringify(view.schemeState))continue;
      const current=copied.schemes.find(scheme=>scheme.version===view.activeScheme);
      updates.push([product.id,{...view,schemeState:copied,targets:structuredClone(current.targets),placementScope:current.independentGeometry?'current':view.placementScope}]);
    }
    for(const [id,view]of updates)multiProductViews.set(id,view);
    const count=updates.length;
    if(updates.some(([id])=>id===loadedMultiProductId)){
      const view=multiProductViews.get(loadedMultiProductId);schemeState=structuredClone(view.schemeState);placementScope=view.placementScope;loadSchemeTargets();
    }
    taskDraft?.schedule();renderMultiProductResults();
    setStatus(count?`已按所选范围更新 ${count} 个 SKU，${products.length-count} 个无变化。${selection.some(key=>key.startsWith('product/'))?'产品设置已应用到全部产品 Logo。':''}已有成图需重新生成以应用修改。`:'对应设置已一致，或没有对应区域，本次未修改。',count?'success':'info');
  }catch(error){setStatus(`未能应用设置：${error.message}`,'error');}
  finally{copyingProductPreset=false;updateGenerateButton();queueSchemeCards();}
}

function openProductPresetScope(){
  if(copyingProductPreset||generationBusy||generationSubmitting||multiPackageBusy||logoSelectionBusy||selectedMultiProductId!==loadedMultiProductId)return;
  const source=multiPackageProducts.find(product=>product.id===loadedMultiProductId),products=multiPackageProducts.filter(product=>product.id!==loadedMultiProductId);
  if(!source||!products.length)return;
  const targets=collectTargets(),selected=targets.find(target=>target.id===selectedTargetId)||targets[0];
  openPresetScope({source,products,targets,version:activeScheme,carrier:isCarton(selected||{})?'carton':'product',referenceTargetId:selected?.id,onApply:applyPresetToOtherProducts});
}

function openPresetScope({source,products,targets,version,carrier,referenceTargetId,onApply}){
  const defaultVersion=carrier==='carton'&&['GOLD FOIL','SILVER FOIL'].includes(version)?'ORIGINAL':version;
  const dialog=document.querySelector('#preset-scope-dialog'),tree=dialog.querySelector('#preset-scope-tree'),summary=dialog.querySelector('#preset-scope-summary'),confirm=dialog.querySelector('#confirm-preset-scope');
  dialog.querySelector('#preset-scope-source').textContent=`参考 SKU：${source.sku||source.name||source.id}。产品同步包含当前 SKU 的全部产品 Logo。`;
  const productTargets=targets.filter(target=>!isCarton(target)),reference=dialog.querySelector('#preset-scope-reference');
  reference.replaceChildren();
  productTargets.forEach((target,index)=>{const option=document.createElement('option');option.value=target.id;option.textContent=`产品 Logo ${index+1}${target.name?` · ${target.name}`:''}`;reference.append(option);});
  reference.disabled=!productTargets.length;
  reference.value=productTargets.some(target=>target.id===referenceTargetId)?referenceTargetId:productTargets[0]?.id||'';
  tree.replaceChildren();
  const leaves=[],parents=[];
  function checkbox(container,label){
    const row=document.createElement('label'),input=document.createElement('input');
    input.type='checkbox';row.append(input,document.createTextNode(label));container.append(row);return input;
  }
  const root=checkbox(tree,'全部可同步设置');
  for(const group of presetGroups){
    const section=document.createElement('section');section.className='preset-scope-group';tree.append(section);
    const parent=checkbox(section,group.label),groupLeaves=[];
    const available=targets.some(target=>isCarton(target)===(group.id==='carton'));
    parent.disabled=!available;
    if(!available){const note=document.createElement('small');note.textContent='当前 SKU 无对应区域';section.append(note);}
    for(const [key,label] of group.versions){
      const row=document.createElement('div');row.className='preset-scope-version';section.append(row);
      const versionParent=checkbox(row,label),parameters=document.createElement('div');parameters.className='preset-scope-parameters';row.append(parameters);
      versionParent.disabled=!available;
      const versionLeaves=[];
      for(const parameter of key==='CUSTOM'?['size','rotation','color']:['size','rotation']){
        const input=checkbox(parameters,presetParameters[parameter]);input.disabled=!available;
        input.value=`${group.id}/${key}/${parameter}`;input.setAttribute('aria-label',`${group.label} · ${label} · ${presetParameters[parameter]}`);
        input.checked=available&&key===defaultVersion&&group.id===carrier;
        const leaf={input,group:group.label,version:label,parameter:presetParameters[parameter]};
        leaves.push(leaf);groupLeaves.push(input);versionLeaves.push(input);
      }
      if(key!=='CUSTOM'){const fixed=document.createElement('small');fixed.textContent='颜色固定';parameters.append(fixed);}
      parents.push({input:versionParent,children:versionLeaves});
    }
    parents.push({input:parent,children:groupLeaves});
  }
  parents.push({input:root,children:leaves.map(leaf=>leaf.input)});
  function refresh(){
    for(const {input,children} of parents){
      const enabled=children.filter(child=>!child.disabled),count=enabled.filter(child=>child.checked).length;
      input.checked=enabled.length>0&&count===enabled.length;input.indeterminate=count>0&&count<enabled.length;input.disabled=!enabled.length;
    }
    const selected=leaves.filter(leaf=>leaf.input.checked&&!leaf.input.disabled);
    summary.replaceChildren();
    const entries=new Map();
    for(const leaf of selected){const key=`${leaf.group} · ${leaf.version}${leaf.input.value.startsWith('carton/ORIGINAL/')?'（含烫金、烫银方案中的彩盒）':''}`;entries.set(key,[...(entries.get(key)||[]),leaf.parameter]);}
    for(const [label,parameters] of entries){const item=document.createElement('li');item.textContent=`${label}：${parameters.join('、')}`;summary.append(item);}
    if(!selected.length){const item=document.createElement('li');item.textContent='请在左侧勾选需要应用的设置';summary.append(item);}
    const includeSource=selected.some(leaf=>leaf.input.value.startsWith('product/')),recipients=includeSource?[source,...products]:products;
    dialog.querySelector('#preset-scope-products').textContent=recipients.map(product=>`${product.sku||product.name||product.id}${product.id===source.id?'（当前 SKU，仅产品）':''}`).join('、');
    confirm.disabled=!selected.length;
    confirm.textContent=`将 ${selected.length} 项设置应用到 ${recipients.length} 个 SKU`;
  }
  for(const {input,children} of parents)input.onchange=()=>{for(const child of children)if(!child.disabled)child.checked=input.checked;refresh();};
  for(const {input} of leaves)input.onchange=refresh;
  dialog.querySelector('#close-preset-scope').onclick=()=>dialog.close();
  dialog.querySelector('#cancel-preset-scope').onclick=()=>dialog.close();
  confirm.onclick=()=>{const selection=leaves.filter(leaf=>leaf.input.checked&&!leaf.input.disabled).map(leaf=>leaf.input.value),referenceId=reference.value;dialog.close();onApply(selection,referenceId);};
  refresh();dialog.showModal();
}

function saveMultiLogoView(){
  if(!loadedTaskLogoId)return;
  const logo=taskLogos.find(logo=>logo.id===loadedTaskLogoId);
  if(logo){logo.logoImage=logoData;logo.sourceData=logoSourceData;}
  syncSchemeState();
  multiLogoViews.set(loadedTaskLogoId,{targets:structuredClone(collectTargets()),schemeState:structuredClone(schemeState),activeScheme,placementScope,selectedTargetId,lastResultPayload,savedSignatures:{...savedSignatures},schemePhases:structuredClone(schemePhases)});
}
function captureMultiLogoLayouts(){
  saveMultiLogoView();
  const template=multiProductViews.get(loadedMultiProductId)?.foilTemplate;
  return taskLogos.flatMap(logo=>{
    const view=multiLogoViews.get(logo.id);if(!view?.schemeState)return [];
    const state=rebindMasterZones(view.schemeState,template),targets=state.schemes.find(scheme=>scheme.version===view.activeScheme)?.targets||state.sharedTargets;
    return [{logoId:logo.id,targets:structuredClone(targets),schemeState:structuredClone(state),activeScheme:view.activeScheme,placementScope:view.placementScope,selectedTargetId:view.selectedTargetId,savedSignatures:{...view.savedSignatures}}];
  });
}
async function showTaskLogo(id){
  const logo=taskLogos.find(logo=>logo.id===id);if(!logo)return;
  if(selectedMultiProductId&&selectedMultiProductId!==loadedMultiProductId){
    ++logoLoadRevision;selectedTaskLogoId=id;logoDecoding=false;logoSelectionBusy=logoImportBusy;
    renderMultiProductResults();queueSchemeCards();updateGenerateButton();
    setStatus('Logo 已选中，产品图就绪后会自动应用。');return;
  }
  if(loadedTaskLogoId===id){++logoLoadRevision;selectedTaskLogoId=id;logoDecoding=false;logoSelectionBusy=logoImportBusy;renderMultiProductResults();queueSchemeCards();updateGenerateButton();taskDraft?.schedule();return;}
  saveMultiLogoView();selectedTaskLogoId=id;
  const revision=++logoLoadRevision;logoDecoding=true;logoSelectionBusy=true;updateGenerateButton();renderMultiProductResults();queueSchemeCards();
  try{
    const image=await loadImage('data:image/png;base64,'+logo.logoImage);
    if(revision!==logoLoadRevision)return;
    const view={schemeState:structuredClone(schemeState),activeScheme,placementScope,selectedTargetId,lastResultPayload:null,savedSignatures:{},schemePhases:{},...multiLogoViews.get(id)};
    logoData=logo.logoImage;logoSourceData=logo.sourceData||'';logoImage=image;loadedTaskLogoId=id;
    schemeState=structuredClone(view.schemeState);activeScheme=view.activeScheme;placementScope=view.placementScope;selectedTargetId=view.selectedTargetId;
    lastResultPayload=view.lastResultPayload||null;savedSignatures={...view.savedSignatures};schemePhases=structuredClone(view.schemePhases||{});submittedSignatures={};showModifiedPreview=new Set();
    document.querySelector('#preview-version').value=activeScheme;
    setSelectedLogoPreview(image.src||'data:image/png;base64,'+logoData,logo.name);
    if(schemeState)loadSchemeTargets();
    if(multiLogoJob)restoreMultiLogoGeneration(multiLogoJob);
    taskDraft?.schedule();renderMultiProductResults();queueSchemeCards();
  }catch(error){setStatus(error.message,'error');}
  finally{if(revision===logoLoadRevision){logoDecoding=false;logoSelectionBusy=logoImportBusy;updateGenerateButton();renderMultiProductResults();renderProductLibrary();renderLogoLibrary();}}
}
async function addTaskLogo(logo){
  if(taskLogos.some(item=>item.id===logo.id))return;
  if(taskLogos.length>=20)throw Error('每个任务最多选择 20 个 Logo');
  if(taskLogos.length&&(!multiLogoEnabled||!currentTaskId||!s7User))throw Error('当前任务暂不可使用多 Logo 生成');
  if(taskLogos.length&&multiPackageProducts.length>1)throw Error('多个 Logo 只能搭配一个产品，请先保留一个产品');
  taskLogos.push(logo);await showTaskLogo(logo.id);renderLogoLibrary();taskDraft?.schedule();
}
async function removeTaskLogo(id){
  if(logoSelectionBusy||generationBusy||multiPackageBusy)return;
  saveMultiLogoView();taskLogos=taskLogos.filter(logo=>logo.id!==id);multiLogoViews.delete(id);
  if(selectedTaskLogoId===id&&loadedTaskLogoId!==id){++logoLoadRevision;logoDecoding=false;selectedTaskLogoId=taskLogos.some(logo=>logo.id===loadedTaskLogoId)?loadedTaskLogoId:taskLogos[0]?.id||null;}
  if(loadedTaskLogoId===id){loadedTaskLogoId=null;selectedTaskLogoId=null;lastResultPayload=null;savedSignatures={};schemePhases={};
    if(taskLogos.length)await showTaskLogo(taskLogos[0].id);
    else{logoData='';logoSourceData='';logoImage=null;selectedLogoPreview.hidden=true;drawPreview();}
  }
  if(taskLogos.length===1&&multiLogoJob)restoreMultiLogoGeneration(multiLogoJob);
  renderLogoLibrary();renderMultiProductResults();queueSchemeCards();updateGenerateButton();taskDraft?.schedule();
}
function renderMultiLogoTabs(){
  multiProductTabs.hidden=false;multiProductOutput.hidden=true;results.hidden=false;previewSection.hidden=false;
  const key=JSON.stringify(taskLogos.map(logo=>[logo.id,logo.name,logo.logoImage]));
  if(multiProductTabs.dataset.logos!==key){
    multiProductTabs.innerHTML=taskLogos.map(logo=>`<div class="task-logo-tab"><button type="button" class="multi-product-tab" data-task-logo-id="${esc(logo.id)}"><img src="data:image/png;base64,${esc(logo.logoImage)}" alt=""><span><strong>${esc(logo.name)}</strong><small></small></span></button><button type="button" class="remove-task-asset" data-remove-logo-id="${esc(logo.id)}" aria-label="移除 ${esc(logo.name)}" title="移除 ${esc(logo.name)}">×</button></div>`).join('');
    multiProductTabs.dataset.logos=key;delete multiProductTabs.dataset.products;
    multiProductTabs.querySelectorAll('[data-task-logo-id]').forEach(button=>button.onclick=()=>showTaskLogo(button.dataset.taskLogoId));
    multiProductTabs.querySelectorAll('[data-remove-logo-id]').forEach(button=>button.onclick=()=>removeTaskLogo(button.dataset.removeLogoId));
  }
  for(const button of multiProductTabs.querySelectorAll('[data-task-logo-id]')){
    const id=button.dataset.taskLogoId,outputs=multiLogoJob?.product.id===loadedMultiProductId?multiLogoJob.outputs.filter(output=>output.logoId===id):[],busy=multiLogoJob?.status==='running';
    button.disabled=!!selectedMultiProductId&&selectedMultiProductId!==loadedMultiProductId;button.classList.toggle('active',id===selectedTaskLogoId);button.setAttribute('aria-pressed',String(id===selectedTaskLogoId));
    const stages=Object.entries(multiLogoJob?.stages||{}).filter(([key])=>key.startsWith(id+':')).map(([,value])=>value),total=stages.length||4,completed=stages.filter(value=>value.stage==='complete').length;
    button.querySelector('small').textContent=completed===total?'已生成完成':outputs.length||busy?`${completed}/${total} 已完成${busy?' · 生成中':''}`:'方案预览';
  }
  multiProductTabs.querySelectorAll('[data-remove-logo-id]').forEach(button=>button.disabled=generationBusy||multiPackageBusy||logoSelectionBusy);
  const product=multiPackageProducts.find(product=>product.id===selectedMultiProductId),logo=taskLogos.find(logo=>logo.id===selectedTaskLogoId);
  resultMeta.textContent=`${product?.sku||'请选择产品'} · ${logo?.name||''}`;
}
function restoreMultiLogoGeneration(record){
  multiLogoJob=record;multiPackageBusy=record.status==='running';generationBusy=false;
  if(record.product.id===loadedMultiProductId){
    for(const logo of taskLogos){
      const view=multiLogoViews.get(logo.id)||{},prefix=logo.id+':';
      view.lastResultPayload={outputs:record.outputs.filter(output=>output.logoId===logo.id).map(output=>({...output,productId:record.product.id,dataUrl:s7Path(output.dataUrl)}))};
      view.schemePhases=Object.fromEntries(Object.entries(record.stages).filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key.slice(prefix.length),value]));view.savedSignatures={...view.savedSignatures};
      for(const output of view.lastResultPayload.outputs)if(output.schemeSignature)view.savedSignatures[output.version]=output.schemeSignature;
      multiLogoViews.set(logo.id,view);
    }
    const view=multiLogoViews.get(loadedTaskLogoId);
    if(view){lastResultPayload=view.lastResultPayload;schemePhases=view.schemePhases;savedSignatures={...view.savedSignatures};const signatures=currentSignatures();for(const output of lastResultPayload.outputs)if(!savedSignatures[output.version])savedSignatures[output.version]=signatures[output.version];}
  }
  const done=Object.values(record.stages).filter(value=>value.stage==='complete').length,total=Object.keys(record.stages).length;
  const text=multiPackageBusy?(record.providerActivationPending?'任务已排队，等待启用生成':`后台生成中 · ${done}/${total} 张已保存`):done===total?`已生成完成 · ${done}/${total} 张`:`已保存 ${done}/${total} 张，失败方案可单独重试。`;
  if(status.textContent!==text)setStatus(text,multiPackageBusy?'busy':done===total?'success':'error');
  notifyTask(text,multiPackageBusy);renderMultiProductResults();queueSchemeCards();updateGenerateButton();
}
async function runMultiLogoGeneration(options={}){
  if(copyingProductPreset||generationSubmitting||generationBusy||multiPackageBusy||logoSelectionBusy)return;
  options={selectedVersions:selectedGenerationVersions(),...options};if(!options.selectedVersions.length)return;
  if(!multiLogoEnabled){setStatus('多 Logo 生成功能已关闭','error');return;}
  if(taskLogos.length<2||multiPackageProducts.length!==1||selectedMultiProductId!==loadedMultiProductId){setStatus('请选择多个 Logo 和一个已加载的产品','error');return;}
  multiPackageBusy=true;
  try{
    await showGenerationSubmission(options.selectedVersions);
    const layouts=captureMultiLogoLayouts();
    const logoLayouts=taskLogos.map(logo=>{
      const view=layouts.find(view=>view.logoId===logo.id)||{targets:collectTargets(),schemeState:structuredClone(schemeState)};
      const assets=schemeSignature({version:'assets',targets:[{id:[multiProductViews.get(loadedMultiProductId)?.baseAssetUrl||baseData,logo.logoImage,mockupModel.value].join('|')}]});
      return {logoId:logo.id,targets:view.targets,schemes:view.schemeState.schemes,schemeSignatures:Object.fromEntries(view.schemeState.schemes.map(scheme=>[scheme.version,schemeSignature(scheme,assets)]))};
    });
    await taskDraft.flush();
    const response=await fetch('/api/ai-render-logos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...options,taskId:currentTaskId,productId:loadedMultiProductId,baseAssetUrl:multiProductViews.get(loadedMultiProductId)?.baseAssetUrl||undefined,model:mockupModel.value,logos:taskLogos.map(({id,name,logoImage,logoAssetUrl,aiRefined})=>({id,name,preserveLogoDetails:aiRefined===true,...(logoAssetUrl?{logoAssetUrl}:{logoImage})})),logoLayouts})});
    const record=await response.json();if(!response.ok)throw Error(record.error||'多 Logo 生成失败');generationSubmitting=false;generationWatcher.track(record);
  }catch(error){multiPackageBusy=false;failGenerationSubmission(options.selectedVersions,error);renderMultiProductResults();}
  finally{generationSubmitting=false;updateGenerateButton();}
}
function renderMultiProductResults(){
  if(taskLogos.length>1){if(!multiPackageProducts.some(product=>product.id===selectedMultiProductId))selectedMultiProductId=multiPackageProducts[0]?.id||null;renderMultiLogoTabs();return;}
  delete multiProductTabs.dataset.logos;
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
      return `<div class="task-product-tab"><button type="button" class="multi-product-tab" data-multi-product-id="${esc(product.id)}"><img src="${esc(imageUrl+'?thumbnail=1')}" alt=""><span><strong>${esc(product.sku)}</strong><small></small></span></button><button type="button" class="remove-task-asset" data-remove-product-id="${esc(product.id)}" aria-label="移除产品 ${esc(product.sku)}" title="移除产品 ${esc(product.sku)}">×</button></div>`;
    }).join('');
    multiProductTabs.dataset.products=tabKey;
    multiProductTabs.querySelectorAll('[data-multi-product-id]').forEach(button=>button.addEventListener('click',()=>showMultiProduct(button.dataset.multiProductId)));
    multiProductTabs.querySelectorAll('[data-remove-product-id]').forEach(button=>button.onclick=()=>removeTaskProduct(button.dataset.removeProductId));
  }
  multiProductTabs.querySelectorAll('[data-remove-product-id]').forEach(button=>button.disabled=generationBusy||multiPackageBusy||logoSelectionBusy);
  for(const product of previewProducts){
    const result=multiProductResults.get(product.id);
    const progress=multiProductJob?productGeneration(multiProductJob,product.id):null;
    const completed=progress?Object.values(progress.stages).filter(value=>value.stage==='complete').length:0;
    const total=progress?Object.keys(progress.stages).length:4;
    const state=progress&&total?completed===total?'已生成完成':`${completed}/${total} 已完成${multiPackageBusy?' · 生成中':''}`:result?.error?'生成失败':result?.images?(result.complete?'已生成完成':'部分完成'):multiPackageBusy?'处理中':'方案预览';
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
  delete productLibraryList.dataset.products;productLibraryList.textContent='正在读取产品库…';
  try{const response=await fetch('/api/product-library');const payload=await response.json();if(!response.ok)throw Error(payload.error||'产品库读取失败');productLibraryProducts=payload;const filter=readProductCategory();productLibraryFilters.innerHTML=categoryFields('s7-product');readProductCategory=bindCategoryFields(productLibraryFilters,'s7-product',buildProductCategories(payload),{value:filter,onChange:renderProductLibrary});renderProductLibrary();}
  catch(error){productLibraryList.innerHTML=`<p class="hint status error">${esc(error.message)}</p>`;}
}
productLibrarySearch.addEventListener('input',renderProductLibrary);

function renderLogoLibrary(){
  const query=logoLibrarySearch.value.trim().toUpperCase();
  const visible=logoLibraryItems.filter(item=>String(item.name||'').toUpperCase().includes(query));
  const key=JSON.stringify(visible.map(item=>[item.id,item.name,item.createdAt,item.imageUrl]));
  if(logoLibraryList.dataset.items!==key){
    logoLibraryList.dataset.items=key;
    logoLibraryList.innerHTML=visible.length?visible.map(item=>`<article class="product-library-item"><img src="${esc(logoLibraryPath(item.imageUrl+'?thumbnail=1'))}" alt="${esc(item.name)}" loading="lazy" decoding="async"><div><strong>${esc(item.name)}</strong><span>${esc(new Date(item.createdAt).toLocaleString())}</span></div><label class="batch-product-check"><input type="checkbox" data-logo-id="${esc(item.id)}" aria-label="选择 ${esc(item.name)}"></label></article>`).join(''):'<p class="hint">Logo 库中没有匹配的图片。</p>';
    logoLibraryList.querySelectorAll('[data-logo-id]').forEach(input=>input.addEventListener('change',async()=>{
      if(generationBusy||multiPackageBusy||logoSelectionBusy){renderLogoLibrary();return;}
      const item=logoLibraryItems.find(value=>value.id===input.dataset.logoId);if(!item)return;
      if(!input.checked){await removeTaskLogo(item.id);return;}
      logoImportBusy=true;logoSelectionBusy=true;logoLibraryList.dataset.loadingLogo=item.id;renderLogoLibrary();updateGenerateButton();
      setStatus('正在加载所选 Logo…','busy');
      try{
        const useSnapshot=!!currentTaskId&&!!s7User;
        const response=await fetch(useSnapshot?item.imageUrl+'?selection=1':logoLibraryPath(item.imageUrl),useSnapshot?{headers:{'X-S7-Task-Id':currentTaskId}}:undefined);if(!response.ok)throw Error('Logo 库图片读取失败');
        const logoAssetUrl=useSnapshot?response.headers.get('X-S7-Task-Asset'):null;if(useSnapshot&&!logoAssetUrl)throw Error('Logo 原图快照未保存，请重试');
        const loaded=await fileData(await response.blob());
        await addTaskLogo({id:item.id,name:item.name.slice(0,120),logoImage:loaded.data,...(item.aiRefined?{aiRefined:true}:{}),...(useSnapshot?{logoAssetUrl}:{})});
        if(!selectedMultiProductId||selectedMultiProductId===loadedMultiProductId)setStatus(`已选择 ${taskLogos.length} 个 Logo，可关闭选择框后调整预览。`,'success');
      }catch(error){setStatus(error.message,'error');}
      finally{delete logoLibraryList.dataset.loadingLogo;logoImportBusy=false;logoSelectionBusy=logoDecoding;renderLogoLibrary();renderProductLibrary();updateGenerateButton();}
    }));
  }
  logoLibraryList.querySelectorAll('[data-logo-id]').forEach(input=>{
    const selected=taskLogos.some(logo=>logo.id===input.dataset.logoId);
    input.checked=selected||logoLibraryList.dataset.loadingLogo===input.dataset.logoId;
    input.disabled=generationBusy||multiPackageBusy||logoSelectionBusy||(!selected&&taskLogos.length>0&&(!multiLogoEnabled||multiPackageProducts.length>1));
  });
}

async function openLogoLibrary(){
  logoLibraryPanel.hidden=!logoLibraryPanel.hidden;if(logoLibraryPanel.hidden)return;
  productLibraryPanel.hidden=true;if(logoLibraryList.dataset.items===undefined)logoLibraryList.textContent='正在读取 Logo 库…';
  try{const response=await fetch(logoLibraryPath('/api/logo-library'));const payload=await response.json();if(!response.ok)throw Error(payload.error||'Logo 库读取失败');logoLibraryItems=payload;renderLogoLibrary();}
  catch(error){delete logoLibraryList.dataset.items;logoLibraryList.innerHTML=`<p class="hint status error">${esc(error.message)}</p>`;}
}

function rowQuad(row){try{const quad=JSON.parse(row.dataset.quad||'');return Array.isArray(quad)&&quad.length===4?quad:null;}catch{return null;}}
function setRowQuad(row,quad){row.dataset.quad=JSON.stringify(quad);}

async function useSavedLogo(saved=loadSavedLogo(logoStorage)){
  if(!saved)throw Error('没有可使用的已保存 Logo');
  if(!taskLogos.some(logo=>logo.id===loadedTaskLogoId)){const id=crypto.randomUUID();taskLogos.push({id,name:saved.name,logoImage:saved.data,sourceData:saved.sourceData||'',aiRefined:saved.aiRefined===true});loadedTaskLogoId=id;selectedTaskLogoId=id;}
  logoData=saved.data;logoSourceData=saved.sourceData||'';const dataUrl=`data:image/png;base64,${saved.data}`;logoImage=await loadImage(dataUrl);const logo=taskLogos.find(logo=>logo.id===loadedTaskLogoId);if(logo)logo.aiRefined=saved.aiRefined===true;useSavedLogoButton.hidden=false;clearSavedLogoButton.hidden=false;setSelectedLogoPreview(dataUrl,`已使用：${saved.name}`);drawPreview();updateGenerateButton();
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
  schemeState=scopedFoilState(rebindMasterZones(ensureCustomScheme(schemeState),multiProductViews.get(loadedMultiProductId)?.foilTemplate));
  const context=[loadedMultiProductId,loadedTaskLogoId,activeScheme].join('/');
  if(context!==targetSelectionContext){selectedTargetIds.clear();targetSelectionContext=context;}
  rebuildingTargets=true;targets.replaceChildren();targetNumber=0;
  const current=schemeState.schemes.find(scheme=>scheme.version===activeScheme);
  if(selectedTargetId!==null&&!current.targets.some(target=>target.id===selectedTargetId))selectedTargetId=current.targets[0]?.id;
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
  const base=multiProductViews.get(loadedMultiProductId)?.baseAssetUrl||baseData;
  if(base!==cachedAssetSource[0]||logoData!==cachedAssetSource[1]||mockupModel.value!==cachedAssetSource[2]){cachedAssetSource=[base,logoData,mockupModel.value];cachedAssetKey=schemeSignature({version:'assets',targets:[{id:cachedAssetSource.join('|')}]});}
  return cachedAssetKey;
}
function currentSignatures(){return Object.fromEntries((schemeState?.schemes||[]).map(scheme=>[scheme.version,schemeSignature(scheme,assetKey())]));}
function schemeOutput(version){
 if(taskLogos.length>1){if(selectedTaskLogoId!==loadedTaskLogoId)return multiLogoJob?.product.id===loadedMultiProductId?multiLogoJob.outputs.find(output=>output.logoId===selectedTaskLogoId&&output.version===version):undefined;return lastResultPayload?.outputs?.find(output=>output.version===version);}
 if(selectedMultiProductId!==loadedMultiProductId){
  if(!multiProductJob)return multiProductViews.get(selectedMultiProductId)?.lastResultPayload?.outputs?.find(output=>output.version===version);
  const output=multiProductJob.outputs.find(output=>output.productId===selectedMultiProductId&&output.version===version);return output?{...output,dataUrl:s7Path(output.dataUrl)}:undefined;
 }
 return lastResultPayload?.outputs?.find(output=>output.version===version);
}
function modifiedSchemes(){const signatures=currentSignatures();return Object.keys(schemeNames).filter(version=>!schemeState?.removedSchemes?.some(item=>item.version===version)&&schemeOutput(version)&&savedSignatures[version]!==signatures[version]);}
function queueSchemeCards(){
  if(schemePreviewFrame!==null)return;
  schemePreviewFrame=requestAnimationFrame(()=>{schemePreviewFrame=null;renderSchemeCards();});
}
function logoContrastPixels(){
  if(contrastLogoImage===logoImage)return contrastLogoPixels;
  const scale=Math.min(1,256/Math.max(logoImage.naturalWidth,logoImage.naturalHeight)),layer=document.createElement('canvas');
  layer.width=Math.max(1,Math.round(logoImage.naturalWidth*scale));layer.height=Math.max(1,Math.round(logoImage.naturalHeight*scale));
  const context=layer.getContext('2d');context.drawImage(logoImage,0,0,layer.width,layer.height);
  contrastLogoPixels={data:context.getImageData(0,0,layer.width,layer.height).data,width:layer.width,height:layer.height};contrastLogoImage=logoImage;
  return contrastLogoPixels;
}
function drawSchemeThumbnail(thumbnail,scheme){
  if(!baseImage){thumbnail.width=320;thumbnail.height=160;thumbnail.getContext('2d').clearRect(0,0,320,160);return;}
  const key=JSON.stringify([loadedMultiProductId,scheme.version]),signature=schemeSignature(scheme),cached=schemeThumbnails.get(key);
  if(cached&&cached.signature===signature&&cached.baseImage===baseImage&&cached.logoImage===logoImage){
    thumbnail.width=cached.canvas.width;thumbnail.height=cached.canvas.height;thumbnail.getContext('2d').drawImage(cached.canvas,0,0);
    schemeThumbnails.delete(key);schemeThumbnails.set(key,cached);return;
  }
  const scale=Math.min(1,768/Math.max(baseImage.naturalWidth,baseImage.naturalHeight));
  thumbnail.width=Math.max(1,Math.round(baseImage.naturalWidth*scale));thumbnail.height=Math.max(1,Math.round(baseImage.naturalHeight*scale));
  const context=thumbnail.getContext('2d');context.drawImage(baseImage,0,0,thumbnail.width,thumbnail.height);if(!logoImage)return;
  const pixels=context.getImageData(0,0,thumbnail.width,thumbnail.height).data;
  for(const target of scheme.targets){
    const width=target.widthRatio*thumbnail.width,height=width*logoImage.naturalHeight/logoImage.naturalWidth;
    const contrast=target.autoContrast&&resolveTargetPrint(target,scheme.version).version==='BLACK'?chooseContrastColor({data:pixels,width:thumbnail.width,height:thumbnail.height,left:target.x*thumbnail.width-width/2,top:target.y*thumbnail.height-height/2,boxWidth:width,boxHeight:height,logo:logoContrastPixels(),rotation:target.rotation,quad:target.quad,curve:target.curve}):null;
    const print=resolveTargetPrint(target,scheme.version,target.color||'#000000',contrast);
    const layer=curvePreviewLogo(renderTintedLogoLayer({createCanvas:(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;},logoImage,width,height,color:print.color,finish:print.finish}),target.curve);
    if(target.quad)drawQuadPreview(context,layer,target.quad);else{context.save();context.translate(target.x*thumbnail.width,target.y*thumbnail.height);context.rotate((target.rotation||0)*Math.PI/180);context.drawImage(layer,-width/2,-height/2,width,height);context.restore();}
  }
  const copy=document.createElement('canvas');copy.width=thumbnail.width;copy.height=thumbnail.height;copy.getContext('2d').drawImage(thumbnail,0,0);
  schemeThumbnails.delete(key);schemeThumbnails.set(key,{signature,baseImage,logoImage,canvas:copy});
  if(schemeThumbnails.size>8)schemeThumbnails.delete(schemeThumbnails.keys().next().value);
}
function taskDownloadOutputs(){
 const included=output=>!(output.productId===loadedMultiProductId||!output.productId?schemeState:multiProductViews.get(output.productId)?.schemeState)?.removedSchemes?.some(item=>item.version===output.version);
 if(taskLogos.length>1&&multiLogoJob?.product.id===loadedMultiProductId)return multiLogoJob.outputs.filter(output=>taskLogos.some(logo=>logo.id===output.logoId)&&included(output)).map(output=>({...output,productId:multiLogoJob.product.id,dataUrl:s7Path(output.dataUrl)}));
 if(multiPackageProducts.length>1&&multiProductJob)return multiProductJob.outputs.filter(output=>multiPackageProducts.some(product=>product.id===output.productId)&&included(output)).map(output=>({...output,dataUrl:s7Path(output.dataUrl)}));
 return (lastResultPayload?.outputs||[]).filter(included).map(output=>({...output,productId:output.productId||loadedMultiProductId||''}));
}
function updateDownloadSelection(){
 const outputs=taskDownloadOutputs(),next=syncDownloadSelection(downloadSelection,outputs);
 if(downloadSelectionReady&&next!==downloadSelection){downloadSelection=next;taskDraft?.schedule();}
 const count=selectedDownloadOutputs(downloadSelection,outputs).length;
 downloadSelectedButton.disabled=downloadingSelected||!count;
 downloadSelectedButton.textContent=downloadingSelected?'正在保存…':'下载到文件夹';downloadSelectedButton.title=`已选择 ${count} 张图片（包含此客户任务所有产品和 Logo），选择保存位置后创建客户文件夹`;
}
downloadSelectedButton.onclick=async()=>{
 const announce=(text,kind)=>{downloadStatus.textContent=text;downloadStatus.hidden=false;downloadStatus.dataset.error=String(kind==='error');};
 const selected=selectedDownloadOutputs(downloadSelection,taskDownloadOutputs());if(!selected.length||downloadingSelected)return;
 if(typeof window.showDirectoryPicker!=='function'){announce('当前浏览器不支持保存文件夹，请用最新版 Chrome 或 Edge 打开后下载。','error');return;}
 downloadingSelected=true;updateDownloadSelection();
 try{
  announce('请选择保存位置，将自动创建客户文件夹。');
  const parent=await window.showDirectoryPicker({mode:'readwrite',id:'customer-task-images',startIn:'downloads'});
  await taskDraft?.flush();
  let files,folderName='任务图片';
  if(currentTaskId&&s7User){
   const response=await fetch(`/api/my-space/tasks/${currentTaskId}/download`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({manifest:true,urls:selected.map(output=>output.dataUrl.replace(/^\/s7(?=\/api\/)/,''))})});
   if(!response.ok)throw Error((await response.json()).error||'图片下载失败');
   const plan=await response.json();folderName=plan.folderName;files=plan.files;
  }else{
   files=[];
   for(const [index,output]of selected.entries()){
    const sku=multiPackageProducts.find(product=>product.id===output.productId)?.sku||'效果图';
    files.push({name:`${index+1}-${sku.replace(/[<>:"/\\|?*]/g,'_')}-${output.version}.png`,url:output.dataUrl});
   }
  }
  const saved=await saveDownloadFolder(parent,folderName,files,{request:currentTaskId&&s7User?fetch:nativeFetch,onProgress:(done,total)=>announce(`正在保存图片 ${done}/${total}…`)});
  announce(`已保存 ${saved.count} 张图片到文件夹“${saved.name}”。`);
 }catch(error){if(error.name==='AbortError')announce('已取消选择保存位置。');else announce(error.message||'图片保存失败','error');}
 finally{downloadingSelected=false;updateDownloadSelection();}
};
function updateSchemeSelection(selection,version,output,switching){
 const download=output&&{...output,productId:output.productId||loadedMultiProductId||''};
 selection.disabled=switching||(!output&&(generationBusy||multiPackageBusy||logoSelectionBusy||!!versionInputs.find(input=>input.value===version)?.disabled));
 selection.checked=download?!!downloadSelection[downloadKey(download)]?.selected:versionInputs.find(input=>input.value===version).checked;
 const name=schemeNames[version],label=output?`选择下载${name}`:`选择生成${name}`;
 selection.title=label;selection.setAttribute('aria-label',label);
}
function changeSchemeSelection(version,checked){
 const output=schemeOutput(version);
 if(output){const key=downloadKey({...output,productId:output.productId||loadedMultiProductId||''});downloadSelection={...downloadSelection,[key]:{dataUrl:output.dataUrl,selected:checked}};updateDownloadSelection();}
 else{const input=versionInputs.find(input=>input.value===version);if(checked&&input.disabled)return;input.checked=checked;updateGenerateButton();}
 updateAllSchemeSelection();
 queueSchemeCards();
 taskDraft?.schedule();
}
function updateAllSchemeSelection(){
 const outputs=taskDownloadOutputs(),count=taskLogos.length>1?taskLogos.length:Math.max(1,multiPackageProducts.length);
 const visible=new Set(displayedSchemeVersions());
 selectAllSchemes.checked=visible.size>0&&versionInputs.filter(input=>visible.has(input.value)).every(input=>{
  const generated=outputs.filter(output=>output.version===input.value&&output.dataUrl);
  return (generated.length>=count||input.checked)&&generated.every(output=>downloadSelection[downloadKey(output)]?.selected);
 });
 selectAllSchemes.indeterminate=false;
 selectAllSchemes.disabled=copyingProductPreset||generationSubmitting||generationBusy||multiPackageBusy||logoSelectionBusy||!!selectedMultiProductId&&selectedMultiProductId!==loadedMultiProductId;
}
function schemeRemovalBlocked(){
 return !schemeState||copyingProductPreset||generationSubmitting||generationBusy||multiPackageBusy||logoSelectionBusy||!!selectedMultiProductId&&selectedMultiProductId!==loadedMultiProductId||taskLogos.length>1&&selectedTaskLogoId!==loadedTaskLogoId;
}
function updateSchemeRemoval(){
 const removed=schemeState?.removedSchemes||[],notice=document.querySelector('#scheme-removal-notice');
 notice.hidden=!removed.length;
 document.querySelector('#scheme-removal-message').textContent=removed.length?`已删除 ${removed.length} 个搭配`:'';
 document.querySelector('#undo-scheme-removal').disabled=schemeRemovalBlocked();
}
function saveSchemeRemoval(){
 for(const view of multiLogoViews.values())if(view.schemeState)view.schemeState.removedSchemes=structuredClone(schemeState.removedSchemes);
 saveMultiProductView();updateSchemeRemoval();updateGenerateButton();updateDownloadSelection();queueSchemeCards();taskDraft?.schedule();
}
function removeSchemeCard(version){
 if(schemeRemovalBlocked()||!displayedSchemeVersions().includes(version))return;
 syncSchemeState();
 const input=versionInputs.find(input=>input.value===version);
 schemeState.removedSchemes=[...(schemeState.removedSchemes||[]),{version,selected:input.checked}];input.checked=false;
 const next=displayedSchemeVersions()[0];if(activeScheme===version&&next)switchScheme(next);
 saveSchemeRemoval();
}
function reviveSchemeCard(version){
 schemeState.removedSchemes=(schemeState.removedSchemes||[]).filter(item=>item.version!==version);
}
function restoreRemovedScheme(){
 if(schemeRemovalBlocked())return;
 const removed=schemeState.removedSchemes?.at(-1);if(!removed)return;
 reviveSchemeCard(removed.version);versionInputs.find(input=>input.value===removed.version).checked=removed.selected;
 switchScheme(removed.version);saveSchemeRemoval();
}
function displayedSchemeVersions(){return visibleSchemeVersions(schemeState?schemeState.schemes.map(scheme=>scheme.version):versionInputs.map(input=>input.value),versionInputs.filter(input=>input.checked).map(input=>input.value),taskDownloadOutputs(),schemePhases).filter(version=>!schemeState?.removedSchemes?.some(item=>item.version===version));}
function changeAllSchemeSelection(checked){
 if(selectAllSchemes.disabled)return;
 const visible=new Set(displayedSchemeVersions());
 versionInputs.forEach(input=>{if(visible.has(input.value)&&!input.disabled)input.checked=checked;});
 const next={...downloadSelection};
 for(const output of taskDownloadOutputs())if(output.dataUrl)next[downloadKey(output)]={dataUrl:output.dataUrl,selected:checked};
 downloadSelection=next;updateDownloadSelection();updateGenerateButton();queueSchemeCards();taskDraft?.schedule();
}
function bindSchemeSwipe(card,{canRemove,onRemove}){
 let gesture=null,suppressClick=false;
 function reset(){
  const pointerId=gesture?.pointerId;gesture=null;
  card.classList.remove('swiping','swipe-ready');card.style.removeProperty('--swipe-x');
  if(pointerId!==undefined&&card.hasPointerCapture(pointerId))card.releasePointerCapture(pointerId);
 }
 card.addEventListener('pointerdown',event=>{
  suppressClick=false;
  if(event.button!==0||!canRemove()||event.target.closest('button,input,a,.generation-overlay'))return;
  gesture={pointerId:event.pointerId,x:event.clientX,y:event.clientY,dragging:false};
 });
 card.addEventListener('pointermove',event=>{
  if(!gesture||event.pointerId!==gesture.pointerId)return;
  const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
  if(!gesture.dragging){
   if(Math.abs(dy)>8&&Math.abs(dy)>=Math.abs(dx)){reset();return;}
   if(Math.abs(dx)<8)return;
   gesture.dragging=true;suppressClick=true;card.setPointerCapture(event.pointerId);
  }
  event.preventDefault();
  card.classList.add('swiping');card.classList.toggle('swipe-ready',dx<=-80);
  card.style.setProperty('--swipe-x',`${Math.max(-130,Math.min(0,dx))}px`);
 });
 card.addEventListener('pointerup',event=>{
  if(!gesture||event.pointerId!==gesture.pointerId)return;
  const remove=gesture.dragging&&event.clientX-gesture.x<=-80&&canRemove();
  reset();if(remove)onRemove();
 });
 card.addEventListener('pointercancel',reset);card.addEventListener('lostpointercapture',reset);
 card.addEventListener('dragstart',event=>event.preventDefault());
 card.addEventListener('click',event=>{if(suppressClick){suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}},true);
}
function renderSchemeCards(){
  if(!schemeState)return;
  registerMixedVersions(schemeState.schemes.map(scheme=>scheme.version));
  if(schemeState.schemes.some(scheme=>!resultCards.has(scheme.version)))createSchemeCards();
  const visible=new Set(displayedSchemeVersions());
  for(const [version,card]of resultCards)card.hidden=!visible.has(version);
  updateSchemeRemoval();
  if(visible.size&&!visible.has(activeScheme)){switchScheme([...visible][0]);return;}
  updateDownloadSelection();
  if(thumbnailImages[0]!==baseImage||thumbnailImages[1]!==logoImage){thumbnailImages=[baseImage,logoImage];thumbnailImageRevision++;}
  const signatures=currentSignatures(),switching=(!!selectedMultiProductId&&selectedMultiProductId!==loadedMultiProductId)||(taskLogos.length>1&&selectedTaskLogoId!==loadedTaskLogoId);
  const switchingProgress=switching&&multiProductJob?productGeneration(multiProductJob,selectedMultiProductId):null,entries=[];
  for(const scheme of schemeState.schemes){
    const card=resultCards.get(scheme.version);if(!card)continue;
    card.hidden=!visible.has(scheme.version);if(card.hidden)continue;
    const output=schemeOutput(scheme.version),phase=switchingProgress?switchingProgress.stages[scheme.version]:schemePhases[scheme.version],dirty=!switching&&!!output&&savedSignatures[scheme.version]!==signatures[scheme.version];
    card.classList.toggle('active',scheme.version===activeScheme);card.classList.toggle('modified',dirty);
    card.dataset.stage=phase?.stage|| (output?'complete':'preview');
    const useImage=!!output&&!(dirty&&showModifiedPreview.has(scheme.version));
    const image=card.querySelector('.result-image'),thumbnail=card.querySelector('canvas');thumbnail.hidden=useImage||switching;
    entries.push({image,url:useImage?previewImageUrl(output.dataUrl):null});
    const thumbnailKey=`${signatures[scheme.version]}:${thumbnailImageRevision}`;
    if(!switching&&!useImage&&thumbnail.dataset.signature!==thumbnailKey){drawSchemeThumbnail(thumbnail,scheme);thumbnail.dataset.signature=thumbnailKey;}
    card.querySelector('.edit-scheme').disabled=switching;
    const progress=previewStatus(output,phase,dirty),overlay=card.querySelector('.generation-overlay');overlay.hidden=!progress.busy&&!(useImage&&(previewLoading||previewError));overlay.querySelector('.generation-label').textContent=progress.busy?progress.label:previewError||'正在加载预览';
    overlay.onclick=()=>{if(previewError){previewImages.retry();previewError='';queueSchemeCards();}};
    card.classList.toggle('generated-complete',progress.complete);card.querySelector('.result-stage').textContent=progress.label;
    updateSchemeSelection(card.querySelector('.select-download'),scheme.version,output,switching);
    const retry=card.querySelector('.regenerate-result');retry.hidden=(multiPackageProducts.length>1&&!(currentTaskId&&s7User))||(!output&&phase?.stage!=='failed');retry.disabled=copyingProductPreset||generationBusy||multiPackageBusy||switching;retry.textContent=phase?.stage==='failed'&&lastResultPayload?.remoteTasks?.[scheme.version]&&lastResultPayload?.schemeSignatures?.[scheme.version]===signatures[scheme.version]?'继续获取结果':'重新生成';
    const compare=card.querySelector('.compare-result');compare.hidden=!dirty;compare.textContent=useImage?'看修改预览':'看上次成图';
  }
  previewImages.show(JSON.stringify([selectedMultiProductId,selectedTaskLogoId,entries.map(entry=>entry.url)]),entries,{onLoading:()=>{previewLoading=true;previewError='';queueSchemeCards();},onReady:()=>{previewLoading=false;queueSchemeCards();},onError:()=>{previewLoading=false;previewError='预览加载失败，点击重试';queueSchemeCards();}});
  updateGenerateButton();
}
function createSchemeCards(){
  results.replaceChildren();resultCards=new Map();
  for(const [version,name]of Object.entries(schemeNames)){
    const card=document.createElement('article');card.className='result-card scheme-card';card.dataset.version=version;card.hidden=!schemeState?.schemes.some(scheme=>scheme.version===version)||foilVersions.includes(version)&&!versionInputs.find(input=>input.value===version)?.checked;
    card.innerHTML='<div class="scheme-card-head"><label></label><button type="button" class="text-button edit-scheme">编辑此方案</button></div><div class="scheme-image"><canvas></canvas><img class="result-image" hidden><div class="generation-overlay" role="status" hidden><span class="progress-ring" aria-hidden="true"></span><strong class="generation-label"></strong></div></div><footer><span class="result-stage"></span><div class="result-actions"><button type="button" class="text-button compare-result" hidden></button><button type="button" class="regenerate-result" hidden>重新生成</button><input type="checkbox" class="select-download" disabled></div></footer>';
    card.querySelector('label').textContent=name;
    card.onclick=event=>{if(event.target.closest('button,input,a,canvas,img,.generation-overlay')||card.querySelector('.edit-scheme').disabled)return;switchScheme(version);};
    card.querySelector('.edit-scheme').onclick=()=>switchScheme(version);
    const thumbnail=card.querySelector('canvas');thumbnail.setAttribute('aria-label',`${name}效果示意`);thumbnail.onclick=()=>switchScheme(version);
    const image=card.querySelector('img');image.alt=`${name}生成结果`;image.onclick=()=>{const output=schemeOutput(version);if(output)openImagePreview(name,output.dataUrl,image.currentSrc||image.src);};
    const selection=card.querySelector('.select-download');selection.setAttribute('aria-label',`选择下载${name}`);selection.title=`选择下载${name}`;
    selection.onchange=()=>changeSchemeSelection(version,selection.checked);
    card.querySelector('.regenerate-result').onclick=()=>regenerateResult(version,card);
    card.querySelector('.compare-result').onclick=()=>{showModifiedPreview.has(version)?showModifiedPreview.delete(version):showModifiedPreview.add(version);queueSchemeCards();};
    card.title='按住向左拖动，松手删除搭配';
    bindSchemeSwipe(card,{canRemove:()=>!schemeRemovalBlocked(),onRemove:()=>removeSchemeCard(version)});
    results.append(card);resultCards.set(version,card);
  }
}
for(const button of document.querySelectorAll('[data-scope]'))button.onclick=()=>{syncSchemeState();placementScope=button.dataset.scope;updateSchemeHeading();taskDraft?.schedule();};
document.querySelector('#restore-shared').onclick=()=>{schemeState=restoreSharedGeometry(schemeState,activeScheme);placementScope='shared';loadSchemeTargets();};

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
  printControls.innerHTML='<label>Logo 载体<select data-key="carrierType"><option value="BODY">产品包材</option><option value="CARTON_FRONT">彩盒正面</option><option value="CARTON_BACK">彩盒背面</option></select></label><label>印刷工艺<select data-key="printFinish"><option value="VERSION">本方案默认工艺</option><option value="INK">普通油墨（所选颜色）</option><option value="BLACK">黑白印刷</option><option value="GOLD FOIL">固定烫金</option><option value="SILVER FOIL">固定烫银</option><option value="ROSE GOLD FOIL">固定烫玫瑰金</option><option value="LASER FOIL">固定烫镭射</option></select></label>';
  row.append(printControls);
  const carrierInput=row.querySelector('[data-key="carrierType"]'),finishInput=row.querySelector('[data-key="printFinish"]');
  carrierInput.value=value.carrierType||'BODY';finishInput.value=value.printFinish||'VERSION';
  const refreshDropdowns=[];
  const syncPrintOptions=()=>{const template=multiProductViews.get(loadedMultiProductId)?.foilTemplate,master=masterTargetsFromTemplate(template).find(target=>target.masterZoneId===value.masterZoneId),carton=isCarton(master||{carrierType:carrierInput.value}),allowed=allowedFoilVersions([template],[carton?'carton':'product']);for(const option of carrierInput.options)option.disabled=isMixedVersion(activeScheme)&&!!master&&option.value!==(master.carrierType??'BODY');if(isMixedVersion(activeScheme)&&master)carrierInput.value=master.carrierType??'BODY';if(isMixedVersion(activeScheme)){const finish=mixedVersionFinishes(activeScheme)[carton?'carton':'product'];finishInput.value=finish==='ORIGINAL'?'INK':finish;finishInput.title='工艺由当前搭配确定，其他组合请点击右侧增加搭配';}if(activeScheme==='CUSTOM')finishInput.value='INK';for(const option of finishInput.options)option.disabled=isMixedVersion(activeScheme)?option.value!==finishInput.value:activeScheme==='CUSTOM'?option.value!=='INK':foilVersions.includes(option.value)?!allowed.includes(option.value)||carton&&!isMixedVersion(activeScheme)&&!readFoilRegions().includes('carton'):carton&&option.value==='VERSION';if(finishInput.selectedOptions[0]?.disabled)finishInput.value=activeScheme==='BLACK'?'BLACK':'INK';row.querySelector('.target-head strong').textContent=carrierNames[carrierInput.value];refreshDropdowns.forEach(refresh=>refresh());};
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
  const selection=document.createElement('input');selection.type='checkbox';selection.className='target-select';selection.setAttribute('aria-label',`选择 Logo ${id}`);
  selection.addEventListener('click',event=>event.stopPropagation());
  selection.addEventListener('change',()=>{setTargetSelection(row.dataset.targetId,true);refreshTargetSelection();drawPreview();});
  row.querySelector('.target-head').prepend(selection);
  row.addEventListener('click',event=>{if(event.target.closest('button,input,select,label'))return;setTargetSelection(row.dataset.targetId,event.ctrlKey||event.metaKey);refreshTargetSelection();drawPreview();});
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
function applySelectedLogoPatch(group,patch){
  if(copyingProductPreset||generationSubmitting||generationBusy||multiPackageBusy||logoSelectionBusy||selectedMultiProductId!==loadedMultiProductId)return;
  try{
    syncSchemeState();
    const dimensions=baseImage&&logoImage?{width:baseImage.naturalWidth,height:baseImage.naturalHeight,logoAspect:logoImage.naturalHeight/logoImage.naturalWidth}:undefined;
    schemeState=editSelectedLogos(schemeState,activeScheme,[...selectedTargetIds],group,patch,dimensions);
    loadSchemeTargets();taskDraft?.schedule();
    setStatus('已修改选中同类 Logo，并将大小、角度同步到本 SKU 的所有版本。已有成图需重新生成。','success');
  }catch(error){setStatus(error.message,'error');}
}
function refreshTargetSelection(){
  if(rebuildingTargets)return;
  if(selectedTargetId&&!selectedTargetIds.has(selectedTargetId)){selectedTargetIds.clear();selectedTargetIds.add(selectedTargetId);}
  const available=new Set([...targets.children].map(row=>row.dataset.targetId));
  for(const id of selectedTargetIds)if(!available.has(id))selectedTargetIds.delete(id);
  targets.dataset.selectedCount=String(selectedTargetId?selectedTargetIds.size:0);
  [...targets.children].forEach(row=>{row.classList.toggle('selected',isTargetSelected(row.dataset.targetId));row.querySelector('.target-select').checked=isTargetSelected(row.dataset.targetId);});
  const selectedRow=[...targets.children].find(row=>row.dataset.targetId===selectedTargetId);
  const color=selectedRow?.dataset.logoColor||'#000000';
  const autoContrast=selectedRow?.dataset.autoContrast==='true';
  originalColorInput.value=color.toUpperCase();originalColorInput.setAttribute('aria-invalid','false');
  const keepOriginal=selectedRow?.dataset.keepOriginal==='true';
  const selected=collectTargets().find(target=>target.id===selectedTargetId);
  const print=selected?resolveTargetPrint(selected,activeScheme):null;
  document.querySelector('#custom-colors').hidden=activeScheme!=='CUSTOM';
  for(const group of ['product','carton']){
    const target=collectTargets().find(target=>isCarton(target)===(group==='carton')),input=document.querySelector(`#custom-${group}-color`);
    input.value=(target?.color||'#000000').toUpperCase();input.setAttribute('aria-invalid','false');input.disabled=!target||copyingProductPreset||generationBusy||multiPackageBusy||logoSelectionBusy;
    document.querySelector(`#custom-${group}-color-value`).textContent=target?'':'无对应区域';
  }
  document.querySelector('#original-colors-field').hidden=activeScheme==='CUSTOM'||print?.version!=='ORIGINAL';
  originalColorInput.closest('.color-field').hidden=activeScheme==='CUSTOM'||print?.version!=='ORIGINAL';
  document.querySelector('.auto-contrast-field').hidden=print?.version!=='BLACK';
  document.querySelector('#keep-original-colors').checked=keepOriginal;
  document.querySelector('#keep-original-colors').disabled=isMixedVersion(activeScheme);
  originalColorInput.disabled=isMixedVersion(activeScheme)||print?.version!=='ORIGINAL'||keepOriginal;
  autoContrastInput.checked=autoContrast;
  autoContrastInput.disabled=isMixedVersion(activeScheme)||!selectedRow||isCarton({carrierType:selectedRow.querySelector('[data-key="carrierType"]').value})||selectedRow.querySelector('[data-key="printFinish"]').value==='INK';
  originalColorValue.textContent=print?.version==='ORIGINAL'&&keepOriginal?'Logo 原色':'';
  document.querySelector('#selected-target').textContent=selectedTargetIds.size>1?`已选择 ${selectedTargetIds.size} 个 Logo`:selectedTargetId?`当前：${selectedTargetId}`:'未选择目标';
}
function targetRect(target){
  const width=target.widthRatio*canvas.width;
  const height=logoImage?width*logoImage.naturalHeight/logoImage.naturalWidth:width;
  return {left:target.x*canvas.width-width/2,top:target.y*canvas.height-height/2,width,height};
}
function targetAt(point){
  const list=collectTargets();
  for(let i=list.length-1;i>=0;i--){
    const target=list[i];
    if(target.quad){
      let inside=false;
      for(let j=0,k=target.quad.length-1;j<target.quad.length;k=j++){
        const a=target.quad[j],b=target.quad[k],cross=(point.x-a.x)*(b.y-a.y)-(point.y-a.y)*(b.x-a.x);
        if(Math.abs(cross)<1e-9&&point.x>=Math.min(a.x,b.x)&&point.x<=Math.max(a.x,b.x)&&point.y>=Math.min(a.y,b.y)&&point.y<=Math.max(a.y,b.y))return target;
        if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
      }
      if(inside)return target;
    }else{
      const rect=targetRect(target),angle=-(target.rotation||0)*Math.PI/180,dx=(point.x-target.x)*canvas.width,dy=(point.y-target.y)*canvas.height;
      if(Math.abs(dx*Math.cos(angle)-dy*Math.sin(angle))<=rect.width/2&&Math.abs(dx*Math.sin(angle)+dy*Math.cos(angle))<=rect.height/2)return target;
    }
  }
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
function isTargetSelected(id){return selectedTargetId!==null&&(id===selectedTargetId||selectedTargetIds.has(id));}
function setTargetSelection(id,additive=false){
  if(!additive)selectedTargetIds.clear();
  if(id){
    if(additive&&selectedTargetIds.has(id))selectedTargetIds.delete(id);else selectedTargetIds.add(id);
  }
  selectedTargetId=id&&selectedTargetIds.has(id)?id:[...selectedTargetIds].at(-1)||null;
}
function selectedHandleAt(point,hitRadius){
  const hits=[];
  for(const target of collectTargets().filter(target=>isTargetSelected(target.id))){
    const handles=handlePoints(target);
    for(const [mode,position] of [['scale',handles.scale],['rotate-pending',handles.rotation]]){
      const separation=distance(point,position);
      if(separation<=hitRadius)hits.push({target,mode,separation});
    }
  }
  return hits.sort((a,b)=>a.separation-b.separation)[0];
}

function drawPreview(){
  if(rebuildingTargets)return;
  syncSchemeState();queueSchemeCards();taskDraft?.schedule();
  if(!baseImage){canvas.width=1;canvas.height=1;previewEmpty.hidden=false;return;}
  const scale=Math.min(1,1200/Math.max(baseImage.naturalWidth,baseImage.naturalHeight));
  canvas.width=Math.max(1,Math.round(baseImage.naturalWidth*scale));canvas.height=Math.max(1,Math.round(baseImage.naturalHeight*scale));previewEmpty.hidden=true;
  const context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(baseImage,0,0,canvas.width,canvas.height);
  if(!logoImage)return;
  if(previewBaseImage!==baseImage){previewBasePixels=context.getImageData(0,0,canvas.width,canvas.height).data;previewBaseImage=baseImage;}
  const basePixels=previewBasePixels;
  for(const target of collectTargets()){
    const width=target.widthRatio*canvas.width,height=width*logoImage.naturalHeight/logoImage.naturalWidth;
    const targetColor=target.color||'#000000';
    const rect=targetRect(target);
    const contrastColor=target.autoContrast&&resolveTargetPrint(target,activeScheme).version==='BLACK'?chooseContrastColor({data:basePixels,width:canvas.width,height:canvas.height,left:rect.left,top:rect.top,boxWidth:rect.width,boxHeight:rect.height,logo:logoContrastPixels(),rotation:target.rotation,quad:target.quad,curve:target.curve}):null;
    const print=resolveTargetPrint(target,document.querySelector('#preview-version').value,targetColor,contrastColor);

    const logoLayer=renderTintedLogoLayer({
      createCanvas:(layerWidth,layerHeight)=>{const layer=document.createElement('canvas');layer.width=layerWidth;layer.height=layerHeight;return layer;},
      logoImage,width,height,color:print.color,finish:print.finish
    });
    const curvedLayer=curvePreviewLogo(logoLayer,target.curve);
    if(target.quad)drawQuadPreview(context,curvedLayer,target.quad);else{context.save();context.translate(target.x*canvas.width,target.y*canvas.height);context.rotate(target.rotation*Math.PI/180);context.globalAlpha=1;context.drawImage(curvedLayer,-width/2,-height/2,width,height);if(isTargetSelected(target.id)){context.strokeStyle='#5369d9';context.lineWidth=Math.max(2,canvas.width/500);context.setLineDash([]);context.strokeRect(-width/2,-height/2,width,height);}context.restore();}
    if(isTargetSelected(target.id)){const handles=handlePoints(target),size=Math.max(10,canvas.width/80);context.setLineDash([]);context.strokeStyle='#5369d9';context.lineWidth=Math.max(2,canvas.width/500);context.beginPath();context.moveTo(handles.center.x,handles.center.y);context.lineTo(handles.rotation.x,handles.rotation.y);context.stroke();context.fillStyle='#5369d9';context.fillRect(handles.scale.x-size/2,handles.scale.y-size/2,size,size);drawRotationArrow(context,handles.rotation,size*1.55,target.rotation);if(target.quad){const points=target.quad.map(point=>({x:point.x*context.canvas.width,y:point.y*context.canvas.height}));context.beginPath();context.moveTo(points[0].x,points[0].y);for(const point of points.slice(1))context.lineTo(point.x,point.y);context.closePath();context.stroke();if(selectedTargetIds.size<=1)for(const point of points)context.fillRect(point.x-size/2,point.y-size/2,size,size);}}
  }
}

canvas.addEventListener('pointerdown',event=>{
  if(!baseImage||!logoImage)return;
  const normalized=pointerToNormalized(event.clientX,event.clientY,canvas.getBoundingClientRect()),point={x:normalized.x*canvas.width,y:normalized.y*canvas.height};
  if(event.ctrlKey||event.metaKey){event.preventDefault();setTargetSelection(targetAt(normalized)?.id||null,true);refreshTargetSelection();drawPreview();return;}
  dragBatchGroup=null;
  const multiple=selectedTargetIds.size>1,hitRadius=Math.max(18,canvas.width/35),hit=multiple?selectedHandleAt(point,hitRadius):null;
  const selected=hit?.target||(!multiple?collectTargets().find(target=>target.id===selectedTargetId):null),handles=selected?handlePoints(selected):null;
  const quadDistances=(!multiple?selected?.quad:null)?.map(corner=>distance(point,{x:corner.x*canvas.width,y:corner.y*canvas.height}))||[];
  const quadIndex=quadDistances.findIndex(distanceToCorner=>distanceToCorner<=hitRadius);
  if(quadIndex>=0){dragTarget=selected;dragMode=`quad-${quadIndex}`;}
  else if(hit?.mode==='scale'||(!multiple&&handles&&distance(point,handles.scale)<=hitRadius)){dragTarget=selected;dragMode='scale';}
  else if(hit?.mode==='rotate-pending'||(!multiple&&handles&&distance(point,handles.rotation)<=hitRadius)){
    dragTarget=selected;dragMode='rotate-pending';rotatePointerId=event.pointerId;rotateStartedAt=Date.now();
    if(rotateTimer!==null)clearTimeout(rotateTimer);
    rotateTimer=setTimeout(()=>{if(dragTarget===selected&&dragMode==='rotate-pending'&&rotatePointerId===event.pointerId)dragMode='rotate';},ROTATE_LONG_PRESS_MS);
  }
  else{dragTarget=targetAt(normalized);if(dragTarget&&!canMoveTarget(dragTarget)){setTargetSelection(dragTarget.id);refreshTargetSelection();drawPreview();setStatus('该 Logo 的母版位置已锁定，请先点击目标卡片中的“移动位置”。','success');dragTarget=null;return;}dragMode=dragTarget?'move':null;}
  if(!dragTarget){setTargetSelection(null);refreshTargetSelection();drawPreview();return;}
  if(multiple&&['scale','rotate-pending'].includes(dragMode)){dragBatchGroup=isCarton(dragTarget)?'carton':'product';selectedTargetId=dragTarget.id;}else setTargetSelection(dragTarget.id);
  canvas.setPointerCapture(event.pointerId);canvas.classList.add('dragging');refreshTargetSelection();drawPreview();
});
canvas.addEventListener('pointermove',event=>{
  if(!dragTarget)return;
  if(dragMode==='rotate-pending')return;
  const normalized=pointerToNormalized(event.clientX,event.clientY,canvas.getBoundingClientRect()),point={x:normalized.x*canvas.width,y:normalized.y*canvas.height};
  if(dragBatchGroup){
    if(dragMode==='scale')applySelectedLogoPatch(dragBatchGroup,{widthRatio:widthRatioFromScalePointer(dragTarget,point,canvas.width,canvas.height)});
    if(dragMode==='rotate')applySelectedLogoPatch(dragBatchGroup,{rotation:rotationFromPointer({x:dragTarget.x*canvas.width,y:dragTarget.y*canvas.height},point,handlePoints(dragTarget).rotationReferenceAngle)});
    return;
  }
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
  if(step&&dragBatchGroup)applySelectedLogoPatch(dragBatchGroup,{rotation:rotateTargetInPlace({rotation:target.rotation},-90).rotation});
  if(step&&!dragBatchGroup){rotateTargetInPlace(target,-90);updateInputs(target);updateQuad(target);refreshTargetSelection();drawPreview();setStatus('已自动将 Logo 逆时针旋转 90°。长按旋转箭头可进行自由旋转。','success');}
  dragTarget=null;dragMode=null;dragBatchGroup=null;rotatePointerId=null;canvas.classList.remove('dragging');if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
}
canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);
canvas.addEventListener('contextmenu',async event=>{
  if(!baseImage||!logoImage||!logoData)return;
  const normalized=pointerToNormalized(event.clientX,event.clientY,canvas.getBoundingClientRect());
  if(!targetAt(normalized))return;
  event.preventDefault();
  try{const asset=taskLogos.find(logo=>logo.id===loadedTaskLogoId)?.logoAssetUrl;let data=logoData;if(asset){const response=await fetch(asset);if(!response.ok)throw Error('Logo 原图读取失败');data=(await fileData(await response.blob())).data;}triggerTransparentLogoDownload(data,{filename:'logo-transparent.png'});setStatus('已保存透明 Logo PNG，可直接复用，无需再次调用 AI。','success');}catch(error){setStatus(error.message,'error');}
});

document.querySelector('#add-target').onclick=()=>addTarget();
chooseProductButton.onclick=openProductLibrary;
closeProductLibraryButton.onclick=()=>{productLibraryPanel.hidden=true;};
productLibrarySearch.oninput=renderProductLibrary;
chooseLogoLibraryButton.onclick=openLogoLibrary;
closeLogoLibraryButton.onclick=()=>{logoLibraryPanel.hidden=true;};
logoLibrarySearch.oninput=renderLogoLibrary;
document.querySelector('#preview-version').onchange=()=>switchScheme(document.querySelector('#preview-version').value);
function readHexColor(input,output){
  const hex=input.value.trim().replace(/^#/,'');
  const valid=/^[0-9a-f]{6}$/i.test(hex);
  input.setAttribute('aria-invalid',String(!valid));output.textContent=valid?'':'请填写 6 位 HEX';
  if(!valid)return null;
  input.value='#'+hex.toUpperCase();return input.value;
}
for(const group of ['product','carton'])document.querySelector(`#custom-${group}-color`).oninput=event=>{
  if(activeScheme!=='CUSTOM'||copyingProductPreset||generationBusy||multiPackageBusy||logoSelectionBusy)return;
  const color=readHexColor(event.target,document.querySelector(`#custom-${group}-color-value`));if(!color)return;
  syncSchemeState();schemeState=setCustomColors(schemeState,{[group]:color});loadSchemeTargets();taskDraft?.schedule();
};
originalColorInput.oninput=()=>{const selectedRow=[...targets.children].find(row=>row.dataset.targetId===selectedTargetId);if(!selectedRow)return;const color=readHexColor(originalColorInput,originalColorValue);if(!color)return;selectedRow.dataset.logoColor=color;selectedRow.dataset.keepOriginal='false';drawPreview();};
document.querySelector('#keep-original-colors').onchange=event=>{const row=[...targets.children].find(row=>row.dataset.targetId===selectedTargetId);if(!row)return;row.dataset.keepOriginal=String(event.target.checked);refreshTargetSelection();drawPreview();};
autoContrastInput.onchange=()=>{const selectedRow=[...targets.children].find(row=>row.dataset.targetId===selectedTargetId);if(!selectedRow)return;selectedRow.dataset.autoContrast=String(autoContrastInput.checked);drawPreview();};
async function refineSelectedLogo(){
  if(aiLogoBusy||logoSelectionBusy||generationBusy||generationSubmitting||multiPackageBusy||copyingProductPreset||!logoData)return;
  const id=loadedTaskLogoId,source=logoData,logo=taskLogos.find(logo=>logo.id===id);
  aiLogoBusy=true;logoSelectionBusy=true;updateGenerateButton();renderLogoLibrary();renderProductLibrary();
  aiRefineStatus.textContent='正在用 AI 分离背景并保留 Logo 细节，请稍候…';
  aiRefineStatus.className='hint';setStatus('正在精细化处理当前 Logo…','busy');
  try{
    const ready=await fetch('/api/ai-logo/status'),provider=await ready.json();
    if(!ready.ok||!provider.configured)throw Error('尚未配置可用的 AI 图片接口，请检查原有 APIMart 设置。');
    const response=await fetch('/api/ai-process-logo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({logoImage:source,targetColor:'original',preserveDetails:true})});
    const payload=await response.json();if(!response.ok)throw Error(payload.error||'AI 精细化处理失败');
    if(typeof payload.dataUrl!=='string'||!payload.dataUrl.startsWith('data:image/png;base64,'))throw Error('AI 未返回有效透明 PNG');
    const image=await loadImage(payload.dataUrl);
    if(loadedTaskLogoId!==id||logoData!==source)throw Error('当前 Logo 已变化，未替换新选中的图片；处理结果可从 Logo 库获取。');
    logoSourceData=logoSourceData||source;logoData=payload.dataUrl.split(',')[1];logoImage=image;
    const name=`${(logo?.name||'Logo').replace(/\.[^.]+$/,'')}（AI精细化）.png`;
    if(logo){logo.aiRefined=true;logo.name=name;}
    setSelectedLogoPreview(payload.dataUrl,name);drawPreview();queueSchemeCards();
    saveLogo(logoStorage,{data:logoData,name,sourceData:logoSourceData,aiRefined:true});
    useSavedLogoButton.hidden=false;clearSavedLogoButton.hidden=false;
    taskDraft?.schedule();await taskDraft?.flush();
    aiRefineStatus.textContent=payload.logoLibraryError?'处理完成，已应用到当前任务。Logo 库保存失败，可先下载透明 PNG。':'处理完成，已应用到当前 Logo。请核对文字和细节，可下载透明 PNG。';
    setStatus(aiRefineStatus.textContent,'success');
  }catch(error){aiRefineStatus.textContent=error.message||'AI 精细化处理失败，请重试';aiRefineStatus.className='hint provider-missing';setStatus(aiRefineStatus.textContent,'error');}
  finally{aiLogoBusy=false;logoSelectionBusy=logoDecoding||logoImportBusy;updateGenerateButton();renderLogoLibrary();renderProductLibrary();renderMultiProductResults();}
}
aiRefineButton.onclick=refineSelectedLogo;

async function importLogoFiles(files){
  if(generationBusy||multiPackageBusy||logoSelectionBusy)return;
  if(!files.length)return;
  logoImportBusy=true;logoSelectionBusy=true;updateGenerateButton();
  try{for(const file of files){const loaded=await fileData(file);await addTaskLogo({id:crypto.randomUUID(),name:(file.name||'粘贴的 Logo.png').slice(0,120),logoImage:loaded.data,sourceData:loaded.data});}}
  catch(error){setStatus(error.message,'error');}
  finally{logoImportBusy=false;logoSelectionBusy=logoDecoding;updateGenerateButton();renderLogoLibrary();renderProductLibrary();}
}
document.querySelector('#logo-image').onchange=async event=>{
  try{await importLogoFiles([...event.target.files]);}finally{event.target.value='';}
};
bindLogoImageTransfer({dropzone:document.querySelector('#logo-dropzone'),onFiles:importLogoFiles});

useSavedLogoButton.onclick=async()=>{try{await useSavedLogo();setStatus('已使用保存的透明 Logo，无需重新生成。','success');}catch(error){setStatus(error.message,'error');}};
clearSavedLogoButton.onclick=()=>{clearSavedLogo(logoStorage);useSavedLogoButton.hidden=true;clearSavedLogoButton.hidden=true;setStatus('已清除保存的透明 Logo；当前页面中的 Logo 仍可继续使用。','success');};

async function loadMockupModels(){
  mockupModel.replaceChildren(new Option('本地合成','local'));
  mockupModel.value='local';mockupModel.disabled=true;
  renderMultiProductResults();
}

function setPreviewScale(value){
  previewScale=Math.min(4,Math.max(.25,value));
  imagePreviewImage.style.transform=`scale(${previewScale})`;
  zoomReset.textContent=`${Math.round(previewScale*100)}%`;
}
function openImagePreview(version,dataUrl,fallbackSrc){
  imagePreviewTitle.textContent=`${version} · 图片预览`;
  imagePreview.hidden=false;
  setPreviewScale(1);
  imagePreviewStatus.onclick=()=>fullImagePreview.show(dataUrl,fallbackSrc);
  return fullImagePreview.show(dataUrl,fallbackSrc);
}
function closeImagePreview(){imagePreview.hidden=true;fullImagePreview.close();}
async function regenerateResult(version,card){
  if(taskLogos.length>1){await runMultiLogoGeneration({onlyLogoId:loadedTaskLogoId,selectedVersions:[version]});return;}
  if(multiPackageProducts.length>1){await runMultiPackageGeneration({onlyProductId:loadedMultiProductId,selectedVersions:[version]});return;}
  await runGeneration([version],version);
}
const versionInputs=[...document.querySelectorAll('#generation-versions input')];
const selectedGenerationVersions=()=>versionInputs.filter(input=>input.checked).map(input=>input.value);
let addingPrintCombination=false;
function registerMixedVersions(versions){
 for(const version of versions.filter(isMixedVersion)){
  schemeNames[version]=mixedVersionName(version);
  if(versionInputs.some(input=>input.value===version))continue;
  const input=document.createElement('input');input.type='checkbox';input.value=version;input.checked=false;document.querySelector('#generation-versions').append(input);versionInputs.push(input);
  input.addEventListener('change',()=>{updateGenerateButton();queueSchemeCards();taskDraft?.schedule();});
  const option=document.createElement('option');option.value=version;option.textContent=schemeNames[version];document.querySelector('#preview-version').append(option);
 }
}
function restoreProductSelection(view){
 registerMixedVersions(view.schemeState.schemes.map(scheme=>scheme.version));
 const selected=view.selectedVersions||['ORIGINAL','BLACK'];
 for(const input of versionInputs)input.checked=selected.includes(input.value);
}
function selectedProductPlans(){
 return multiPackageProducts.map(product=>({productId:product.id,selectedVersions:product.id===loadedMultiProductId?selectedGenerationVersions():multiProductViews.get(product.id)?.selectedVersions||['ORIGINAL','BLACK']}));
}
function restoreMixedVersions(state){
 const layouts=[...(state.multiProductLayouts||[]),...(state.multiLogoLayouts||[])];
 registerMixedVersions([...(state.mixedVersions||[]),...(state.selectedVersions||[]),...(state.schemeState?.schemes||[]).map(scheme=>scheme.version),...layouts.flatMap(layout=>(layout.schemeState?.schemes||[]).map(scheme=>scheme.version))]);
 if(Array.isArray(state.selectedVersions))for(const input of versionInputs)input.checked=state.selectedVersions.includes(input.value);
}
async function addPrintCombination(){
 if(addingPrintCombination||copyingProductPreset||generationBusy||generationSubmitting||multiPackageBusy||logoSelectionBusy||selectedMultiProductId!==loadedMultiProductId||!multiPackageProducts.length)return;
 addingPrintCombination=true;updateGenerateButton();
 try{
  const product=multiPackageProducts.find(product=>product.id===loadedMultiProductId),view=await loadMultiProductView(product);
  const response=await fetch(`/api/product-library/template/${encodeURIComponent(product.id)}`,{cache:'no-store'});if(!response.ok)throw Error('产品母版读取失败');view.foilTemplate=(await response.json()).template;
  const refreshed=rebindMasterZones(schemeState,view.foilTemplate);if(refreshed!==schemeState){schemeState=refreshed;loadSchemeTargets();}
  const choice=await choosePrintCombination([view.foilTemplate]);if(!choice)return;
  if(generationBusy||generationSubmitting||multiPackageBusy)return;
  syncSchemeState();saveMultiProductView();
  const version=choice.product===choice.carton&&['ORIGINAL','BLACK'].includes(choice.product)?choice.product:mixedVersion(choice.product,choice.carton);
  registerMixedVersions([version]);
  if(isMixedVersion(version)){
   for(const view of multiLogoViews.values())if(view.schemeState)view.schemeState=ensureMixedSchemes(view.schemeState,[version]);
   schemeState=ensureMixedSchemes(schemeState,[version]);
  }
  reviveSchemeCard(version);saveSchemeRemoval();
  versionInputs.find(input=>input.value===version).checked=true;createSchemeCards();switchScheme(version);taskDraft?.schedule();
  setStatus(`已为 ${product.sku} 选择${schemeNames[version]}，可调整位置后开始作图。`,'success');
 }catch(error){setStatus(error.message||'增加搭配失败，请重试','error');}
 finally{addingPrintCombination=false;updateGenerateButton();queueSchemeCards();}
}
document.querySelector('#add-print-combination').onclick=addPrintCombination;
document.querySelector('#undo-scheme-removal').onclick=restoreRemovedScheme;
for(const input of document.querySelectorAll('[data-foil-version]'))input.onchange=()=>{
 const source=versionInputs.find(source=>source.value===input.dataset.foilVersion);source.checked=input.checked;updateGenerateButton();queueSchemeCards();taskDraft?.schedule();
};
for(const input of document.querySelectorAll('[data-foil-region]'))input.onchange=()=>{
 if(schemeState){syncSchemeState();for(const view of multiProductViews.values())if(view.schemeState)view.schemeState=scopedFoilState(ensureCustomScheme(view.schemeState));for(const view of multiLogoViews.values())if(view.schemeState)view.schemeState=scopedFoilState(ensureCustomScheme(view.schemeState));schemeState=scopedFoilState(schemeState);loadSchemeTargets();}
 updateGenerateButton();queueSchemeCards();
 taskDraft?.schedule();
};

let generationBusy=false,generationSubmitting=false;
function updateGenerateButton(){
 const currentLogo=taskLogos.find(logo=>logo.id===loadedTaskLogoId);
 aiRefineButton.disabled=!logoData||aiLogoBusy||logoSelectionBusy||generationSubmitting||generationBusy||multiPackageBusy||copyingProductPreset;
 aiRefineButton.textContent=aiLogoBusy?'AI 处理中…':'AI 精细化处理';
 aiRefineButton.setAttribute('aria-busy',String(aiLogoBusy));
 aiRefineDownload.hidden=!currentLogo?.aiRefined;
 if(currentLogo?.aiRefined){aiRefineDownload.href='data:image/png;base64,'+logoData;aiRefineDownload.download=currentLogo.name;}
 const addCombination=document.querySelector('#add-print-combination');if(addCombination)addCombination.disabled=addingPrintCombination||copyingProductPreset||generationBusy||multiPackageBusy||generationSubmitting||logoSelectionBusy||!multiPackageProducts.length||selectedMultiProductId!==loadedMultiProductId;
 const foilInputs=[...document.querySelectorAll('[data-foil-version]')];
 if(foilInputs.length){
  const templates=loadedMultiProductId?[multiProductViews.get(loadedMultiProductId)?.foilTemplate]:[],ready=templates.length>0&&templates.every(Boolean),busy=generationBusy||multiPackageBusy||generationSubmitting;
  let changed=false;
  for(const input of document.querySelectorAll('[data-foil-region]')){const supported=allowedFoilVersions(templates,[input.dataset.foilRegion]).length>0;input.disabled=busy||!supported;input.title=!ready?'请先选择已发布母版的产品':supported?'':input.dataset.foilRegion==='product'?'所选产品母版不支持产品烫印':'所选产品缺少彩盒区域';if(ready&&!busy&&!supported&&input.checked){input.checked=false;changed=true;}}
  const allowed=allowedFoilVersions(templates,readFoilRegions());
  document.querySelector('#foil-hint').textContent=ready&&!allowedFoilVersions(templates,['product']).length?'所选母版未开放产品烫印。彩盒可按需选择烫印，生成前需知晓提示。':'产品仅可选择母版支持的工艺；彩盒默认不烫印，选择后需知晓提示才能继续。';
  for(const input of foilInputs){const source=versionInputs.find(source=>source.value===input.dataset.foilVersion),supported=allowed.includes(input.dataset.foilVersion);source.disabled=!supported;if(ready&&!busy&&!supported&&source.checked){source.checked=false;changed=true;}input.checked=source.checked;input.disabled=busy||!supported;input.title=!ready?'请先选择已发布母版的产品':!readFoilRegions().length?'请先选择烫印区域':supported?'':'所选产品母版不支持此烫印工艺';}
  for(const input of versionInputs.filter(input=>isMixedVersion(input.value))){input.disabled=!canSelectMixedVersion(templates,input.value);if(ready&&!busy&&input.disabled&&input.checked){input.checked=false;changed=true;}}
  if(changed)queueSchemeCards();
 }
 updateAllSchemeSelection();
 multiProductTabs.inert=generationSubmitting||aiLogoBusy;
 const apply=document.querySelector('#apply-product-preset');
 apply.hidden=multiPackageProducts.length<2||taskLogos.length>1;
 apply.disabled=copyingProductPreset||generationSubmitting||generationBusy||multiPackageBusy||logoSelectionBusy||selectedMultiProductId!==loadedMultiProductId;
 apply.title='选择载体、搭配和参数；产品设置应用到所有已选 SKU 的全部产品 Logo';
 apply.textContent=copyingProductPreset?'正在应用…':'同步设置…';
 const colorEditingDisabled=copyingProductPreset||generationSubmitting||generationBusy||multiPackageBusy||logoSelectionBusy||selectedMultiProductId!==loadedMultiProductId;
 for(const group of ['product','carton'])document.querySelector(`#custom-${group}-color`).disabled=colorEditingDisabled||!collectTargets().some(target=>isCarton(target)===(group==='carton'));
 multiProductTabs.querySelectorAll('.remove-task-asset').forEach(button=>button.disabled=generationBusy||multiPackageBusy||logoSelectionBusy);
 const count=selectedGenerationVersions().length,plans=multiPackageProducts.length>1?selectedProductPlans().filter(plan=>plan.selectedVersions.length):[],total=multiPackageProducts.length>1?plans.reduce((sum,plan)=>sum+plan.selectedVersions.length,0):count,button=document.querySelector('#generate');
 button.textContent=generationSubmitting||generationBusy||multiPackageBusy?'正在生成…':!total?'请至少选择一套方案':taskLogos.length>1?`为 ${taskLogos.length} 个 Logo 生成 ${count} 种效果 · 共 ${taskLogos.length*count} 张`:multiPackageProducts.length>1?`为 ${plans.length} 个产品生成各自所选搭配 · 共 ${total} 张`:`生成选中的 ${count} 套方案`;
 button.disabled=copyingProductPreset||generationSubmitting||generationBusy||multiPackageBusy||logoSelectionBusy||!total||(taskLogos.length>1&&(!multiLogoEnabled||multiPackageProducts.length!==1));
 const modified=modifiedSchemes(),retry=document.querySelector('#generate-modified');
 retry.hidden=(multiPackageProducts.length>1&&!(currentTaskId&&s7User))||!modified.length;retry.textContent=`重新生成已修改的 ${modified.length} 套方案`;retry.disabled=copyingProductPreset||generationBusy||multiPackageBusy;
}
for(const input of versionInputs)input.addEventListener('change',()=>{updateGenerateButton();taskDraft?.schedule();});
selectAllSchemes.onchange=()=>changeAllSchemeSelection(selectAllSchemes.checked);
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
  const text=multiPackageBusy?(record.providerActivationPending?'任务已排队，等待启用生成':`正在生成 · ${done}/${total} 张已完成`):done===total?'已生成完成':`已完成 ${done}/${total} 张，未完成图片可重新生成。`;
  if(status.textContent!==text)setStatus(text,multiPackageBusy?'busy':failed?'error':'success');
  notifyTask(text,multiPackageBusy);renderMultiProductResults();queueSchemeCards();updateGenerateButton();
  const next=multiPackageProducts[(multiPackageProducts.findIndex(product=>product.id===selectedMultiProductId)+1)%multiPackageProducts.length];
  if(next&&taskActive)setTimeout(()=>previewImages.preload(record.outputs.filter(output=>output.productId===next.id).map(output=>previewImageUrl(s7Path(output.dataUrl)))),200);
}
function restoreGeneration(record){
  if(generationSubmitting)return;
  if(record.id&&record.id===dismissedGenerationId)return;
  if(record.kind==='multi-logo'){restoreMultiLogoGeneration(record);return;}
  multiLogoJob=null;
  if(record.kind==='multi-product'){restoreMultiProductGeneration(record);return;}
  if(generationId!==record.id){generationId=record.id;beginResultProgress(record);}
  lastResultPayload.remoteTasks=record.remoteTasks||{};
  for(const output of record.outputs)completeResultProgress({...output,dataUrl:s7Path(output.dataUrl)},false);
  for(const [version,value]of Object.entries(record.stages))schemePhases[version]=value;
  const busy=record.status==='running',failed=Object.values(record.stages).filter(value=>value.stage==='failed').length;
  generationBusy=busy;queueSchemeCards();
  resultMeta.textContent=busy?'后台生成中 · 可继续编辑其他方案':failed?`${failed} 套方案可重试`:'生成结果已保存';
  const text=busy?(record.providerActivationPending?'任务已排队，等待启用生成':'正在后台生成，完成一张就展示一张。'):record.status==='interrupted'?'服务已重启，已完成图片保留，可重试未完成方案。':failed?'已保留成功结果，失败方案可单独重试。':'方案已保存，可继续调整。';
  if(status.textContent!==text)setStatus(text,busy?'busy':failed?'error':'success');
}
function generationRequest(versions,onlyVersion){
 syncSchemeState();submittedSignatures=currentSignatures();
 const baseAssetUrl=multiProductViews.get(loadedMultiProductId)?.baseAssetUrl;
 return {onlyVersion,selectedVersions:versions,preserveResults:true,schemeSignatures:{...submittedSignatures},model:mockupModel.value,...(baseAssetUrl?{baseAssetUrl}:{baseImage:baseData}),logoImage:logoData,targets:collectTargets(),schemes:structuredClone(schemeState.schemes),originalColor:'#000000'};
}
async function submitBackgroundGeneration(onlyVersion,versions=onlyVersion?[onlyVersion]:selectedGenerationVersions()){
  if(!baseData||!logoData)throw Error('请先选择产品和 Logo。');
  const request=generationRequest(versions,onlyVersion);
  taskDraft?.schedule();await taskDraft?.flush();
  const response=await fetch('/api/ai-render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...request,background:true})});
  const record=await response.json();if(!response.ok)throw Error(record.error||'提交生成失败');
  generationSubmitting=false;generationWatcher.track(record);
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

async function showGenerationSubmission(versions){
  generationSubmitting=true;generationWatcher?.pause();
  for(const version of versions)schemePhases[version]={stage:'submitting',label:'正在生成'};
  resultMeta.textContent='正在生成 · 正在提交任务';
  setStatus('正在生成，正在保存并提交任务，请勿重复点击。','busy');
  updateGenerateButton();queueSchemeCards();
  await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
}
function failGenerationSubmission(versions,error){
 if(error.cancelled){for(const version of versions){if(lastResultPayload?.outputs?.some(output=>output.version===version))schemePhases[version]={stage:'complete'};else delete schemePhases[version];}resultMeta.textContent='已返回修改';setStatus(error.message,'success');queueSchemeCards();return;}
  generationWatcher?.pause();
  generationSubmitting=false;
  for(const version of versions)if(schemePhases[version]?.stage!=='complete')schemePhases[version]={stage:'failed',error:error.message||'生成失败'};
  resultMeta.textContent='生成失败，可重试';setStatus(error.message||'生成失败','error');queueSchemeCards();
}
async function runGeneration(selectedVersions,onlyVersion){
  if(copyingProductPreset||generationSubmitting||generationBusy||multiPackageBusy||logoSelectionBusy)return;
  if(!baseData||!logoData){setStatus('请先选择产品和 Logo。','error');return;}
  if(!selectedVersions.length)return;
  generationBusy=true;let backgroundAccepted=false;
  try{
    await showGenerationSubmission(selectedVersions);
    if(currentTaskId&&s7User){await submitBackgroundGeneration(onlyVersion,selectedVersions);backgroundAccepted=true;return;}
    const request=generationRequest(selectedVersions,onlyVersion);
    beginResultProgress({selectedVersions});setStatus(`正在生成 ${selectedVersions.length} 套方案，结果将逐张显示。`,'busy');
    const response=await fetch('/api/ai-render',{method:'POST',headers:{'content-type':'application/json','accept':'text/event-stream'},body:JSON.stringify(request)});
    if(!response.ok||!response.headers.get('content-type')?.includes('text/event-stream')){const payload=await response.json();throw Error(payload.error||'生成失败');}
    generationSubmitting=false;updateGenerateButton();
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
  }catch(error){failGenerationSubmission(selectedVersions,error);}
  finally{generationSubmitting=false;if(!backgroundAccepted)generationBusy=false;queueSchemeCards();updateGenerateButton();}
}
async function runMultiPackageGeneration(options={}){
  if(copyingProductPreset||generationSubmitting||generationBusy||multiPackageBusy||logoSelectionBusy)return;
  const plans=selectedProductPlans().map(plan=>({...plan,selectedVersions:options.onlyProductId?(plan.productId===options.onlyProductId?options.selectedVersions||plan.selectedVersions:[]):plan.selectedVersions}));
  options={...options,selectedVersions:[...new Set(plans.flatMap(plan=>plan.selectedVersions))]};if(!options.selectedVersions.length)return;
  const currentVersions=plans.find(plan=>plan.productId===loadedMultiProductId)?.selectedVersions||[];
  if(!logoData){setStatus('请先选择一个 Logo。','error');return;}
  if(multiPackageProducts.length<2){setStatus('请至少勾选两个已建立母版的包材。','error');return;}
  if(selectedMultiProductId!==loadedMultiProductId){setStatus('产品预览仍在加载，请加载完成后生成。','error');return;}
  multiPackageBusy=true;
  try{
  await showGenerationSubmission(currentVersions);
  await Promise.all(multiPackageProducts.map(product=>loadMultiProductView(product)));
  const productLayouts=captureMultiProductLayouts().map(layout=>{
    const view=multiProductViews.get(layout.productId),assets=schemeSignature({version:'assets',targets:[{id:[view.baseAssetUrl||view.baseData,logoData,mockupModel.value].join('|')}]});
    return {productId:layout.productId,selectedVersions:plans.find(plan=>plan.productId===layout.productId).selectedVersions,baseAssetUrl:layout.baseAssetUrl||undefined,targets:layout.targets,schemes:layout.schemeState.schemes,schemeSignatures:Object.fromEntries(layout.schemeState.schemes.map(scheme=>[scheme.version,schemeSignature(scheme,assets)]))};
  });
  if(currentTaskId&&s7User){
    await taskDraft.flush();
    const response=await fetch('/api/ai-render-multi',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...options,background:true,productIds:multiPackageProducts.map(product=>product.id),productLayouts,logoImage:logoData,model:mockupModel.value,originalColor:'#000000'})});
    const record=await response.json();if(!response.ok)throw Error(record.error||'多包材生成失败');generationSubmitting=false;generationWatcher.track(record);
    return;
  }
  generationSubmitting=false;if(!options.onlyProductId)multiProductResults=new Map();renderMultiProductResults();updateGenerateButton();
  const products=multiPackageProducts.filter(product=>plans.find(plan=>plan.productId===product.id)?.selectedVersions.length).map(product=>({...product}));
  multiProductJob={kind:'multi-product',status:'running',outputs:[],stages:Object.fromEntries(products.flatMap(product=>plans.find(plan=>plan.productId===product.id).selectedVersions.map(version=>[`${product.id}:${version}`,{stage:'queued'}])))};
  restoreMultiProductGeneration(multiProductJob);
  try{
    const response=await fetch('/api/ai-render-multi',{method:'POST',headers:{'content-type':'application/json','accept':'text/event-stream'},body:JSON.stringify({...options,productIds:multiPackageProducts.map(product=>product.id),productLayouts,logoImage:logoData,model:mockupModel.value,originalColor:'#000000'})});
    if(!response.ok||!response.headers.get('content-type')?.includes('text/event-stream')){const payload=await response.json();throw Error(payload.error||'多包材生成失败');}
    await readProgressStream(response,async(event,data)=>{
      if(event==='product-error'){multiProductResults.set(data.product.id,{error:data.error});for(const version of plans.find(plan=>plan.productId===data.product.id).selectedVersions)multiProductJob.stages[`${data.product.id}:${version}`]={stage:'failed',error:data.error};}
      else if(event==='product-done'){
        multiProductResults.set(data.product.id,data);
        for(const version of plans.find(plan=>plan.productId===data.product.id).selectedVersions){const image=data.images.find(image=>image.label===`${data.product.sku} · ${version}`);if(image){multiProductJob.outputs.push({productId:data.product.id,version,dataUrl:image.url||image.dataUrl});multiProductJob.stages[`${data.product.id}:${version}`]={stage:'complete'};}else multiProductJob.stages[`${data.product.id}:${version}`]={stage:'failed',error:data.failures?.find(failure=>failure.version===version)?.error||'未返回图片'};}
      }
      else if(event==='stage')multiProductJob.stages[`${data.product.id}:${data.version}`]={stage:data.stage,error:data.error};
      restoreMultiProductGeneration(multiProductJob);
      if(event==='stage'&&data.product.id===selectedMultiProductId)setStatus(`${data.product.sku} · ${data.version}：${({submitting:'提交中',generating:'生成中',saving:'保存中',failed:'失败'})[data.stage]||data.stage}`,'busy');
      if(event==='product-error'||event==='product-done')renderMultiProductResults();
    });
    const failed=products.filter(product=>!multiProductResults.get(product.id)?.complete);
    const firstFailure=failed.length?multiProductResults.get(failed[0].id):null;
    setStatus(failed.length?`${failed.length}/${products.length} 个产品未全部生成成功：${firstFailure?.error||firstFailure?.failures?.[0]?.error||'所选效果未全部返回'}。成功图片已保留。`:'所选产品的所选效果已生成。',failed.length?'error':'success');
    if(s7User)await refreshHistory();
  }catch(error){multiProductResults.set(selectedMultiProductId,{error:error.message||'多包材生成失败'});setStatus(error.message||'多包材生成失败','error');}
  finally{multiPackageBusy=false;multiProductJob.status=Object.values(multiProductJob.stages).every(value=>value.stage==='complete')?'complete':'partial';for(const [key,value]of Object.entries(multiProductJob.stages))if(!['complete','failed'].includes(value.stage))multiProductJob.stages[key]={stage:'failed',error:'生成连接中断，请重试'};restoreMultiProductGeneration(multiProductJob);}
  }catch(error){multiPackageBusy=false;failGenerationSubmission(currentVersions,error);}
  finally{generationSubmitting=false;updateGenerateButton();}
}
document.querySelector('#generate').onclick=()=>taskLogos.length>1?runMultiLogoGeneration():multiPackageProducts.length>1?runMultiPackageGeneration():runGeneration(selectedGenerationVersions());
document.querySelector('#apply-product-preset').onclick=openProductPresetScope;
document.querySelector('#generate-modified').onclick=()=>taskLogos.length>1?runMultiLogoGeneration({onlyLogoId:loadedTaskLogoId,selectedVersions:modifiedSchemes()}):multiPackageProducts.length>1?runMultiPackageGeneration({onlyProductId:loadedMultiProductId,selectedVersions:modifiedSchemes()}):runGeneration(modifiedSchemes());
renderMultiProductResults();
mockupModel.addEventListener('change',()=>{queueSchemeCards();taskDraft?.schedule();});
createSchemeCards();updateGenerateButton();

addTarget({id:'product',x:.5,y:.5,widthRatio:.2,rotation:0,curve:0,surface:'free'});
await loadMockupModels();
try{const response=await fetch('/api/features');multiLogoEnabled=response.ok&&(await response.json()).multiLogo===true;}catch{}
if(currentTaskId&&s7User){
 taskDraft=createTaskDraft({id:currentTaskId,
  request:async(url,data,method='GET')=>{const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});const value=await response.json();if(!response.ok)throw Error(value.error||'任务保存失败');return value;},
  capture:()=>{const multiLogoLayouts=captureMultiLogoLayouts(),multiProductLayouts=captureMultiProductLayouts(),baseAssetUrl=multiProductViews.get(loadedMultiProductId)?.baseAssetUrl||'';return {mixedVersions:versionInputs.map(input=>input.value).filter(isMixedVersion),foilRegions:readFoilRegions(),mode:'ordinary',taskLogos,multiLogoLayouts,selectedTaskLogoId,schemeState,activeScheme,placementScope,savedSignatures,dismissedGenerationId,downloadSelection,selectedVersions:selectedGenerationVersions(),baseData:baseAssetUrl?'':baseData,baseProductId:loadedMultiProductId,logoData:taskLogos.length?'':logoData,logoSourceData:taskLogos.length?'':logoSourceData,baseDataUrl:baseAssetUrl||(baseData?'':baseImage?.src||''),logoDataUrl:taskLogos.length||logoData?'':logoImage?.src||'',targets:collectTargets(),selectedTargetId,model:mockupModel.value,baseName:document.querySelector('#base-name').textContent,logoName:document.querySelector('#logo-name').textContent,result:multiPackageProducts.length>1||taskLogos.length>1?null:lastResultPayload,multiPackageProducts,multiProductLayouts,selectedMultiProductId};},
  onSaved:record=>{const busy=status.classList.contains('busy');notifyTask(busy?'生成中…':'已保存',busy,record.updatedAt,record.title);},onError:error=>{status.textContent=error.message;status.className='status error';notifyTask('保存失败');}});
 try{
  const state=await taskDraft.load();
  restoreMixedVersions(state);
  taskLogos=Array.isArray(state.taskLogos)?state.taskLogos:Array.isArray(state.logos)?state.logos:[];
  if(!taskLogos.length&&state.logoData)taskLogos=[{id:crypto.randomUUID(),name:state.logoName||'已恢复 Logo',logoImage:state.logoData,sourceData:state.logoSourceData||''}];
  selectedTaskLogoId=taskLogos.some(logo=>logo.id===state.selectedTaskLogoId)?state.selectedTaskLogoId:taskLogos[0]?.id||null;
  loadedTaskLogoId=selectedTaskLogoId;
  if(Array.isArray(state.multiLogoLayouts))multiLogoViews=new Map(state.multiLogoLayouts.map(layout=>[layout.logoId,{...layout,...(layout.schemeState?{schemeState:ensureCustomScheme(layout.schemeState)}:{})}]));
  if(state.mode==='multi-logo'&&state.productId&&!state.multiPackageProducts?.length){const response=await fetch('/api/product-library');if(!response.ok)throw Error('产品库读取失败');const products=await response.json();const product=products.find(product=>product.id===state.productId);if(product)state.multiPackageProducts=[product];}
  const restoredLogo=taskLogos.find(logo=>logo.id===selectedTaskLogoId);
  if(restoredLogo){state.logoData=restoredLogo.logoImage;state.logoSourceData=restoredLogo.sourceData||'';state.logoName=restoredLogo.name;}

  downloadSelection=state.downloadSelection||{};
  dismissedGenerationId=state.dismissedGenerationId||null;
  if(Array.isArray(state.foilRegions))for(const input of document.querySelectorAll('[data-foil-region]'))input.checked=state.foilRegions.includes(input.dataset.foilRegion);
  if(Array.isArray(state.selectedVersions)){for(const input of versionInputs)input.checked=state.selectedVersions.includes(input.value);updateGenerateButton();}
  baseData=state.baseData||'';logoData=state.logoData||'';logoSourceData=state.logoSourceData||'';
  multiPackageProducts=Array.isArray(state.multiPackageProducts)?state.multiPackageProducts.filter(product=>product&&typeof product.id==='string'&&typeof product.sku==='string'&&typeof product.name==='string'):[];renderMultiProductResults();
  if(Array.isArray(state.multiProductLayouts))multiProductViews=new Map(state.multiProductLayouts.filter(layout=>layout?.schemeState?.schemes?.length).map(layout=>[layout.productId,{...layout,schemeState:ensureCustomScheme(layout.schemeState),selectedVersions:layout.selectedVersions||state.selectedVersions||['ORIGINAL','BLACK']}]));
  const restoredProduct=multiPackageProducts.find(product=>state.selectedMultiProductId?product.id===state.selectedMultiProductId:state.baseName===`产品库：${product.sku} · ${product.name}`);
  if(restoredProduct)selectedMultiProductId=restoredProduct.id;
  const restoredBase=restoredBaseProduct(state,multiPackageProducts);
  if(restoredBase&&!multiProductViews.has(restoredBase.id)&&state.schemeState?.schemes?.length)multiProductViews.set(restoredBase.id,{selectedVersions:state.selectedVersions||['ORIGINAL','BLACK'],targets:state.targets,schemeState:state.schemeState,activeScheme:state.activeScheme||'ORIGINAL',placementScope:state.placementScope||'shared',selectedTargetId:state.selectedTargetId});
  const baseUrl=state.baseData?`data:image/png;base64,${state.baseData}`:state.baseDataUrl,logoUrl=state.logoData?`data:image/png;base64,${state.logoData}`:state.logoDataUrl;
  const baseAssetUrl=!state.baseData&&baseUrl?.startsWith(`/api/my-space/tasks/${currentTaskId}/assets/`)?baseUrl:'';
  if(baseAssetUrl){const response=await fetch(`${baseAssetUrl}?preview=1`);if(!response.ok)throw Error('任务产品快照读取失败，请重试');const loaded=await fileData(await response.blob());baseData=loaded.data;baseImage=await loadImage(loaded.dataUrl);}
  else baseImage=baseUrl?await loadImage(baseUrl):null;
  logoImage=logoUrl?await loadImage(logoUrl):null;
  if(restoredBase&&baseImage){multiProductViews.set(restoredBase.id,{...multiProductViews.get(restoredBase.id),baseData,baseImage,baseAssetUrl});loadedMultiProductId=restoredBase.id;}
  if(state.schemeState?.schemes?.length){schemeState=state.schemeState;activeScheme=state.activeScheme||'ORIGINAL';placementScope=state.placementScope||'shared';savedSignatures=state.savedSignatures||{};document.querySelector('#preview-version').value=activeScheme;selectedTargetId=state.selectedTargetId;loadSchemeTargets();}
  else if(state.targets?.length){schemeState=null;rebuildingTargets=true;targets.replaceChildren();targetNumber=0;state.targets.forEach(addTarget);rebuildingTargets=false;selectedTargetId=state.selectedTargetId||state.targets[0].id;}
  for(const [id,key]of [['base-name','baseName'],['logo-name','logoName']])if(state[key])document.querySelector('#'+id).textContent=state[key];
  if(logoUrl)setSelectedLogoPreview(logoUrl,state.logoName||'已恢复 Logo');
  if([...mockupModel.options].some(option=>option.value===state.model))mockupModel.value=state.model;
  refreshTargetSelection();drawPreview();if(state.result)renderResults(state.result);
  taskDraft.activate();notifyTask('已恢复');
  generationWatcher=createGenerationWatcher({
   request:async()=>{const response=await fetch(`/api/my-space/tasks/${currentTaskId}/generation`);const record=await response.json();if(!response.ok)throw Object.assign(Error(record.error||'生成进度读取失败'),{status:response.status});return record;},
   onChange:record=>{restoreGeneration(record);if(record.status!=='running')refreshHistory().catch(()=>{});},
   onError:error=>{if(!generationSubmitting&&error.status!==401)setStatus('进度暂时无法读取，后台生成会继续；稍后自动重连。','error');}
  });
  await generationWatcher.refresh();
  if(!taskActive)generationWatcher.setActive(false);
  window.addEventListener('pagehide',()=>{generationWatcher.stop();fullImagePreview.close();previewImages.clear();});
  document.addEventListener('input',()=>taskDraft.schedule());document.addEventListener('change',()=>taskDraft.schedule());
  window.addEventListener('beforeunload',event=>{if(taskDraft.isDirty()){event.preventDefault();event.returnValue='';}});
 }catch(error){setStatus(error.message,'error');document.querySelector('#generate').disabled=true;}
}else await restoreSavedLogo();
if(multiPackageProducts.length){try{await showMultiProduct(selectedMultiProductId||multiPackageProducts[0].id);await Promise.all(multiPackageProducts.map(product=>loadMultiProductView(product)));updateGenerateButton();}catch(error){setStatus(error.message,'error');}}
const restoredLogoView=multiLogoViews.get(selectedTaskLogoId);
if(restoredLogoView?.schemeState){schemeState=structuredClone(restoredLogoView.schemeState);activeScheme=restoredLogoView.activeScheme||'ORIGINAL';placementScope=restoredLogoView.placementScope||'shared';selectedTargetId=restoredLogoView.selectedTargetId;savedSignatures={...restoredLogoView.savedSignatures};document.querySelector('#preview-version').value=activeScheme;loadSchemeTargets();}
if(multiLogoJob)restoreMultiLogoGeneration(multiLogoJob);
downloadSelectionReady=true;updateDownloadSelection();queueSchemeCards();
refreshHistory().catch(error=>setStatus(error.message,'error'));
