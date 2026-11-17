const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,value){const r=await fetch(path,value===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const d=await r.json();if(!r.ok)throw Error(d.error||'处理失败');return d;}
export async function renderLogoBackground(main,taskId,h){
 main.innerHTML='<a class="back" href="#/tasks/'+encodeURIComponent(taskId)+'/automatic">← 返回做图工作区</a><div class="heading"><div><h1>Logo 背景处理</h1><p>查看原图、处理结果与具体原因。完成处理后返回工作区，点击“开始做图”。</p></div></div>';
 await mountTransparent(main,taskId,{...h,reload:()=>renderLogoBackground(main,taskId,h)});
}
export async function mountTransparent(main,taskId,h){
 if(!document.querySelector('#transparent-style')){const link=document.createElement('link');link.id='transparent-style';link.rel='stylesheet';link.href='/transparent.css';document.head.append(link);}
 const base='/api/transparent/'+encodeURIComponent(taskId),d=await api(base);if(!h.isCurrent())return;
 const panel=document.createElement('section');panel.className='panel rule-panel';panel.id='transparent-panel';
 const labels={READY:'可使用',REVIEW_REQUIRED:'等待设计师复核',DESIGNER_REQUIRED:'需要设计师处理'};
 const methods={KEEP_ALPHA:'保留原有透明背景',SOLID_INK_MATTE:'已自动去除纯色背景与字母内孔底色，保留 Logo 原色及细线',FLAT_COLOR_MATTE:'已自动去除均匀背景，保留文字、各颜色图案及细边缘',EDGE_CONNECTED_SOLID:'已分离边缘连通底色，请检查文字和图形是否完整'};
 const renderMaster=m=>{
  const s=d.sources.find(s=>s.id===m.sourceId),review=['ADMIN','DESIGNER'].includes(d.actor.role)&&m.status==='REVIEW_REQUIRED'&&!m.canReprocess;
  return '<article data-master="'+esc(m.id)+'"><h3>原图 V'+s?.version+' · 透明母版 V'+m.version+' · '+esc(labels[m.status])+'</h3>'+
   '<p>'+esc(m.reviewNote||m.details.reason||methods[m.details.method]||'')+'</p>'+
   (m.canReprocess?'<p>已更新自动处理能力，可选择此原图并点击“自动处理 Logo”重新检测。</p>':'')+
   '<div><figure><figcaption>原图</figcaption><img src="/files/'+encodeURIComponent(s.previewPath)+'" alt="原始 Logo"></figure>'+
   (m.fileAvailable?'<figure><figcaption>处理结果（灰底预览）</figcaption><img src="/files/'+encodeURIComponent(m.filePath)+'" alt="透明母版预览"></figure>':'')+'</div>'+
   (m.status==='REVIEW_REQUIRED'&&!review&&!m.canReprocess?'<p>请设计师在<a href="#/professional">专业登录</a>后返回复核。</p>':'')+
   (review?'<label>复核依据<input maxlength="1000" data-review-note="'+m.id+'" placeholder="检查图形、文字及内部颜色是否保留"></label><button class="btn" data-review="'+m.id+'" data-approved="true">确认背景分离正确</button><button class="btn" data-review="'+m.id+'" data-approved="false">转人工处理</button>':'')+
   (m.status==='READY'&&m.fileAvailable?'<button class="btn" data-master-activate="'+m.id+'">使用此母版建立当前生产 Logo</button>':'')+'</article>';
 };
 const latest=d.masters.find(m=>m.sourceId===d.sources[0]?.id),history=d.masters.filter(m=>m!==latest);
 panel.innerHTML='<h2>客户 Logo 自动背景处理</h2><p>保留原颜色和原始文件。背景不明确时才提示复核。</p>'+
  '<label>原始 Logo 版本<select id="transparent-source">'+d.sources.map(s=>'<option value="'+esc(s.id)+'">V'+s.version+' · '+esc(s.fileName)+'</option>').join('')+'</select></label>'+
  '<button class="btn primary" id="prepare-transparent" '+(d.busy||!d.sources.length?'disabled':'')+'>自动处理 Logo</button>'+
  '<p>'+(d.activeProductionLogoId?'已有当前生产 Logo，处理背景不会自动替换它。':'自动处理通过后，将建立可用于出图的 Logo。')+'</p><p role="alert" id="transparent-error"></p>'+
  '<div id="transparent-results">'+(latest?renderMaster(latest):'')+(history.length?'<details class="transparent-history"><summary>历史处理结果（'+history.length+'）</summary>'+history.map(renderMaster).join('')+'</details>':'')+'</div>';
 main.querySelector('#transparent-panel')?.remove();main.querySelector('.heading')?.after(panel);
 const action=async(button,fn)=>{button.disabled=true;try{await fn();if(h.isCurrent())await h.reload();}catch(e){if(h.isCurrent()&&panel.isConnected){panel.querySelector('#transparent-error').textContent=e.message;button.disabled=false;}}};
 panel.querySelector('#prepare-transparent').onclick=e=>action(e.currentTarget,async()=>{
  const sourceId=panel.querySelector('#transparent-source').value,p=await api(base+'/prepare',{sourceId}),m=p.masters.find(m=>m.sourceId===sourceId);
  if(!d.activeProductionLogoId&&!p.activeProductionLogoId&&m?.status==='READY')await api(base+'/activate',{masterId:m.id,expectedActiveProductionLogoId:null});
 });
 panel.querySelectorAll('[data-master-activate]').forEach(b=>b.onclick=()=>action(b,()=>api(base+'/activate',{masterId:b.dataset.masterActivate,expectedActiveProductionLogoId:d.activeProductionLogoId})));
 panel.querySelectorAll('[data-review]').forEach(b=>b.onclick=()=>action(b,()=>{const m=d.masters.find(m=>m.id===b.dataset.review);return api(base+'/review',{masterId:m.id,baseRevision:m.revision,approved:b.dataset.approved==='true',note:panel.querySelector('[data-review-note="'+m.id+'"]').value});}));
}
