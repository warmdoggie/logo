const $=selector=>document.querySelector(selector);
const labels={uploaded:'待自动去字',queued:'等待处理',detecting:'正在识别占位字',ready:'待去字',removing:'正在修补',done:'已完成',review:'待核对 / 可补框',error:'处理失败 / 可重试'};
let batches=[],batch=null,selectedId=null,image=null,imageKey='',selectedRegion=-1,drag=null,working=false,timer=null,batchVersion=0,selectedIds=new Set();
const current=()=>batch?.items.find(item=>item.id===selectedId);
const selectedPending=()=>batch?.items.filter(item=>selectedIds.has(item.id)&&item.status!=='done')||[];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const base=()=>`./api/batches/${batch.id}`;
const imageUrl=(item,kind)=>`${base()}/images/${item.id}/${kind}`;
const report=error=>{$('#error').textContent=error?.message||String(error);$('#error').hidden=false;};
async function api(path,options={}){const response=await fetch(path,{...options,headers:{...(options.body&&!(options.body instanceof FormData)?{'Content-Type':'application/json'}:{}),...options.headers}});const data=await response.json();if(!response.ok)throw Error(data.error||'请求失败');return data;}
function link(node,url,enabled){node.setAttribute('aria-disabled',String(!enabled));if(enabled)node.href=url;else node.removeAttribute('href');}
function show(){
  const item=current(),locked=working||batch?.busy,pending=selectedPending();
  $('#batches').innerHTML=batches.length?batches.map(value=>`<option value="${value.id}">${esc(new Date(value.createdAt).toLocaleString('zh-CN'))} · ${value.items.length} 张</option>`).join(''):'<option value="">暂无批次</option>';
  $('#batches').value=batch?.id||'';
  $('#new-batch').disabled=working;$('#batches').disabled=working;
  $('#files').disabled=!!locked;
  $('#auto').disabled=!!locked||!pending.length;$('#auto').textContent=`一键自动去字${pending.length?`（${pending.length} 张）`:''}`;
  $('#detect').disabled=!!locked||!pending.some(value=>!value.regions.length);
  $('#remove').disabled=!!locked||!pending.some(value=>value.regions.length);
  const count=status=>batch?.items.filter(value=>status.includes(value.status)).length||0;
  const done=count(['done']),failed=count(['error']),review=count(['review']),active=count(['detecting','removing']),queued=count(['queued']),total=batch?.items.length||0;
  $('#summary').textContent=`本批 ${total} 张 · 已完成 ${done} 张 · 已选待处理 ${pending.length} 张${active?` · 处理中 ${active} 张`:''}${queued?` · 排队 ${queued} 张`:''}${review?` · 待核对 ${review} 张`:''}${failed?` · 失败 ${failed} 张`:''}${batch?.busy?' · 后台处理中，刷新页面后可继续查看':''}${working?' · 正在提交…':''}`;
  link($('#download'),batch?base()+'/download':'',done>0);
  $('#dropzone').hidden=total>0;$('#workspace').hidden=!total;
  const queue=$('#queue');
  if(queue.dataset.state!==JSON.stringify([batch?.id,selectedId,batch?.items.map(value=>[value.id,value.status,value.regions.length])])){
    queue.dataset.state=JSON.stringify([batch?.id,selectedId,batch?.items.map(value=>[value.id,value.status,value.regions.length])]);
    queue.innerHTML=(batch?.items||[]).map(value=>`<div class="queue-row"><input type="checkbox" data-select="${value.id}" aria-label="选择 ${esc(value.name)}"><button class="queue-item ${value.id===selectedId?'active':''}" data-id="${value.id}" data-status="${value.status}" aria-pressed="${value.id===selectedId}"><img src="${imageUrl(value,'original')}?thumbnail=1" alt=""><span><strong>${esc(value.name)}</strong><small>${labels[value.status]}${value.regions.length?` · ${value.regions.length} 处`:''}</small></span></button></div>`).join('');
    queue.querySelectorAll('[data-id]').forEach(button=>button.onclick=()=>{selectedId=button.dataset.id;selectedRegion=-1;show();});
    queue.querySelectorAll('[data-select]').forEach(input=>input.onchange=()=>{if(input.checked)selectedIds.add(input.dataset.select);else selectedIds.delete(input.dataset.select);show();});
  }
  queue.querySelectorAll('[data-select]').forEach(input=>{const value=batch.items.find(value=>value.id===input.dataset.select);input.checked=value.status!=='done'&&selectedIds.has(value.id);input.disabled=!!locked||value.status==='done';});
  const unfinished=batch?.items.filter(value=>value.status!=='done')||[];
  $('#select-all').disabled=!!locked||!unfinished.length;$('#select-all').checked=!!unfinished.length&&pending.length===unfinished.length;$('#select-all').indeterminate=pending.length>0&&pending.length<unfinished.length;
  for(const selector of ['#clear-regions','#delete-region','#detect-one','#remove-one'])$(selector).disabled=!!locked||!item;
  $('#delete-region').disabled=!!locked||!item||selectedRegion<0;
  $('#remove-one').disabled=!!locked||!item?.regions.length;
  if(!item)return;
  $('#selected-name').textContent=item.name;$('#dimensions').textContent=`${item.width} × ${item.height} px · ${item.regions.length} 处去字区域`;
  $('#item-message').textContent=item.error||'';
  $('#result').hidden=item.status!=='done';$('#result-empty').hidden=item.status==='done';
  if(item.status==='done'){
    const src=imageUrl(item,'result')+'?v='+encodeURIComponent(batch.updatedAt);
    if($('#result').dataset.key!==src){$('#result').dataset.key=src;$('#result').src=src;}
  }
  link($('#download-one'),imageUrl(item,'result'),item.status==='done');$('#download-one').download=item.name.replace(/\.[^.]+$/,'')+'_clean.png';
  const key=imageUrl(item,'original');
  if(imageKey!==key){
    imageKey=key;image=null;const next=new Image();
    next.onload=()=>{if(imageKey!==key)return;image=next;$('#canvas').width=next.naturalWidth;$('#canvas').height=next.naturalHeight;draw();};next.onerror=()=>report(Error('原图加载失败，请刷新重试'));next.src=key;
  }
  draw();
}
function draw(){
  const canvas=$('#canvas'),context=canvas.getContext('2d'),item=current();
  context.clearRect(0,0,canvas.width,canvas.height);if(!image||!item)return;
  context.drawImage(image,0,0);const scale=canvas.width/Math.max(canvas.clientWidth,1);
  item.regions.forEach((region,index)=>{
    context.strokeStyle=index===selectedRegion?'#254bd8':'#bf4c12';context.lineWidth=2*scale;context.fillStyle=index===selectedRegion?'#254bd822':'#bf4c1218';
    context.fillRect(region.x*canvas.width,region.y*canvas.height,region.width*canvas.width,region.height*canvas.height);context.strokeRect(region.x*canvas.width,region.y*canvas.height,region.width*canvas.width,region.height*canvas.height);
    if(index===selectedRegion){context.fillStyle='#254bd8';context.fillRect((region.x+region.width)*canvas.width-4*scale,(region.y+region.height)*canvas.height-4*scale,8*scale,8*scale);}
  });
}
function polling(){clearTimeout(timer);if(!batch?.busy)return;const version=batchVersion,url=base();timer=setTimeout(async()=>{try{const value=await api(url);if(version!==batchVersion||working||drag)return;batch=value;remember();show();polling();}catch(error){if(version!==batchVersion)return;report(error);timer=setTimeout(polling,2500);}},1500);}
function remember(){if(!batch)return;const index=batches.findIndex(value=>value.id===batch.id);if(index<0)batches.unshift(batch);else batches[index]=batch;localStorage.setItem('logo-cleanup-batch',batch.id);}
async function selectBatch(value){batchVersion++;clearTimeout(timer);batch=value;selectedIds=new Set(batch?.items.filter(item=>item.status!=='done').map(item=>item.id));selectedId=batch?.items[0]?.id||null;imageKey='';selectedRegion=-1;remember();show();polling();}
async function create(){const value=await api('./api/batches',{method:'POST'});await selectBatch(value);}
async function act(fn){if(working)return;working=true;clearTimeout(timer);$('#error').hidden=true;show();try{await fn();}catch(error){report(error);}finally{working=false;show();polling();}}
async function run(operation,ids){await act(async()=>{batch=await api(base()+'/'+operation,{method:'POST',body:JSON.stringify(ids?{ids}: {})});remember();});}
async function upload(files){
  await act(async()=>{
    if(!batch)await create();if(batch.busy)throw Error('本批正在处理，请新建批次后添加图片');
    const errors=[];
    for(const file of files){
      try{const previous=new Set(batch.items.map(item=>item.id)),form=new FormData();form.set('file',file);batch=await api(base()+'/images',{method:'POST',body:form});for(const item of batch.items)if(!previous.has(item.id))selectedIds.add(item.id);selectedId||=batch.items[0]?.id;remember();show();}
      catch(error){errors.push(file.name+'：'+error.message);}
    }
    if(errors.length)report(Error(errors.join('；')));
  });
}
$('#new-batch').onclick=()=>act(create);
$('#batches').onchange=event=>act(async()=>selectBatch(await api('./api/batches/'+event.target.value)));
$('#files').onchange=event=>{const files=[...event.target.files];event.target.value='';upload(files);};
$('#auto').onclick=()=>run('auto',selectedPending().map(item=>item.id));
$('#detect').onclick=()=>run('detect',selectedPending().filter(item=>!item.regions.length).map(item=>item.id));$('#remove').onclick=()=>run('remove',selectedPending().filter(item=>item.regions.length).map(item=>item.id));
$('#select-all').onchange=event=>{selectedIds=new Set(event.target.checked?batch.items.filter(item=>item.status!=='done').map(item=>item.id):[]);show();};
$('#detect-one').onclick=()=>run('detect',[selectedId]);$('#remove-one').onclick=()=>run('remove',[selectedId]);
async function saveRegions(regions){await act(async()=>{batch=await api(base()+'/images/'+selectedId,{method:'PATCH',body:JSON.stringify({regions})});remember();});}
$('#clear-regions').onclick=()=>{selectedRegion=-1;saveRegions([]);};
function removeSelected(){if(selectedRegion<0||working||batch?.busy)return;const regions=current().regions.filter((_,index)=>index!==selectedRegion);selectedRegion=-1;saveRegions(regions);}
$('#delete-region').onclick=removeSelected;
$('#canvas').onkeydown=event=>{if(['Delete','Backspace'].includes(event.key)){event.preventDefault();removeSelected();}};
const point=event=>{const rect=$('#canvas').getBoundingClientRect();return {x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};};
$('#canvas').onpointerdown=event=>{
  if(working||batch?.busy||!current()||!image)return;
  const p=point(event),regions=current().regions,index=regions.findLastIndex(region=>p.x>=region.x&&p.x<=region.x+region.width&&p.y>=region.y&&p.y<=region.y+region.height);
  drag={start:p,previous:structuredClone(regions),index,mode:'new'};
  if(index>=0){const region=regions[index],rect=$('#canvas').getBoundingClientRect();drag.mode=Math.hypot((p.x-region.x-region.width)*rect.width,(p.y-region.y-region.height)*rect.height)<14?'resize':'move';drag.region={...region};selectedRegion=index;}
  else{selectedRegion=regions.length;regions.push({x:p.x,y:p.y,width:0,height:0,text:''});}
  $('#canvas').setPointerCapture(event.pointerId);event.preventDefault();draw();
};
$('#canvas').onpointermove=event=>{
  if(!drag)return;const p=point(event),dx=p.x-drag.start.x,dy=p.y-drag.start.y;
  let region;
  if(drag.mode==='new')region={x:Math.min(p.x,drag.start.x),y:Math.min(p.y,drag.start.y),width:Math.abs(dx),height:Math.abs(dy),text:''};
  else if(drag.mode==='move')region={...drag.region,x:Math.max(0,Math.min(1-drag.region.width,drag.region.x+dx)),y:Math.max(0,Math.min(1-drag.region.height,drag.region.y+dy))};
  else region={...drag.region,width:Math.max(.001,Math.min(1-drag.region.x,drag.region.width+dx)),height:Math.max(.001,Math.min(1-drag.region.y,drag.region.height+dy))};
  current().regions[selectedRegion]=region;draw();
};
$('#canvas').onpointerup=async()=>{
  if(!drag)return;const previous=drag.previous,regions=structuredClone(current().regions);drag=null;
  current().regions=previous;
  if(regions.some(region=>region.width<.001||region.height<.001)){selectedRegion=-1;show();return;}
  await saveRegions(regions);
};
$('#canvas').onpointercancel=()=>{if(drag){current().regions=drag.previous;drag=null;selectedRegion=-1;show();}};
document.body.ondragover=event=>{event.preventDefault();$('#dropzone').classList.add('dragover');};
document.body.ondragleave=()=>$('#dropzone').classList.remove('dragover');
document.body.ondrop=event=>{event.preventDefault();$('#dropzone').classList.remove('dragover');upload([...event.dataTransfer.files]);};
window.addEventListener('resize',draw);
try{batches=await api('./api/batches');await selectBatch(batches.find(value=>value.id===localStorage.getItem('logo-cleanup-batch'))||batches[0]||null);const status=await api('./api/status');if(!status.configured)report(Error('AI 修补接口尚未配置；仍可上传图片并框选区域。'));}catch(error){report(error);$('#summary').textContent='读取失败，请刷新重试';}
