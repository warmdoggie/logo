import {createTaskDraft} from './task-draft.mjs';
import {createGenerationWatcher} from './generation-client.mjs';
import {masterTargetsFromTemplate} from './product-master.mjs';
import {generationVersions as versions} from './generation-versions.mjs';
import {bindLogoImageTransfer} from './logo-image-transfer.mjs';

const base=location.pathname.startsWith('/s7/')?'/s7':'',path=value=>value.startsWith('/api/')?base+value:value;
const $=id=>document.getElementById(id),taskId=new URLSearchParams(location.search).get('task');
const names={ORIGINAL:'原色印刷',BLACK:'黑白印刷','GOLD FOIL':'烫金搭配','SILVER FOIL':'烫银搭配',CUSTOM:'自定义配色'};
const stageNames={queued:'等待中',submitting:'提交中',generating:'生成中',saving:'保存中',complete:'已保存',failed:'失败'};
let logos=[],library=[],draft,watcher,job=null,enabled=false,ready=false,processing=false,masterReady=false,masterRequest=0;
async function api(url,data,method=data?'POST':'GET'){
 const response=await fetch(path(url),{method,headers:{'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error||'操作失败'),{status:response.status});return value;
}
function notify(text){window.parent.postMessage({type:'s7-task-status',taskId,text,busy:job?.status==='running'},location.origin);}
function status(text,error=false){$('status').textContent=text;$('status').dataset.error=String(error);notify(text);}
function controls(){const busy=job?.status==='running'||processing;$('materials').disabled=!enabled||!ready||busy;$('generate').disabled=!enabled||!ready||busy||!masterReady||logos.length<2||!$('model').value;$('generate').textContent=`生成 ${logos.length} 个 Logo · 共 ${logos.length*4} 张`;$('retry').hidden=!job||job.status==='complete';$('retry').disabled=!enabled||!ready||busy||!masterReady;}
const save=()=>draft?.schedule();
function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function readFile(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('无法读取文件'));reader.readAsDataURL(file);});}
async function loadLibraryImage(url){const response=await fetch(path(url));if(!response.ok)throw Error('Logo 图片无法读取');return readFile(await response.blob());}
function addLogo(name,logoImage){if(logos.length>=20)throw Error('每个任务最多添加 20 个 Logo');logos.push({id:crypto.randomUUID(),name:name.slice(0,120),logoImage});renderLogos();save();controls();}
function renderLogos(){
 $('logos').replaceChildren();
 for(const logo of logos){
  const row=element('div',undefined,'logo-item'),heading=element('div',undefined,'logo-heading'),image=element('img');image.src='data:image/png;base64,'+logo.logoImage;image.alt=logo.name;heading.append(image,element('strong',logo.name));
  const actions=element('div',undefined,'logo-actions'),color=element('select');color.setAttribute('aria-label',`${logo.name} 加工颜色`);color.append(new Option('保留原色','original'),new Option('转换黑色','#000000'));
  const process=element('button','AI 加工透明底');process.type='button';process.onclick=async()=>{processing=true;controls();status(`正在加工 ${logo.name}…`);try{await draft.flush();const output=await api('/api/ai-process-logo',{taskId,logoImage:logo.logoImage,targetColor:color.value});logo.logoImage=output.dataUrl.split(',')[1];renderLogos();save();await draft.flush();status(output.logoLibraryError?`Logo 已加工；Logo 库保存失败：${output.logoLibraryError}`:`${logo.name} 已加工为透明底`);}catch(error){status(error.message,true);}finally{processing=false;controls();}};
  const remove=element('button','移除');remove.type='button';remove.onclick=()=>{logos=logos.filter(item=>item!==logo);renderLogos();save();controls();};actions.append(color,process,remove);row.append(heading,actions);$('logos').append(row);
 }
}
function renderLibrary(){
 const query=$('logo-search').value.trim().toLowerCase();$('logo-library').replaceChildren();
 for(const logo of library.filter(item=>String(item.name).toLowerCase().includes(query))){const button=element('button');button.type='button';const image=element('img');image.src=path(logo.imageUrl);image.alt='';image.loading='lazy';button.append(image,element('span',logo.name));button.onclick=async()=>{processing=true;controls();try{addLogo(logo.name,await loadLibraryImage(logo.imageUrl));}catch(error){status(error.message,true);}finally{processing=false;controls();}};$('logo-library').append(button);}
 if(!$('logo-library').children.length)$('logo-library').append(element('p','没有匹配的 Logo','hint'));
}
async function selectProduct(){
 const request=++masterRequest,id=$('product').value;masterReady=false;controls();$('product-preview').hidden=!id;
 if(!id){$('master-status').textContent='请选择产品';return;}
 $('product-preview').src=path('/api/product-library/image/'+encodeURIComponent(id));$('master-status').textContent='正在检查已发布母版…';
 try{const master=await api('/api/product-library/template/'+encodeURIComponent(id));if(request!==masterRequest)return;const targets=masterTargetsFromTemplate(master.template);masterReady=!master.needsTemplateReview&&targets.length>0;$('master-status').textContent=master.needsTemplateReview?'标准图已变更，请重新确认并发布母版。':targets.length?`已加载 ${targets.length} 个母版位置；每个 Logo 会独立应用到这些位置。`:'请先在产品母版中设置 Logo 区域并发布。';}catch(error){if(request===masterRequest)$('master-status').textContent=error.message;}
 controls();
}
function showImage(url){$('large-image').src=path(url);$('preview').showModal();}
function renderJob(record){
 job=record;if(!record){controls();return;}
 $('results').replaceChildren();
 for(const logo of record.logos){
  const group=element('section',undefined,'result-group'),heading=element('h3',logo.name),count=record.outputs.filter(output=>output.logoId===logo.id).length;heading.append(element('small',`${count}/4 张`));group.append(heading);const cards=element('div',undefined,'cards');
  for(const version of versions){const stage=record.stages[`${logo.id}:${version}`],output=record.outputs.find(item=>item.logoId===logo.id&&item.version===version),card=element('article',undefined,'card'),title=element('div',undefined,'card-title');title.append(element('strong',names[version]),element('small',stageNames[stage?.stage]||'等待中'));card.append(title);
   if(output){const image=element('img');image.src=path(output.dataUrl);image.alt=`${logo.name} · ${names[version]}`;image.loading='lazy';image.onclick=()=>showImage(output.dataUrl);const download=element('a','下载 PNG');download.href=path(output.dataUrl);download.download=`${record.product.sku}-${logo.name}-${version}.png`;card.append(image,download);}else card.append(element('div',stage?.stage==='failed'?'生成失败':'等待成图', 'placeholder'));
   if(stage?.error)card.append(element('p',stage.error));cards.append(card);
  }group.append(cards);$('results').append(group);
 }
 const total=record.logos.length*4;$('progress').textContent=`${record.product.sku} · ${record.outputs.length}/${total} 张已保存`;
 status(record.status==='running'?(record.providerActivationPending?'任务已排队，等待启用生成':`后台生成中 · 已保存 ${record.outputs.length}/${total} 张，可切换任务或刷新页面。`):record.status==='complete'?`已完成：${record.logos.length} 个 Logo，共 ${record.outputs.length} 张效果图。`:`已保存 ${record.outputs.length}/${total} 张，未完成图片可单独重试。`,['partial','failed','interrupted'].includes(record.status));controls();
}
async function refreshHistory(){const records=await api('/api/my-space/history?taskId='+encodeURIComponent(taskId));$('history').replaceChildren();for(const record of records.filter(record=>record.kind==='多 Logo 印刷效果'))for(const image of record.images){const link=element('a',`${new Date(record.createdAt).toLocaleString()} · ${image.label}`);link.href=path(image.url);link.download=image.label+'.png';$('history').append(link);}}
async function generate(retryFailed=false){
 processing=true;controls();
 try{await draft.flush();const record=await api('/api/ai-render-logos',{taskId,productId:$('product').value,model:$('model').value,logos,retryFailed});watcher.track(record);}catch(error){status(error.message,true);}finally{processing=false;controls();}
}
async function importLogoFiles(files){if(!enabled||!ready||processing||job?.status==='running')return;processing=true;controls();try{for(const file of files)addLogo(file.name||'粘贴的 Logo.png',await readFile(file));}catch(error){status(error.message,true);}finally{processing=false;controls();}}
$('uploads').onchange=async event=>{try{await importLogoFiles([...event.target.files]);}finally{event.target.value='';}};
bindLogoImageTransfer({dropzone:$('logo-dropzone'),onFiles:importLogoFiles});
$('logo-search').oninput=renderLibrary;$('product').onchange=()=>{save();selectProduct();};$('model').onchange=save;
$('generate').onclick=()=>generate();$('retry').onclick=()=>generate(true);$('close-preview').onclick=()=>$('preview').close();$('history-panel').ontoggle=()=>{if($('history-panel').open)refreshHistory().catch(error=>status(error.message,true));};
$('back').hidden=window.parent!==window;
try{
 const session=await api('/api/session');if(!session.user)throw Error('请先登录主工作空间，再从任务栏新建多 Logo 上样任务。');if(!taskId)throw Error('请从任务栏点击“新建多 Logo 上样”。');
 const features=await api('/api/features');enabled=features.multiLogo===true;
 draft=createTaskDraft({id:taskId,request:api,capture:()=>({mode:'multi-logo',productId:$('product').value,model:$('model').value,logos}),onError:error=>status('保存失败：'+error.message,true)});
 const state=await draft.load();if(state.mode!=='multi-logo')throw Error('此任务为原有上样任务，请从任务列表打开。');
 logos=state.logos||[];renderLogos();
 const products=await api('/api/product-library');for(const product of products)$('product').append(new Option(`${product.sku} · ${product.name}`,product.id));$('product').value=state.productId||'';
 $('model').replaceChildren(new Option('本地合成','local'));$('model').value='local';$('model').disabled=true;
 await selectProduct();draft.activate();ready=true;controls();
 watcher=createGenerationWatcher({request:()=>api(`/api/my-space/tasks/${taskId}/generation`),onChange:renderJob,onError:error=>{status('进度暂时无法读取：'+error.message,true);if(error.status===401){ready=false;controls();}}});await watcher.refresh();
 if(!job)status(enabled?'选择一个产品并添加多个 Logo。':'多 Logo 生成功能已关闭，已有结果仍可查看。');
 api('/api/logo-library').then(value=>{library=value;renderLibrary();}).catch(error=>{$('logo-library').textContent=error.message;});
 window.addEventListener('pagehide',()=>watcher.stop());window.addEventListener('beforeunload',event=>{if(draft.isDirty()){event.preventDefault();event.returnValue='';}});
}catch(error){status(error.message,true);ready=false;controls();}
