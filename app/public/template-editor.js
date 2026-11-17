import {mountTemplateSteps} from './template-steps.js';
import {resizeCentered} from './center-resize.js';
import {mountDeliveryLayout} from './customer-delivery-ui.js';
import {editorHistory,confirmEditorAction} from './editor-history.js';
import {mountTemplateAutomation} from './region-template-ui.js';
import {zonePoints,bounds,polygonError,pointInside} from './zone-geometry.js';
let active=null;
export function leaveTemplate(){
 if(!active)return true;
 if(active.dirty&&!confirm('当前修改尚未发布。本机草稿会保留，仍然离开？')){history.replaceState(null,'',active.hash);return false;}
 active.dispose();active=null;return true;
}
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const round=n=>Math.round(n*1e6)/1e6;
export async function renderTemplate(main,productId,helpers){
 const {api,esc,toast,isCurrent}=helpers;
 const requestedVersion=new URLSearchParams(location.hash.split('?')[1]||'').get('version');
 const payload=await api('/api/templates/'+encodeURIComponent(productId)+(requestedVersion?'?version='+encodeURIComponent(requestedVersion):''));
 if(!isCurrent())return;
 const historical=!!payload.template&&payload.template.version!==payload.currentVersion;
 const readonly=historical||!payload.canEdit;
 let zones=structuredClone(payload.template?.zones||[]),selected=zones[0]?.id||null,mode='select',drag=null,pendingPoints=[],selectedNode=0;
 let automationInitial=payload.template?.automation||null,automationUI=null,edits=null,original=null;
 const draftKey='template-editor-draft:'+productId+':'+payload.currentVersion;let restored=false;try{const saved=JSON.parse(localStorage.getItem(draftKey)||'null');if(!readonly&&saved?.image===(payload.template?.standardImage||payload.product.standardImage)&&Array.isArray(saved.zones)){zones=saved.zones;automationInitial=saved.automation||automationInitial;selected=zones[0]?.id||null;restored=true;}}catch{}
 const unifyRectangles=()=>{if(!readonly)for(const z of zones)if(!z.shapeType||z.shapeType==='RECT'){z.shapeType='ROTATED_RECT';z.rotation=0;}};unifyRectangles();
 const state={dirty:restored,hash:location.hash,dispose:()=>{window.removeEventListener('beforeunload',unload);observer.disconnect();main.removeEventListener('keydown',keyboard);}};active=state;
 const unload=e=>{if(state.dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',unload);
 main.innerHTML=`<a class="back" href="#/products">← 返回产品图库</a><div class="heading"><div><h1>${esc(payload.product.sku)} · 产品母版</h1><p>${esc(payload.product.name)} · 标准产品图保持不变</p></div><span id="template-status" class="template-status">${payload.template?'Template V'+payload.template.version:'尚未建立母版'}</span></div>${payload.needsTemplateReview&&!readonly?'<div class="history-banner">标准图已更新。请在新图上重新确认或建立母版区域，旧母版仍保留在历史版本。</div>':''}${!payload.canEdit?'<div class="history-banner">业务模式：母版只读。管理员或设计师可在 <a href="#/professional">专业登录</a> 后返回编辑。</div>':''}${historical?'<div class="history-banner">正在查看历史版本，只读。<a class="btn small" href="#/templates/'+productId+'">返回当前版本编辑</a></div>':''}<div class="template-toolbar"><button class="btn" id="select-zone" type="button">选择 / 移动</button><button class="btn" id="add-logo" type="button" ${readonly?'disabled':''}>＋ 新增产品区域</button><button class="btn zone-red" type="button" id="delete-zone" disabled>删除区域</button><label>区域形状 <select id="new-shape"><option value="ROTATED_RECT">矩形（可缩放、旋转）</option><option value="POLYGON">多边形</option></select></label><span id="mode-help" class="hint">选中区域后可拖动，拖动四角调整大小。</span></div><div class="template-layout"><section class="panel canvas-panel"><div class="panel-head"><h2>① 标注产品位置 <span class="count" id="zone-count"></span></h2><span class="legend"><span>蓝色 · 产品</span><span>红色 · 禁止</span></span></div><div class="canvas-wrap"><svg id="template-canvas" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="产品母版标注画布"><image id="base-image" href="/files/${encodeURIComponent(payload.template?.standardImage||payload.product.standardImage)}" x="0" y="0"/><g id="zone-layer"></g></svg><p id="image-loading" class="hint">正在加载产品图…</p></div><div class="canvas-footer">请框选产品所在位置；蓝色为产品区域，红色为禁止区域。Logo 位置在摆放设置中调整。</div></section><aside class="template-properties"><section class="panel"><div class="panel-head"><h2>区域列表</h2></div><div class="zone-list" id="zone-list"></div></section><p id="template-error" class="error" role="alert" hidden></p></aside></div>`;
 if(!readonly){const topPublish=document.createElement('button');topPublish.id='publish-top';topPublish.className='btn primary';topPublish.type='button';topPublish.textContent='保存 / 发布';main.querySelector('.template-toolbar').append(topPublish);}
 if(!readonly){const tools=document.createElement('span');tools.innerHTML='<button type="button" class="btn" id="editor-undo">撤销</button> <button type="button" class="btn" id="editor-redo">重做</button> <button type="button" class="btn" id="editor-cancel">放弃未发布修改</button>';main.querySelector('.template-toolbar').append(tools);}
 const canvas=main.querySelector('#template-canvas'),layer=main.querySelector('#zone-layer');let W=1000,H=1000,loaded=false;
 const error=e=>{const el=main.querySelector('#template-error');el.textContent=e.message||String(e);el.hidden=false;};
 function persist(){if(readonly)return;try{localStorage.setItem(draftKey,JSON.stringify({image:payload.template?.standardImage||payload.product.standardImage,zones,automation:automationUI?.snapshot().config||automationInitial}));}catch{error('本机草稿保存失败，请使用保存并发布，避免刷新丢失修改');}}
 function snapshot(){return {zones:structuredClone(zones),selected,mode,pendingPoints:structuredClone(pendingPoints),selectedNode,newShape:main.querySelector('#new-shape').value,automation:automationUI?.snapshot()};}
 function content(s){return JSON.stringify({zones:s.zones,automation:s.automation?.config});}
 function updateStatus(){const s=snapshot();state.dirty=content(s)!==content(original)||pendingPoints.length>0||!!s.automation?.surface?.drawing;main.querySelector('#template-status').textContent=state.dirty?'未发布的修改 · 本机草稿':payload.template?'Template V'+payload.template.version:'尚未建立母版';for(const [id,enabled] of [['editor-undo',edits?.canUndo],['editor-redo',edits?.canRedo]]){const b=main.querySelector('#'+id);if(b)b.disabled=!enabled;}}
 function dirty(){if(readonly)return;edits?.push(snapshot());updateStatus();persist();}
 function restore(s){drag=null;zones=structuredClone(s.zones);selected=s.selected;selectedNode=s.selectedNode;main.querySelector('#new-shape').value=s.newShape==='POLYGON'?'POLYGON':'ROTATED_RECT';setMode(s.mode);pendingPoints=structuredClone(s.pendingPoints);automationUI?.restore(s.automation);refresh();updateStatus();persist();main.querySelector('#template-error').hidden=true;}
 function travel(forward){if(drag||automationUI?.isDragging())return;restore(forward?edits.redo():edits.undo());}
 function keyboard(e){if(readonly||e.target.closest('dialog'))return;if(e.key==='Escape'){e.preventDefault();if(drag)finish(true);else if(!automationUI?.cancelGesture()){pendingPoints=[];setMode('select');dirty();refresh();}return;}if((e.ctrlKey||e.metaKey)&&!e.target.closest('input,textarea,select,[contenteditable]')){if(e.key.toLowerCase()==='z'){e.preventDefault();travel(e.shiftKey);}else if(e.key.toLowerCase()==='y'){e.preventDefault();travel(true);}}}
 main.addEventListener('keydown',keyboard);
 main.querySelector('#editor-undo')?.addEventListener('click',()=>travel(false));main.querySelector('#editor-redo')?.addEventListener('click',()=>travel(true));
 main.querySelector('#editor-cancel')?.addEventListener('click',async()=>{if(!await confirmEditorAction(main,'放弃当前全部未发布修改，恢复已发布母版？'))return;restore(original);edits.reset(snapshot());updateStatus();try{localStorage.removeItem(draftKey);}catch{}});
 function validRect(z){return z.x>=-1e-8&&z.y>=-1e-8&&z.width>=.003&&z.height>=.003&&z.x+z.width<=1+1e-8&&z.y+z.height<=1+1e-8&&zonePoints(z,{width:W,height:H}).every(p=>p.x>=-1e-8&&p.y>=-1e-8&&p.x<=1+1e-8&&p.y<=1+1e-8);}
 function anchorFrom(original,next){if(original.zoneType!=='logo')return next;const a=(original.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),dx=(original.defaultAnchorX-original.x-original.width/2)*W,dy=(original.defaultAnchorY-original.y-original.height/2)*H,u=(dx*c+dy*s)/(original.width*W),v=(-dx*s+dy*c)/(original.height*H),b=(next.rotation||0)*Math.PI/180,x=u*next.width*W,y=v*next.height*H;return {...next,defaultAnchorX:next.x+next.width/2+(x*Math.cos(b)-y*Math.sin(b))/W,defaultAnchorY:next.y+next.height/2+(x*Math.sin(b)+y*Math.cos(b))/H};}
 function rotatedControls(z,scale){const pts=zonePoints(z,{width:W,height:H}).map(p=>({x:p.x*W,y:p.y*H})),mid={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2},a=(z.rotation||0)*Math.PI/180,offset=28*scale;let h={x:mid.x+Math.sin(a)*offset,y:mid.y-Math.cos(a)*offset};if(h.x<7*scale||h.y<7*scale||h.x>W-7*scale||h.y>H-7*scale)h={x:mid.x-Math.sin(a)*offset,y:mid.y+Math.cos(a)*offset};return pts.map((p,n)=>'<rect class="resize-handle" data-handle="corner'+n+'" x="'+(p.x-5*scale)+'" y="'+(p.y-5*scale)+'" width="'+10*scale+'" height="'+10*scale+'" vector-effect="non-scaling-stroke"/>').join('')+'<line x1="'+mid.x+'" y1="'+mid.y+'" x2="'+h.x+'" y2="'+h.y+'" stroke="'+(z.zoneType==='no-logo'?'#c02b3e':'#254bd8')+'" stroke-width="1.5" vector-effect="non-scaling-stroke"/><circle class="resize-handle" data-handle="rotate" aria-label="拖动旋转区域" cx="'+h.x+'" cy="'+h.y+'" r="'+6*scale+'" vector-effect="non-scaling-stroke"/>';}

 function setMode(value){automationUI?.endPlacementEdit();if(value!==mode)pendingPoints=[];mode=value;main.querySelector('#mode-help').textContent=readonly?'当前为只读模式，可在区域列表中选择区域。':value==='select'?'拖动区域移动，拖动角点以中心缩放；矩形顶部圆点可旋转，接近 45° 倍数时吸附。':(value==='logo'?'框选产品所在位置。':'')+(main.querySelector('#new-shape').value==='POLYGON'?'逐点点击建立多边形，点击起点闭合；选择模式可取消未闭合路径。':'在产品图上拖出矩形，选中后即可拖动、缩放和旋转。');for(const [id,m] of [['select-zone','select'],['add-logo','logo']])main.querySelector('#'+id).classList.toggle('tool-active',m===mode);canvas.classList.toggle('drawing',mode!=='select');}
 function draw(){
  automationUI?.draw();
  if(!canvas.isConnected)return;main.querySelector('#delete-zone').disabled=readonly||!zones.some(z=>z.id===selected);
  const scale=W/(canvas.getBoundingClientRect().width||W),handle=8*scale,font=12*scale;
  layer.innerHTML=zones.map((z,i)=>{const x=z.x*W,y=z.y*H,w=z.width*W,h=z.height*H;return `<g data-zone="${esc(z.id)}" class="zone-shape ${z.zoneType==='no-logo'?'forbidden':'allowed'} ${z.id===selected?'chosen':''}"><polygon class="zone-box" points="${zonePoints(z,{width:W,height:H}).map(p=>`${p.x*W},${p.y*H}`).join(' ')}" vector-effect="non-scaling-stroke"/><text x="${x+4*scale}" y="${Math.max(font,y-5*scale)}" font-size="${font}" class="zone-text">${i+1}. ${esc(z.name||'未命名区域')}${z.isDefault?' ★':''}</text>${z.zoneType==='logo'?`<circle class="zone-anchor" cx="${z.defaultAnchorX*W}" cy="${z.defaultAnchorY*H}" r="${3*scale}" vector-effect="non-scaling-stroke"/>`:''}${z.id===selected&&!readonly&&(!z.shapeType||z.shapeType==='RECT')?[['nw',x,y],['ne',x+w,y],['sw',x,y+h],['se',x+w,y+h]].map(([dir,hx,hy])=>`<rect class="resize-handle" data-handle="${dir}" x="${hx-handle/2}" y="${hy-handle/2}" width="${handle}" height="${handle}" vector-effect="non-scaling-stroke"/>`).join(''):''}${z.id===selected&&!readonly&&z.shapeType==='POLYGON'?zonePoints(z).map((p,n)=>`<circle data-node="${n}" class="resize-handle" cx="${p.x*W}" cy="${p.y*H}" r="${(n===selectedNode?6:4)*scale}"/>`).join(''):''}${z.id===selected&&!readonly&&z.shapeType==='ROTATED_RECT'?rotatedControls(z,scale):''}</g>`;}).join('')+(pendingPoints.length?`<polyline points="${pendingPoints.map(p=>`${p.x*W},${p.y*H}`).join(' ')}" fill="none" stroke="${mode==='no-logo'?'#df4355':'#2877e8'}" stroke-width="${2*scale}"/>${pendingPoints.map((p,n)=>`<circle data-close="${n===0?'yes':'no'}" cx="${p.x*W}" cy="${p.y*H}" r="${5*scale}" fill="${mode==='no-logo'?'#df4355':'#2877e8'}"/>`).join('')}`:'');
  main.querySelector('#zone-count').textContent=`${zones.filter(z=>z.zoneType==='logo').length} 个产品区域 · ${zones.filter(z=>z.zoneType==='no-logo').length} 个禁止区域`;
 }
 function list(){main.querySelector('#zone-list').innerHTML=zones.length?['产品','彩盒','待设置','禁止区域'].map(group=>{const rows=zones.map((z,i)=>({z,i})).filter(({z})=>(z.zoneType==='no-logo'?'禁止区域':automationUI?.groupFor(z.id)||'待设置')===group);return rows.length?'<h3 class="zone-group">'+group+'</h3>'+rows.map(({z,i})=>`<button type="button" class="zone-list-item ${z.id===selected?'selected':''}" data-select="${esc(z.id)}"><span class="zone-type ${z.zoneType==='no-logo'?'red':''}">${z.zoneType==='logo'?'L':'禁'}</span><span>${i+1}. ${esc(z.name||'未命名区域')}${z.isDefault?' ★':''}</span></button>`).join(''):'';}).join(''):'<p class="hint zone-empty">点击上方“新增区域”，在图上拖动框选。</p>';main.querySelectorAll('[data-select]').forEach(b=>b.onclick=()=>{selected=b.dataset.select;setMode('select');refresh();});}
 function refresh(){draw();list();automationUI?.render();}
 function point(e){const b=canvas.getBoundingClientRect();return {x:clamp((e.clientX-b.left)/b.width,0,1),y:clamp((e.clientY-b.top)/b.height,0,1)};}
 canvas.addEventListener('pointerdown',e=>{
  if(!loaded||e.button!==0||readonly||drag)return;
  e.preventDefault();const gesture=snapshot(),p=point(e),target=e.target.closest('[data-zone]');
  if(mode!=='select'&&main.querySelector('#new-shape').value==='POLYGON'){
   if(e.target.dataset.close==='yes'&&pendingPoints.length>=3){const err=polygonError(pendingPoints);if(err){error(err);return;}const box=bounds(pendingPoints),center={x:box.x+box.width/2,y:box.y+box.height/2};if(!pointInside(center,pendingPoints)){center.x=pendingPoints[0].x;center.y=pendingPoints[0].y;}const id=crypto.randomUUID();zones.push({id,zoneType:mode,name:mode==='logo'?'多边形产品区域':'多边形禁止区域',shapeType:'POLYGON',rotation:0,points:structuredClone(pendingPoints),...box,defaultAnchorX:center.x,defaultAnchorY:center.y,maxLogoWidthRatio:.3,maxLogoHeightRatio:.3,defaultRotation:0,allowRotation:true,orientation:'free',isDefault:mode==='logo'&&!zones.some(z=>z.zoneType==='logo'),note:''});selected=id;selectedNode=0;pendingPoints=[];setMode('select');dirty();refresh();}else{if(pendingPoints.length>=100){error('最多 100 个节点');return;}pendingPoints.push(p);dirty();draw();}return;
  }
  if(mode!=='select'){
   const type=mode,id=crypto.randomUUID();const z={id,shapeType:main.querySelector('#new-shape').value,rotation:0,zoneType:type,name:type==='logo'?'产品区域 '+(zones.filter(z=>z.zoneType==='logo').length+1):'禁止区域 '+(zones.filter(z=>z.zoneType==='no-logo').length+1),x:p.x,y:p.y,width:.001,height:.001,note:'',defaultAnchorX:p.x,defaultAnchorY:p.y,maxLogoWidthRatio:.7,maxLogoHeightRatio:.3,defaultRotation:0,allowRotation:false,orientation:'horizontal',isDefault:type==='logo'&&!zones.some(z=>z.zoneType==='logo')};zones.push(z);selected=id;drag={kind:'create',start:p,z,wasDirty:state.dirty};
  }else if(target){selected=target.dataset.zone;const z=zones.find(z=>z.id===selected);if(e.target.dataset.node!==undefined)selectedNode=Number(e.target.dataset.node);drag={kind:e.target.dataset.node!==undefined?'node':e.target.dataset.handle||'move',node:selectedNode,start:p,z,original:structuredClone(z),wasDirty:state.dirty};}
  else {selected=null;refresh();return;}
  drag.before=gesture;drag.pointerId=e.pointerId;canvas.setPointerCapture(e.pointerId);if(selected===gesture.selected)draw();else refresh();
 });
 canvas.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.pointerId)return;const p=point(e),z=drag.z;const beforeZone=structuredClone(z);
  if(drag.kind==='move'){if(drag.shift!==undefined&&drag.shift!==e.shiftKey){drag.original=structuredClone(z);drag.start={...p};drag.axis=null;}drag.shift=e.shiftKey;if(e.shiftKey){drag.axis ||= Math.abs((p.x-drag.start.x)*W)>=Math.abs((p.y-drag.start.y)*H)?'x':'y';if(drag.axis==='x')p.y=drag.start.y;else p.x=drag.start.x;}}
  const s=drag.start,o=drag.original;
  if(drag.kind==='create'){z.x=Math.min(s.x,p.x);z.y=Math.min(s.y,p.y);z.width=Math.abs(p.x-s.x);z.height=Math.abs(p.y-s.y);z.defaultAnchorX=z.x+z.width/2;z.defaultAnchorY=z.y+z.height/2;}
  else if(o?.shapeType==='ROTATED_RECT'){
   let next={...o};const a=(o.rotation||0)*Math.PI/180,c=Math.cos(a),sn=Math.sin(a);
   if(drag.kind==='rotate'){const cx=o.x+o.width/2,cy=o.y+o.height/2,angle=q=>Math.atan2((q.y-cy)*H,(q.x-cx)*W)*180/Math.PI;let degrees=(o.rotation||0)+angle(p)-angle(s);degrees=((degrees+180)%360+360)%360-180;const snap=Math.round(degrees/45)*45;if(Math.abs(degrees-snap)<=3)degrees=snap;next.rotation=degrees;if(!validRect(next))return;}
   else if(drag.kind.startsWith('corner'))next=resizeCentered(o,Number(drag.kind.slice(6)),{x:p.x-s.x,y:p.y-s.y},{width:W,height:H},.003,validRect);
   else {const box=bounds(zonePoints(o,{width:W,height:H})),dx=clamp(p.x-s.x,Math.max(-box.x,-o.x),Math.min(1-box.x-box.width,1-o.x-o.width)),dy=clamp(p.y-s.y,Math.max(-box.y,-o.y),Math.min(1-box.y-box.height,1-o.y-o.height));next.x=o.x+dx;next.y=o.y+dy;}
   Object.assign(z,anchorFrom(o,next));
  }
  else if(drag.kind==='node'){z.points=zonePoints(z).map((q,n)=>n===drag.node?p:q);Object.assign(z,bounds(z.points));}
  else if(drag.kind==='move'){z.x=clamp(o.x+p.x-s.x,0,1-o.width);z.y=clamp(o.y+p.y-s.y,0,1-o.height);z.defaultAnchorX=o.defaultAnchorX+z.x-o.x;z.defaultAnchorY=o.defaultAnchorY+z.y-o.y;if(z.shapeType==='POLYGON')z.points=zonePoints(o).map(q=>({x:q.x+z.x-o.x,y:q.y+z.y-o.y}));}
  else Object.assign(z,anchorFrom(o,resizeCentered(o,drag.kind,{x:p.x-s.x,y:p.y-s.y},{width:W,height:H},.003,validRect)));
  if(drag.kind!=='create'&&automationUI?.transformed(z.id,beforeZone,z)===false)Object.assign(z,beforeZone);draw();
 });
 function finish(cancel=false){if(!drag)return;if(cancel||drag.z.width<.003||drag.z.height<.003){restore(drag.before);return;}
  if(drag.z.shapeType!=='ROTATED_RECT')for(const key of ['x','y','width','height','defaultAnchorX','defaultAnchorY'])drag.z[key]=round(drag.z[key]);
  drag=null;setMode('select');dirty();draw();list();
 }
 canvas.addEventListener('pointerup',e=>{if(e.pointerId===drag?.pointerId)finish();});canvas.addEventListener('pointercancel',e=>{if(e.pointerId===drag?.pointerId)finish(true);});
 main.querySelector('#new-shape').onchange=()=>{pendingPoints=[];setMode(mode);dirty();draw();};main.querySelector('#select-zone').onclick=()=>{pendingPoints=[];setMode('select');dirty();draw();};main.querySelector('#add-logo').onclick=()=>setMode('logo');
 main.querySelector('#delete-zone').onclick=()=>{if(automationUI?.removeZone(selected)===false)return;zones=zones.filter(z=>z.id!==selected);selected=zones[0]?.id||null;dirty();refresh();};

 main.querySelector('#publish-top')?.addEventListener('click',async e=>{
  if(drag||automationUI?.isDragging()){error('请先完成当前拖动');return;}if(pendingPoints.length){error('请先点击起点闭合多边形，或选择移动模式取消路径');return;}
  const button=e.currentTarget;button.disabled=true;button.textContent='正在保存并发布…';main.querySelector('#template-error').hidden=true;
  try{
   const result=await api('/api/templates/'+encodeURIComponent(productId),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({zones,automation:automationUI?.serialize()||null,baseVersion:payload.currentVersion})});
   try{localStorage.removeItem(draftKey);}catch{}state.dirty=false;toast('Template V'+result.currentVersion+' 已发布');
   if(active===state){state.dispose();active=null;history.replaceState(null,'','#/templates/'+productId);await renderTemplate(main,productId,helpers);}
  }catch(e){error(e);button.disabled=false;button.textContent='保存 / 发布';main.querySelector('#template-error').scrollIntoView({block:'center'});}
 });
 const observer=new ResizeObserver(draw);observer.observe(canvas);
 const source=new Image();source.onload=()=>{if(!canvas.isConnected)return;main.querySelector('#delete-zone').disabled=readonly||!zones.some(z=>z.id===selected);W=source.naturalWidth;H=source.naturalHeight;canvas.setAttribute('viewBox',`0 0 ${W} ${H}`);canvas.setAttribute('width',W);canvas.setAttribute('height',H);const img=main.querySelector('#base-image');img.setAttribute('width',W);img.setAttribute('height',H);loaded=true;main.querySelector('#image-loading').hidden=true;draw();};source.onerror=()=>{if(canvas.isConnected){main.querySelector('#image-loading').textContent='产品图加载失败，请刷新重试。';error('产品图加载失败，暂不能框选。');}};source.src='/files/'+encodeURIComponent(payload.template?.standardImage||payload.product.standardImage);
 automationUI=mountTemplateAutomation({main,canvas,readonly,canPlace:()=>mode==='select',reject:error,zones:()=>zones,selected:()=>selected,image:()=>({width:W,height:H}),dirty,refreshList:list,clone:()=>{const original=zones.find(z=>z.id===selected);if(!original)return;const next=structuredClone(original);next.id=crypto.randomUUID();const baseName=original.name.replace(/(?: 副本(?: \d+)?)+$/,'');let copyNo=1;while(zones.some(z=>z.name===baseName+' 副本 '+copyNo))copyNo++;next.name=baseName+' 副本 '+copyNo;if(next.zoneType==='logo')next.isDefault=false;zones.push(next);automationUI.cloned(original.id,next.id);selected=next.id;dirty();refresh();}},automationInitial);
 setMode('select');refresh();
 const restoredState=snapshot();
 if(restored){zones=structuredClone(payload.template?.zones||[]);unifyRectangles();selected=zones[0]?.id||null;automationUI.restore({config:payload.template?.automation||{version:1,carriers:[],areas:[],schemes:[]}});}
 original=snapshot();edits=editorHistory(original);
 if(restored){restore(restoredState);edits.push(snapshot());}updateStatus();
 await mountDeliveryLayout(main,payload);
 mountTemplateSteps(main,()=>{if(pendingPoints.length||automationUI?.snapshot().surface?.drawing){toast('请先闭合或取消正在圈选的轮廓，再切换步骤');return false;}setMode('select');return true;});
}

