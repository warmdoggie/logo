import {mountTemplateAutomation} from './template-automation-ui.js';
import {fetchPreview} from './preview-fetch.js';
import {zonePoints,bounds,polygonError,pointInside,pickZone} from './zone-geometry.js';
let active=null;
export function leaveTemplate(){
 if(!active)return true;
 if(active.dirty&&!confirm('当前修改尚未发布。本机草稿会保留，仍然离开？')){history.replaceState(null,'',active.hash);return false;}
 active.dispose();active=null;return true;
}
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
export async function renderTemplate(main,productId,helpers){
 const {api,esc,toast,isCurrent}=helpers;
 const requestedVersion=new URLSearchParams(location.hash.split('?')[1]||'').get('version');
 const payload=await api('/api/templates/'+encodeURIComponent(productId)+(requestedVersion?'?version='+encodeURIComponent(requestedVersion):''));
 if(!isCurrent())return;
 const readonly=helpers.readOnly||!!payload.template&&payload.template.version!==payload.currentVersion;
 let zones=structuredClone(payload.template?.zones||[]),selected=zones[0]?.id||null,mode='select',drag=null,pendingPoints=[],selectedNode=0;
 let automationInitial=payload.template?.automation||null,automationUI=null;
 const draftKey='template-editor-draft:'+productId+':'+payload.currentVersion;let restored=false;try{const saved=JSON.parse(localStorage.getItem(draftKey)||'null');if(!readonly&&saved?.image===(payload.template?.standardImage||payload.product.standardImage)&&Array.isArray(saved.zones)){zones=saved.zones;automationInitial=saved.automation||automationInitial;selected=zones[0]?.id||null;restored=true;}}catch{}
 let previewUrl='',imageSize=null,drawFrame=null;const imageController=new AbortController();
 const state={dirty:restored,hash:location.hash,dispose:()=>{imageController.abort();if(previewUrl)URL.revokeObjectURL(previewUrl);if(drawFrame!==null)cancelAnimationFrame(drawFrame);window.removeEventListener('beforeunload',unload);observer.disconnect();}};active=state;
 const unload=e=>{if(state.dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',unload);
 main.innerHTML=`<a class="back" href="#/products">← 返回产品图库</a><div class="heading"><div><h1>${esc(payload.product.sku)} · 产品母版</h1><p>${esc(payload.product.name)} · 标准产品图保持不变</p></div><span id="template-status" class="template-status">${payload.template?'Template V'+payload.template.version:'尚未建立母版'}</span></div>${payload.needsTemplateReview&&!readonly?'<div class="history-banner">标准图已更新。请在新图上重新确认或建立母版区域，旧母版仍保留在历史版本。</div>':''}${readonly?'<div class="history-banner">正在查看历史版本，只读。<a class="btn small" href="#/templates/'+productId+'">返回当前版本编辑</a></div>':''}<div class="template-toolbar"><button class="btn" id="select-zone" type="button">选择 / 移动</button><button class="btn" id="add-logo" type="button" ${readonly?'disabled':''}>＋ 新增产品区域</button><button class="btn zone-carton" id="add-carton" type="button" ${readonly?'disabled':''}>＋ 新增彩盒区域</button><button class="btn zone-red" type="button" id="delete-zone" disabled>删除区域</button><label>区域形状 <select id="new-shape"><option value="RECT">矩形</option><option value="ROTATED_RECT">旋转矩形</option><option value="POLYGON">多边形</option></select></label><span id="mode-help" class="hint">选中区域后可拖动，拖动四角调整大小。</span></div><div class="template-layout"><section class="panel canvas-panel"><div class="panel-head"><h2>区域标注 <span class="count" id="zone-count"></span></h2><span class="legend"><span>蓝色 · 产品</span><span class="legend-carton">橙色 · 彩盒</span><span>红色 · 禁止</span></span></div><div class="canvas-wrap"><svg id="template-canvas" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="产品母版标注画布"><image id="base-image" x="0" y="0" preserveAspectRatio="none"/><g id="zone-layer"></g></svg><p id="image-loading" class="hint">正在加载产品图…</p></div><div class="canvas-footer">点击图中区域选中；蓝色为产品区域，橙色为彩盒区域，红色为禁止区域；请框选产品所在位置，Logo 位置在摆放设置中调整。</div></section><aside class="template-properties"><p id="template-error" class="error" role="alert" hidden></p></aside></div>`;
 if(!readonly){const topPublish=document.createElement('button');topPublish.id='publish-top';topPublish.className='btn primary';topPublish.type='button';topPublish.textContent='保存 / 发布';main.querySelector('.template-toolbar').append(topPublish);}
 const canvas=main.querySelector('#template-canvas'),layer=main.querySelector('#zone-layer');let W=1000,H=1000,loaded=false;
 const error=e=>{const el=main.querySelector('#template-error');el.textContent=e.message||String(e);el.hidden=false;};
 function persist(){if(readonly)return;try{localStorage.setItem(draftKey,JSON.stringify({image:payload.template?.standardImage||payload.product.standardImage,zones,automation:automationUI?.serialize()||automationInitial}));}catch{error('本机草稿保存失败，请使用保存并发布，避免刷新丢失修改');}}
 function dirty(){state.dirty=true;main.querySelector('#template-status').textContent='未发布的修改 · 本机草稿';persist();}
 function validRect(z){return z.x>=-1e-8&&z.y>=-1e-8&&z.width>=.003&&z.height>=.003&&z.x+z.width<=1+1e-8&&z.y+z.height<=1+1e-8&&zonePoints(z,{width:W,height:H}).every(p=>p.x>=-1e-8&&p.y>=-1e-8&&p.x<=1+1e-8&&p.y<=1+1e-8);}
 function anchorFrom(original,next){if(original.zoneType!=='logo')return next;const a=(original.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),dx=(original.defaultAnchorX-original.x-original.width/2)*W,dy=(original.defaultAnchorY-original.y-original.height/2)*H,u=(dx*c+dy*s)/(original.width*W),v=(-dx*s+dy*c)/(original.height*H),b=(next.rotation||0)*Math.PI/180,x=u*next.width*W,y=v*next.height*H;return {...next,defaultAnchorX:next.x+next.width/2+(x*Math.cos(b)-y*Math.sin(b))/W,defaultAnchorY:next.y+next.height/2+(x*Math.sin(b)+y*Math.cos(b))/H};}
 function rotatedControls(z,scale){const pts=zonePoints(z,{width:W,height:H}).map(p=>({x:p.x*W,y:p.y*H})),mid={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2},a=(z.rotation||0)*Math.PI/180,offset=28*scale;let h={x:mid.x+Math.sin(a)*offset,y:mid.y-Math.cos(a)*offset};if(h.x<7*scale||h.y<7*scale||h.x>W-7*scale||h.y>H-7*scale)h={x:mid.x-Math.sin(a)*offset,y:mid.y+Math.cos(a)*offset};return pts.map((p,n)=>'<rect class="resize-handle" data-handle="corner'+n+'" x="'+(p.x-5*scale)+'" y="'+(p.y-5*scale)+'" width="'+10*scale+'" height="'+10*scale+'" vector-effect="non-scaling-stroke"/>').join('')+'<line x1="'+mid.x+'" y1="'+mid.y+'" x2="'+h.x+'" y2="'+h.y+'" stroke="'+(z.zoneType==='no-logo'?'#c02b3e':'#254bd8')+'" stroke-width="1.5" vector-effect="non-scaling-stroke"/><circle class="resize-handle" data-handle="rotate" aria-label="拖动旋转区域" cx="'+h.x+'" cy="'+h.y+'" r="'+6*scale+'" vector-effect="non-scaling-stroke"/>';}

 function setMode(value){if(value!==mode)pendingPoints=[];mode=value;main.querySelector('#mode-help').textContent=readonly?'历史版本只读，点击图中区域选中；重叠处再次点击可切换区域。':value==='select'?'拖动区域移动或缩放，顶部圆点可旋转；选中后按 Backspace 删除；重叠区域按住 Alt 点击切换。':(value==='logo'?'框选产品所在位置。':'')+(main.querySelector('#new-shape').value==='POLYGON'?'逐点点击建立多边形，点击起点闭合；选择模式可取消未闭合路径。':'在产品图上拖出矩形；旋转矩形可拖动顶部圆点调整角度。');for(const [id,m] of [['select-zone','select'],['add-logo','logo'],['add-carton','carton']])main.querySelector('#'+id).classList.toggle('tool-active',m===mode);canvas.classList.toggle('drawing',mode!=='select');}
 function queueDraw(){if(drawFrame===null)drawFrame=requestAnimationFrame(()=>{drawFrame=null;if(active===state)draw();});}
 function draw(){
  if(drawFrame!==null){cancelAnimationFrame(drawFrame);drawFrame=null;}
  automationUI?.draw();
  if(!canvas.isConnected)return;main.querySelector('#delete-zone').disabled=readonly||!zones.some(z=>z.id===selected);
  const scale=W/(canvas.getBoundingClientRect().width||W),handle=8*scale,font=12*scale;
  layer.innerHTML=zones.map((z,i)=>{const x=z.x*W,y=z.y*H,w=z.width*W,h=z.height*H;return `<g data-zone="${esc(z.id)}" class="zone-shape ${z.zoneType==='no-logo'?'forbidden':automationUI?.carrierType(z.id)==='CARTON'?'carton':'allowed'} ${z.id===selected?'chosen':''}"><polygon class="zone-box" points="${zonePoints(z,{width:W,height:H}).map(p=>`${p.x*W},${p.y*H}`).join(' ')}" vector-effect="non-scaling-stroke"/><text x="${x+4*scale}" y="${Math.max(font,y-5*scale)}" font-size="${font}" class="zone-text">${i+1}. ${esc(z.name||'未命名区域')}${automationUI?.carrierType(z.id)==='CARTON'?' · 彩盒':''}${z.isDefault?' ★':''}</text>${z.zoneType==='logo'?`<circle class="zone-anchor" cx="${z.defaultAnchorX*W}" cy="${z.defaultAnchorY*H}" r="${3*scale}" vector-effect="non-scaling-stroke"/>`:''}${z.id===selected&&!readonly&&(!z.shapeType||z.shapeType==='RECT')?[['nw',x,y],['ne',x+w,y],['sw',x,y+h],['se',x+w,y+h]].map(([dir,hx,hy])=>`<rect class="resize-handle" data-handle="${dir}" x="${hx-handle/2}" y="${hy-handle/2}" width="${handle}" height="${handle}" vector-effect="non-scaling-stroke"/>`).join(''):''}${z.id===selected&&!readonly&&z.shapeType==='POLYGON'?zonePoints(z).map((p,n)=>`<circle data-node="${n}" class="resize-handle" cx="${p.x*W}" cy="${p.y*H}" r="${(n===selectedNode?6:4)*scale}"/>`).join(''):''}${z.id===selected&&!readonly&&z.shapeType==='ROTATED_RECT'?rotatedControls(z,scale):''}</g>`;}).join('')+(pendingPoints.length?`<polyline points="${pendingPoints.map(p=>`${p.x*W},${p.y*H}`).join(' ')}" fill="none" stroke="${mode==='no-logo'?'#df4355':mode==='carton'?'#b76a14':'#2877e8'}" stroke-width="${2*scale}"/>${pendingPoints.map((p,n)=>`<circle data-close="${n===0?'yes':'no'}" cx="${p.x*W}" cy="${p.y*H}" r="${5*scale}" fill="${mode==='no-logo'?'#df4355':mode==='carton'?'#b76a14':'#2877e8'}"/>`).join('')}`:'');
  main.querySelector('#zone-count').textContent=`${zones.filter(z=>z.zoneType==='logo'&&automationUI?.carrierType(z.id)!=='CARTON').length} 个产品区域 · ${zones.filter(z=>automationUI?.carrierType(z.id)==='CARTON').length} 个彩盒 · ${zones.filter(z=>z.zoneType==='no-logo').length} 个禁止区域`;
 }
 function refresh(){draw();automationUI?.render();}
 function point(e){const b=canvas.getBoundingClientRect();return {x:clamp((e.clientX-b.left)/b.width,0,1),y:clamp((e.clientY-b.top)/b.height,0,1)};}
 canvas.addEventListener('pointerdown',e=>{
  if(!loaded||e.button!==0)return;
  if(readonly||mode==='select'&&e.altKey){selected=pickZone(zones,point(e),{width:W,height:H},selected,true);e.preventDefault();refresh();return;}
  e.preventDefault();const p=point(e),target=e.target.closest('[data-zone]');
  if(mode!=='select'&&main.querySelector('#new-shape').value==='POLYGON'){
   if(e.target.dataset.close==='yes'&&pendingPoints.length>=3){const err=polygonError(pendingPoints);if(err){error(err);return;}const box=bounds(pendingPoints),center={x:box.x+box.width/2,y:box.y+box.height/2};if(!pointInside(center,pendingPoints)){center.x=pendingPoints[0].x;center.y=pendingPoints[0].y;}const id=crypto.randomUUID();zones.push({id,zoneType:mode==='carton'?'logo':mode,name:mode==='carton'?'多边形彩盒区域':mode==='logo'?'多边形产品区域':'多边形禁止区域',shapeType:'POLYGON',rotation:0,points:structuredClone(pendingPoints),...box,defaultAnchorX:center.x,defaultAnchorY:center.y,maxLogoWidthRatio:.3,maxLogoHeightRatio:.3,defaultRotation:0,allowRotation:true,orientation:'free',isDefault:mode!=='no-logo'&&!zones.some(z=>z.zoneType==='logo'),note:''});try{if(mode!=='no-logo')automationUI.classifyZone(zones.at(-1),mode==='carton'?'CARTON':'BODY');}catch(e){zones.pop();error(e);return;}selected=id;selectedNode=0;pendingPoints=[];dirty();setMode('select');refresh();}else{if(pendingPoints.length>=100){error('最多 100 个节点');return;}pendingPoints.push(p);draw();}return;
  }
  if(mode!=='select'){
   const type=mode==='carton'?'logo':mode,id=crypto.randomUUID();const z={id,shapeType:main.querySelector('#new-shape').value,rotation:0,zoneType:type,name:mode==='carton'?'彩盒区域 '+(zones.filter(z=>automationUI?.carrierType(z.id)==='CARTON').length+1):type==='logo'?'产品区域 '+(zones.filter(z=>z.zoneType==='logo'&&automationUI?.carrierType(z.id)!=='CARTON').length+1):'禁止区域 '+(zones.filter(z=>z.zoneType==='no-logo').length+1),x:p.x,y:p.y,width:.001,height:.001,note:'',defaultAnchorX:p.x,defaultAnchorY:p.y,maxLogoWidthRatio:.7,maxLogoHeightRatio:.3,defaultRotation:0,allowRotation:false,orientation:'horizontal',isDefault:type==='logo'&&!zones.some(z=>z.zoneType==='logo')};zones.push(z);selected=id;drag={kind:'create',start:p,z,carrierType:mode==='carton'?'CARTON':'BODY',wasDirty:state.dirty};
  }else if(target){selected=target.dataset.zone;const z=zones.find(z=>z.id===selected);if(e.target.dataset.node!==undefined)selectedNode=Number(e.target.dataset.node);drag={kind:e.target.dataset.node!==undefined?'node':e.target.dataset.handle||'move',node:selectedNode,start:p,z,original:structuredClone(z),wasDirty:state.dirty};}
  else {selected=null;refresh();return;}
  canvas.setPointerCapture(e.pointerId);refresh();
 });
 canvas.addEventListener('pointermove',e=>{
  if(!drag)return;const p=point(e),z=drag.z,s=drag.start,o=drag.original;const beforeZone=structuredClone(z);
  if(drag.kind==='create'){z.x=Math.min(s.x,p.x);z.y=Math.min(s.y,p.y);z.width=Math.abs(p.x-s.x);z.height=Math.abs(p.y-s.y);z.defaultAnchorX=z.x+z.width/2;z.defaultAnchorY=z.y+z.height/2;}
  else if(o?.shapeType==='ROTATED_RECT'){
   let next={...o};const a=(o.rotation||0)*Math.PI/180,c=Math.cos(a),sn=Math.sin(a);
   if(drag.kind==='rotate'){const cx=o.x+o.width/2,cy=o.y+o.height/2,angle=q=>Math.atan2((q.y-cy)*H,(q.x-cx)*W)*180/Math.PI;let degrees=(o.rotation||0)+angle(p)-angle(s);degrees=((degrees+180)%360+360)%360-180;const snap=Math.round(degrees/45)*45;if(Math.abs(degrees-snap)<=3)degrees=snap;next.rotation=degrees;if(!validRect(next))return;}
   else if(drag.kind.startsWith('corner')){const n=Number(drag.kind.slice(6)),sx=[-1,1,1,-1][n],sy=[-1,-1,1,1][n],fixed=zonePoints(o,{width:W,height:H})[(n+2)%4],dx=(p.x-fixed.x)*W,dy=(p.y-fixed.y)*H,w=Math.max(.003*W,sx*(dx*c+dy*sn)),h=Math.max(.003*H,sy*(-dx*sn+dy*c)),cx=fixed.x*W+(sx*w*c-sy*h*sn)/2,cy=fixed.y*H+(sx*w*sn+sy*h*c)/2;next={...o,x:(cx-w/2)/W,y:(cy-h/2)/H,width:w/W,height:h/H};if(!validRect(next)){let lo=0,hi=1;const target=next;for(let n=0;n<40;n++){const t=(lo+hi)/2,candidate={...o};for(const k of ['x','y','width','height'])candidate[k]=o[k]+t*(target[k]-o[k]);if(validRect(candidate))lo=t;else hi=t;}next={...o};for(const k of ['x','y','width','height'])next[k]=o[k]+lo*(target[k]-o[k]);}}
   else {const box=bounds(zonePoints(o,{width:W,height:H})),dx=clamp(p.x-s.x,Math.max(-box.x,-o.x),Math.min(1-box.x-box.width,1-o.x-o.width)),dy=clamp(p.y-s.y,Math.max(-box.y,-o.y),Math.min(1-box.y-box.height,1-o.y-o.height));next.x=o.x+dx;next.y=o.y+dy;}
   Object.assign(z,anchorFrom(o,next));
  }
  else if(drag.kind==='node'){z.points=zonePoints(z).map((q,n)=>n===drag.node?p:q);Object.assign(z,bounds(z.points));}
  else if(drag.kind==='move'){z.x=clamp(o.x+p.x-s.x,0,1-o.width);z.y=clamp(o.y+p.y-s.y,0,1-o.height);z.defaultAnchorX=o.defaultAnchorX+z.x-o.x;z.defaultAnchorY=o.defaultAnchorY+z.y-o.y;if(z.shapeType==='POLYGON')z.points=zonePoints(o).map(q=>({x:q.x+z.x-o.x,y:q.y+z.y-o.y}));}
  else{let left=o.x,top=o.y,right=o.x+o.width,bottom=o.y+o.height;
   if(drag.kind.includes('w'))left=clamp(o.x+p.x-s.x,0,right-.001);else right=clamp(o.x+o.width+p.x-s.x,left+.001,1);
   if(drag.kind.includes('n'))top=clamp(o.y+p.y-s.y,0,bottom-.001);else bottom=clamp(o.y+o.height+p.y-s.y,top+.001,1);
   z.x=left;z.y=top;z.width=right-left;z.height=bottom-top;z.defaultAnchorX=left+(o.defaultAnchorX-o.x)/o.width*z.width;z.defaultAnchorY=top+(o.defaultAnchorY-o.y)/o.height*z.height;
  }
  if(drag.kind!=='create'&&automationUI?.transformed(z.id,beforeZone,z)===false)Object.assign(z,beforeZone);queueDraw();
 });
 function finish(cancel=false){if(!drag)return;if(cancel&&drag.kind!=='create')automationUI?.transformed(drag.z.id,drag.z,drag.original,true);
  if(cancel||drag.z.width<.003||drag.z.height<.003){if(drag.kind==='create'){zones=zones.filter(z=>z.id!==drag.z.id);selected=zones[0]?.id||null;}else Object.assign(drag.z,drag.original);state.dirty=drag.wasDirty;}
  else if(drag.kind==='create'||JSON.stringify(drag.z)!==JSON.stringify(drag.original)){if(drag.kind==='create'&&drag.z.zoneType==='logo'){try{automationUI.classifyZone(drag.z,drag.carrierType);}catch(e){zones=zones.filter(z=>z.id!==drag.z.id);selected=zones[0]?.id||null;drag=null;error(e);setMode('select');refresh();return;}}dirty();}
  drag=null;setMode('select');refresh();
 }
 canvas.addEventListener('pointerup',()=>finish());canvas.addEventListener('pointercancel',()=>finish(true));
 main.querySelector('#new-shape').onchange=()=>{pendingPoints=[];setMode(mode);draw();};main.querySelector('#select-zone').onclick=()=>{pendingPoints=[];setMode('select');draw();};main.querySelector('#add-logo').onclick=()=>setMode('logo');main.querySelector('#add-carton').onclick=()=>setMode('carton');
 function deleteZone(){if(readonly||drag||pendingPoints.length||!selected)return;if(automationUI?.removeZone(selected)===false)return;zones=zones.filter(z=>z.id!==selected);if(!zones.some(z=>z.zoneType==='logo'&&z.isDefault)){const next=zones.find(z=>z.zoneType==='logo');if(next)next.isDefault=true;}selected=null;dirty();refresh();}
 main.querySelector('#delete-zone').onclick=deleteZone;
 main.querySelector('#publish-top')?.addEventListener('click',async e=>{
  if(pendingPoints.length){error('请先点击起点闭合多边形，或选择移动模式取消路径');return;}
  const button=e.currentTarget;button.disabled=true;button.textContent='正在保存并发布…';main.querySelector('#template-error').hidden=true;
  try{
   automationUI?.assertReady();
   const result=await api('/api/templates/'+encodeURIComponent(productId),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({zones,automation:automationUI?.serialize()||null,baseVersion:payload.currentVersion,changeNote:payload.currentVersion?'更新母版':'首次发布'})});
   try{localStorage.removeItem(draftKey);}catch{}state.dirty=false;toast('Template V'+result.currentVersion+' 已发布');
   if(active===state){state.dispose();active=null;history.replaceState(null,'','#/templates/'+productId);await renderTemplate(main,productId,helpers);}
  }catch(e){error(e);button.disabled=false;button.textContent='保存 / 发布';main.querySelector('#template-error').scrollIntoView({block:'center'});}
 });
 const observer=new ResizeObserver(queueDraw);observer.observe(canvas);
 const source=new Image();source.onload=()=>{if(active!==state||!canvas.isConnected)return;W=imageSize.width;H=imageSize.height;canvas.setAttribute('viewBox',`0 0 ${W} ${H}`);canvas.setAttribute('width',W);canvas.setAttribute('height',H);const img=main.querySelector('#base-image');img.setAttribute('width',W);img.setAttribute('height',H);img.setAttribute('href',previewUrl);loaded=true;main.querySelector('#image-loading').hidden=true;draw();};source.onerror=()=>{if(active===state&&canvas.isConnected){main.querySelector('#image-loading').textContent='产品图加载失败，请刷新重试。';error('产品图加载失败，暂不能框选。');}};
 fetchPreview('/files/'+encodeURIComponent(payload.template?.standardImage||payload.product.standardImage)+'?preview=1',{signal:imageController.signal}).then(async response=>{
  if(!response.ok)throw Error('产品图加载失败');const width=Number(response.headers.get('X-Image-Width')),height=Number(response.headers.get('X-Image-Height'));if(!(width>0&&height>0))throw Error('产品图尺寸无法读取');
  const blob=await response.blob();if(active!==state||!canvas.isConnected)return;imageSize={width,height};previewUrl=URL.createObjectURL(blob);source.src=previewUrl;
 }).catch(error=>{if(error.name!=='AbortError')source.onerror();});
 automationUI=mountTemplateAutomation({main,canvas,readonly,reject:error,zones:()=>zones,selected:()=>selected,image:()=>({width:W,height:H}),dirty,refresh,deleteZone,signal:imageController.signal,selectMode:()=>{pendingPoints=[];setMode('select');draw();}},automationInitial);
 setMode('select');refresh();if(restored)main.querySelector('#template-status').textContent='已恢复本机草稿 · 尚未发布';
}

