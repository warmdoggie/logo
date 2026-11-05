import {transformPlacement} from './placement-transform.js';
import {placementRotation} from './auto-placement.js';
import {zonePoints,containsPolygon,polygonOverlap,pointInside} from './zone-geometry.js';
const uid=()=>crypto.randomUUID();
const foilProcesses=[['GOLD FOIL','烫金'],['SILVER FOIL','烫银'],['ROSE GOLD FOIL','烫玫瑰金'],['LASER FOIL','烫镭射']];
export function mountTemplateAutomation(ctx,initial){
 const {main,canvas,readonly}=ctx;let config=structuredClone(initial||{version:1,carriers:[],areas:[],schemes:[]}),drawing=false,drawingBackup=null,drawingOrientation=null,presetId=null,frameSelected=false,drag=null;
 config.areas.forEach(a=>{a.zoneRef=a.zoneRef||ctx.zones()[a.zoneIndex]?.id;a.foilProcesses=a.foilProcesses||[];});
 const panel=document.createElement('section');panel.className='panel';main.querySelector('.template-properties').append(panel);
 const layer=document.createElementNS('http://www.w3.org/2000/svg','g');canvas.append(layer);
 function area(){return config.areas.find(a=>a.zoneRef===ctx.selected());}
 function carrierType(zoneId){const a=config.areas.find(a=>a.zoneRef===zoneId);return config.carriers.find(c=>c.id===a?.carrierId)?.type;}
 function classifyZone(z,type){
  let a=config.areas.find(a=>a.zoneRef===z.id),box;
  if(!a){
   const image=ctx.image(),poly=zonePoints(z,image),centers=[{x:z.defaultAnchorX,y:z.defaultAnchorY},{x:z.x+z.width/2,y:z.y+z.height/2}];
   for(let y=1;y<10;y++)for(let x=1;x<10;x++)centers.push({x:z.x+z.width*x/10,y:z.y+z.height*y/10});
   for(let scale=.4;scale*z.width>=.001&&scale*z.height>=.001&&!box;scale/=2){
    const edgeCenters=[],inset=Math.hypot(z.width*scale,z.height*scale)/2;
    for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],length=Math.hypot(b.x-a.x,b.y-a.y);if(!length)continue;for(const sign of [-1,1])edgeCenters.push({x:(a.x+b.x)/2-sign*(b.y-a.y)*inset/length,y:(a.y+b.y)/2+sign*(b.x-a.x)*inset/length});}
    for(const center of [...centers,...edgeCenters]){const candidate={centerX:center.x,centerY:center.y,width:z.width*scale,height:z.height*scale,rotation:z.rotation||0},points=zonePoints({shapeType:'ROTATED_RECT',x:center.x-candidate.width/2,y:center.y-candidate.height/2,width:candidate.width,height:candidate.height,rotation:candidate.rotation},image);
     if(containsPolygon(poly,points)&&!ctx.zones().some(n=>n.zoneType==='no-logo'&&polygonOverlap(points,zonePoints(n,image)))){box=candidate;break;}
    }
   }
   if(!box)throw Error('当前区域过窄或被禁止区域覆盖，无法建立默认摆放框，请调整区域后重试');
  }
  let carrier=config.carriers.find(c=>c.type===type);
  if(!carrier){carrier={id:uid(),type,name:{BODY:'产品本体',CAP:'盖子',CARTON:'彩盒',OTHER:'其他载体'}[type]};config.carriers.push(carrier);}
  if(a)a.carrierId=carrier.id;
  else config.areas.push({id:uid(),zoneRef:z.id,carrierId:carrier.id,name:z.name,autoEligible:false,foilProcesses:[],presets:[{id:uid(),name:'默认摆放',orientation:box.rotation?'custom':'horizontal',isDefault:true,box}]});
 }
 function preset(){const a=area();return a?.presets.find(p=>p.id===presetId)||a?.presets.find(p=>p.isDefault);}
 function selectPreset(id){presetId=id;const a=area();if(!readonly&&a.presets.some(p=>p.isDefault&&p.id!==id)){a.presets.forEach(p=>p.isDefault=p.id===id);ctx.dirty();}}
 function serialize(){const saved=drawingBackup||config;for(const s of saved.schemes)for(const t of s.targets)if(!saved.areas.some(a=>a.id===t.areaId&&ctx.zones().some(z=>z.id===a.zoneRef)&&a.presets.some(p=>p.id===t.presetId)))throw Error('方案 '+s.name+' 存在已删除的区域或预设，请先修正引用');const areas=saved.areas.filter(a=>ctx.zones().some(z=>z.id===a.zoneRef)).map(a=>({...a,zoneIndex:ctx.zones().findIndex(z=>z.id===a.zoneRef)}));return {...saved,areas};}
 const change=()=>{if(!drawingBackup)ctx.dirty();draw();};
 function cancelDrawing(){if(drawingBackup){config=drawingBackup;drawingBackup=null;}drawing=false;drawingOrientation=null;drag=null;ctx.refresh();}
 function valid(b){const image=ctx.image(),z=ctx.zones().find(z=>z.id===ctx.selected());if(!z||b.width<.001||b.height<.001)return false;const poly=zonePoints({shapeType:'ROTATED_RECT',x:b.centerX-b.width/2,y:b.centerY-b.height/2,width:b.width,height:b.height,rotation:b.rotation},image);return containsPolygon(zonePoints(z,image),poly)&&!ctx.zones().some(n=>n.zoneType==='no-logo'&&polygonOverlap(poly,zonePoints(n,image)));}
 function placementFrame(p,index,b=p.box,preview=false){
  const {width:W,height:H}=ctx.image(),pts=zonePoints({shapeType:'ROTATED_RECT',x:b.centerX-b.width/2,y:b.centerY-b.height/2,width:b.width,height:b.height,rotation:b.rotation},{width:W,height:H}),scale=W/(canvas.getBoundingClientRect().width||W),r=b.rotation*Math.PI/180,active=!preview&&frameSelected&&p.id===preset()?.id;
  const direction=placementRotation(ctx.zones().find(z=>z.id===ctx.selected()),{...p,box:b},{width:W,height:H})*Math.PI/180,relative=direction-r,length=.3/Math.max(Math.abs(Math.cos(relative))/(b.width*W),Math.abs(Math.sin(relative))/(b.height*H)),cx=b.centerX*W,cy=b.centerY*H,dx=Math.cos(direction)*length,dy=Math.sin(direction)*length,tipX=cx+dx,tipY=cy+dy,head=5*scale;
  const arrow=`<path data-placement-direction="${p.orientation}" pointer-events="none" d="M${cx-dx},${cy-dy} L${tipX},${tipY} M${tipX-head*Math.cos(direction-.6)},${tipY-head*Math.sin(direction-.6)} L${tipX},${tipY} L${tipX-head*Math.cos(direction+.6)},${tipY-head*Math.sin(direction+.6)}" fill="none" stroke="#08785c" stroke-width="${1.5*scale}"/>`;
  return `<g ${preview?'data-placement-preview':`data-placement-frame="${p.id}"`} class="${active?'placement-selected':''}"><polygon data-placement="move" data-placement-id="${p.id}" points="${pts.map(q=>q.x*W+','+q.y*H).join(' ')}" fill="${active?'#10b98122':'#10b9810d'}" stroke="${valid(b)?active?'#08916b':'#6eac94':'#e04545'}" stroke-width="${(active?2.5:1.5)*scale}" pointer-events="${!drawing?'all':'none'}"/><text x="${b.centerX*W+6*scale}" y="${b.centerY*H-6*scale}" font-size="${12*scale}" fill="#08785c" pointer-events="none">${preview?'新位置':'位置 '+(index+1)}${p.orientation==='vertical'?' · 竖排':p.orientation==='horizontal'?' · 横排':''}</text>${arrow}${active&&!readonly&&!drawing?pts.map((q,i)=>`<rect data-placement="${i}" data-placement-id="${p.id}" x="${q.x*W-5*scale}" y="${q.y*H-5*scale}" width="${10*scale}" height="${10*scale}" fill="white" stroke="#08916b" stroke-width="${2*scale}"/>`).join(''):''}</g>`;
 }
 function draw(){
  layer.replaceChildren();const a=area(),p=preset();if(!a)return;
  const positions=a.presets.map((p,index)=>({p,index})).sort((a,b)=>Number(a.p.id===p?.id)-Number(b.p.id===p?.id));
  layer.innerHTML=positions.map(({p,index})=>placementFrame(p,index)).join('')+(drag?.kind==='create'?placementFrame({id:'preview',orientation:drawingOrientation},-1,drag.preview,true):'');
 }
 function render(){
  const z=ctx.zones().find(z=>z.id===ctx.selected()),a=area(),p=preset(),orientation=drawing?drawingOrientation:p?.orientation;
  const type=carrierType(z?.id)||(/彩盒|纸盒|carton/i.test(z?.name||'')?'CARTON':'BODY');
  const processes=z?.zoneType==='logo'?`<fieldset ${readonly||drawing?'disabled':''}><h3>区域工艺</h3><label for="area-carrier-type">区域类型</label><select id="area-carrier-type">${['CAP','OTHER'].includes(type)?`<option value="${type}" selected>产品（${type==='CAP'?'盖子':'其他载体'}）</option>`:''}<option value="BODY" ${type==='BODY'?'selected':''}>产品</option><option value="CARTON" ${type==='CARTON'?'selected':''}>彩盒</option></select>${type==='CARTON'?'<p class="hint">彩盒不建议烫印，业务员知晓后可继续</p>':`<p class="hint">允许的烫印工艺（未勾选则不可使用）</p>${foilProcesses.map(([value,label],i)=>`<label class="checkbox-label"><input type="checkbox" id="area-foil-${i}" ${a?.foilProcesses.includes(value)?'checked':''}>${label}</label>`).join('')}`}</fieldset>`:'';
  panel.innerHTML=`<div class="panel-head"><h2>摆放设置 <span class="count">${a?.presets.length||0} 个位置</span></h2></div><div class="panel-body">${processes}<fieldset ${readonly?'disabled':''}><button type="button" class="btn" id="add-placement" ${z?.zoneType==='logo'&&(!a||a.presets.length<10)?'':'disabled'}>＋ 新增摆放位置</button><label for="auto-orientation">摆放方向</label><select id="auto-orientation" ${p||drawing?'':'disabled'}>${p&&!['horizontal','vertical'].includes(orientation)?`<option value="${orientation}" selected disabled>保持原有方向</option>`:''}<option value="horizontal" ${orientation==='horizontal'?'selected':''}>横排 →</option><option value="vertical" ${orientation==='vertical'?'selected':''}>竖排 ↓</option></select></fieldset><p class="hint">${drawing?'在图上拖出摆放位置；按 Esc 取消。':z?.zoneType==='logo'?'点击框选择位置，拖动或拖四角调整；按 Backspace 删除选中框；方向只改变 Logo 朝向。'+(a?.presets.length>1?'重叠时按 Shift 点击切换。':''):'先点击图中的产品或彩盒区域，再设置 Logo 摆放位置。'}</p></div>`;
  panel.querySelector('#area-carrier-type')?.addEventListener('change',e=>{
   if(readonly||drawing||z?.zoneType!=='logo'||!['BODY','CARTON'].includes(e.target.value))return;
   try{classifyZone(z,e.target.value);change();render();}catch(e){ctx.reject(e);}
  });
  for(const [i,[value]] of foilProcesses.entries())panel.querySelector('#area-foil-'+i)?.addEventListener('change',e=>{
   if(readonly||drawing||z?.zoneType!=='logo'||type==='CARTON')return;
   try{if(!area())classifyZone(z,type);const a=area();a.foilProcesses=foilProcesses.map(([v])=>v).filter(v=>v===value?e.target.checked:a.foilProcesses.includes(v));change();render();}catch(e){ctx.reject(e);}
  });
  panel.querySelector('#add-placement')?.addEventListener('click',()=>{
   if(!z||readonly||a?.presets.length>=10)return;
   try{if(!area()){drawingBackup=structuredClone(config);classifyZone(z,/彩盒|纸盒|carton/i.test(z.name||'')?'CARTON':'BODY');}ctx.selectMode();drawingOrientation=['horizontal','vertical'].includes(preset()?.orientation)?preset().orientation:'horizontal';drawing=true;canvas.setAttribute('tabindex','0');canvas.focus();ctx.refresh();}catch(e){cancelDrawing();ctx.reject(e);}
  });
  panel.querySelector('#auto-orientation')?.addEventListener('change',e=>{if(readonly)return;if(drawing){drawingOrientation=e.target.value;draw();return;}if(!p)return;p.orientation=e.target.value;change();render();});
  canvas.classList.toggle('placement-drawing',!!drawing);draw();
 }
 const point=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};};
 canvas.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  canvas.setAttribute('tabindex','0');canvas.focus();
  if(e.altKey){frameSelected=false;if(drawing)cancelDrawing();return;}
  if(!drawing&&!preset()){frameSelected=false;return;}
  if(drawing){if(readonly)return;e.stopImmediatePropagation();e.preventDefault();const q=point(e);drag={kind:'create',start:q,preview:{centerX:q.x,centerY:q.y,width:.001,height:.001,rotation:0}};}
  else{
   const id=e.target.dataset.placementId,kind=e.target.dataset.placement;if(!area().presets.some(p=>p.id===id)||kind===undefined){frameSelected=false;return;}
   frameSelected=true;
   e.stopImmediatePropagation();e.preventDefault();
   if(e.shiftKey){const image=ctx.image(),q=point(e),hits=area().presets.filter(p=>pointInside(q,zonePoints({shapeType:'ROTATED_RECT',x:p.box.centerX-p.box.width/2,y:p.box.centerY-p.box.height/2,width:p.box.width,height:p.box.height,rotation:p.box.rotation},image))).reverse(),index=hits.findIndex(p=>p.id===preset().id);if(hits.length)selectPreset(hits[(index+1)%hits.length].id);render();return;}
   selectPreset(id);if(readonly){render();return;}
   drag={kind,start:point(e),box:structuredClone(preset().box),preset:preset()};render();
  }
  canvas.setPointerCapture(e.pointerId);
 },true);
 canvas.addEventListener('pointermove',e=>{
  if(!drag)return;e.stopImmediatePropagation();const q=point(e);
  if(drag.kind==='create'){drag.preview={centerX:(q.x+drag.start.x)/2,centerY:(q.y+drag.start.y)/2,width:Math.max(.001,Math.abs(q.x-drag.start.x)),height:Math.max(.001,Math.abs(q.y-drag.start.y)),rotation:0};draw();return;}
  const o=drag.box,b={...o},{width:W,height:H}=ctx.image(),r=o.rotation*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  if(drag.kind==='move'){b.centerX+=q.x-drag.start.x;b.centerY+=q.y-drag.start.y;}
  else{const n=Number(drag.kind),sx=[-1,1,1,-1][n],sy=[-1,-1,1,1][n],fixed={x:o.centerX*W-(sx*o.width*W*c-sy*o.height*H*s)/2,y:o.centerY*H-(sx*o.width*W*s+sy*o.height*H*c)/2},dx=q.x*W-fixed.x,dy=q.y*H-fixed.y,w=Math.max(.001*W,sx*(dx*c+dy*s)),h=Math.max(.001*H,sy*(-dx*s+dy*c));b.width=w/W;b.height=h/H;b.centerX=(fixed.x+(sx*w*c-sy*h*s)/2)/W;b.centerY=(fixed.y+(sx*w*s+sy*h*c)/2)/H;}
  if(valid(b)){drag.preset.box=b;draw();}
 },true);
 const end=e=>{
  if(!drag)return;e.stopImmediatePropagation();
  if(drag.kind==='create'){
   if(e.type==='pointercancel'){cancelDrawing();return;}
   if(drag.preview.width<.003||drag.preview.height<.003||!valid(drag.preview)){drag=null;ctx.reject('摆放位置需要位于当前区域内，且不能覆盖禁止区域');render();return;}
   const a=area();let p;
   if(drawingBackup){p=preset();p.box=drag.preview;p.orientation=drawingOrientation;}
   else{p={id:uid(),name:'摆放位置 '+(a.presets.length+1),box:drag.preview,orientation:drawingOrientation,isDefault:false};a.presets.push(p);}
   a.presets.forEach(v=>v.isDefault=v.id===p.id);presetId=p.id;frameSelected=true;drawing=false;drawingBackup=null;drawingOrientation=null;
  }else if(e.type==='pointercancel'){drag.preset.box=drag.box;drag=null;render();return;}
  if(drag.kind!=='create'&&JSON.stringify(drag.preset.box)===JSON.stringify(drag.box)){drag=null;render();return;}
  drag=null;change();render();
 };
 canvas.addEventListener('pointerup',end,true);canvas.addEventListener('pointercancel',end,true);
 main.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&drawing){e.preventDefault();cancelDrawing();return;}
  if(e.key!=='Backspace'||e.target!==canvas||readonly||e.ctrlKey||e.metaKey||e.altKey||e.isComposing)return;
  e.preventDefault();if(e.repeat||drawing||drag)return;
  if(!frameSelected){ctx.deleteZone();return;}
  const a=area(),p=preset();if(!a||!p)return;
  a.presets=a.presets.filter(v=>v!==p);presetId=(a.presets.find(v=>v.isDefault)||a.presets[0])?.id||null;
  a.presets.forEach(v=>v.isDefault=v.id===presetId);removeTargets(t=>t.areaId===a.id&&t.presetId===p.id);change();render();
 },{signal:ctx.signal});
 function moved(zoneId,dx,dy){const a=config.areas.find(a=>a.zoneRef===zoneId);if(a)for(const p of a.presets){p.box.centerX+=dx;p.box.centerY+=dy;}}
 function transformed(zoneId,before,after,force=false){const a=config.areas.find(a=>a.zoneRef===zoneId);if(!a)return true;const image=ctx.image();const proposals=a.presets.map(p=>({p,box:transformPlacement(p.box,before,after,image)}));if(!force&&proposals.some(({box})=>{const poly=zonePoints({shapeType:'ROTATED_RECT',x:box.centerX-box.width/2,y:box.centerY-box.height/2,width:box.width,height:box.height,rotation:box.rotation},image);return !containsPolygon(zonePoints(after,image),poly)||ctx.zones().some(n=>n.zoneType==='no-logo'&&polygonOverlap(poly,zonePoints(n,image)));})){ctx.reject('调整后默认框越界或碰到禁区，请先调整默认框');return false;}for(const {p,box} of proposals){p.box=box;if(Math.abs((after.rotation||0)-(before.rotation||0))>1e-8&&['horizontal','vertical'].includes(p.orientation))p.orientation='custom';}return true;}
 function removeTargets(matches){config.schemes.forEach(s=>s.targets=s.targets.filter(t=>!matches(t)));config.schemes=config.schemes.filter(s=>s.targets.length);if(config.schemes.length&&!config.schemes.some(s=>s.role==='DEFAULT'))config.schemes[0].role='DEFAULT';}
 function removeZone(zoneId){if(drawing)cancelDrawing();const a=config.areas.find(a=>a.zoneRef===zoneId);if(!a)return true;removeTargets(t=>t.areaId===a.id);config.areas=config.areas.filter(v=>v!==a);return true;}
 return {render,draw,serialize,assertReady(){if(drawing)throw Error('请先完成摆放位置框选，或按 Esc 取消后再保存');},moved,transformed,removeZone,classifyZone,carrierType};
}
