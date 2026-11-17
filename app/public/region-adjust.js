import {usesFoil,ordinaryProcess} from './foil-targets.js';
import {openColorPanel} from './color-panel.js';
import {autoPlace} from './auto-placement.js';
import {validateManualPlacement} from './manual-placement.js';
import {corners} from './mockup-geometry.js';
import {zonePoints} from './zone-geometry.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const src=p=>'/files/'+encodeURIComponent(p);

export function changeRegionProcess(override,process,effectiveAppearance,printing,foil){
 const next=structuredClone(override);delete next.cartonFoilConfirmed;
 if(!process){delete next.process;delete next.appearance;return next;}
 next.process=process;
 if(process==='HOT_STAMP')next.appearance={mode:'FOIL',foil:effectiveAppearance?.mode==='FOIL'?effectiveAppearance.foil:foil||'GOLD'};
 else if(effectiveAppearance?.mode==='FOIL')next.appearance={mode:'SOLID',hex:printing.ink==='WHITE'?'#ffffff':'#000000'};
 return next;
}
export function changeRegionAppearance(override,mode,effectiveProcess,printing,foil){
 const next=structuredClone(override);delete next.cartonFoilConfirmed;
 if(mode==='DEFAULT'){delete next.appearance;delete next.process;return next;}
 next.appearance=mode==='ORIGINAL'?{mode}:mode==='SOLID'?{mode,hex:printing.ink==='WHITE'?'#ffffff':'#000000'}:{mode:'FOIL',foil:foil||'GOLD'};
 if(mode==='FOIL')next.process='HOT_STAMP';
 else if(effectiveProcess==='HOT_STAMP'){
  const ordinary=printing.defaultProcess!=='HOT_STAMP'?printing.defaultProcess:printing.allowed.find(p=>p!=='HOT_STAMP');
  if(!ordinary)throw Error('该区域未配置可用油墨工艺，请联系设计师或印刷车间确认');
  next.process=ordinary;
 }
 return next;
}

export async function openRegionAdjust({item,output,logo,draft,methods,foils}){
 if(!logo)throw Error('请先点击开始做图，完成 Logo 处理后再调整位置。');
 const img=new Image();img.src=src(item.standardImage);await img.decode();const image={width:img.naturalWidth,height:img.naturalHeight},key=item.id+':'+output.kind,areas=structuredClone(draft.overrides[key]?.areas||{}),placements={},reset=new Set();
 const defaults=t=>autoPlace({...t.zone,maxLogoWidthRatio:1,maxLogoHeightRatio:1},t.preset,item.zones,image,logo);
 for(const t of item.targets)placements[t.area.id]=areas[t.area.id]?.placement||output.snapshot?.targets?.find(v=>v.areaId===t.area.id)?.placement||defaults(t);
 let selected=item.targets[0]?.area.id,gesture=null;
 return new Promise(resolve=>{
  const d=document.createElement('dialog');d.className='sales-adjust regional-adjust';d.style.cssText='width:min(1240px,96vw);max-width:96vw';d.setAttribute('aria-label','调整这张图');
  d.innerHTML='<h2>调整这张图 · '+esc(item.sku)+'</h2><div class="regional-adjust-layout"><svg data-canvas viewBox="0 0 '+image.width+' '+image.height+'"></svg><form><label>调整区域<select name="area">'+item.targets.map(t=>'<option value="'+t.area.id+'">'+(t.carrier.type==='CARTON'?'彩盒':'产品')+' · '+esc(t.area.name)+'</option>').join('')+'</select></label><label>印刷工艺<select name="process"></select></label><label>Logo 效果<select name="mode"><option value="DEFAULT">使用默认设置</option><option value="ORIGINAL">Logo 原色</option><option value="SOLID">单色油墨</option><option value="FOIL">烫印</option></select></label><div data-color></div><label>旋转角度 °<input name="rotation" type="number" min="-180" max="180" step="any"></label><label>图片宽度占比 %<input name="width" type="number" min="0.01" max="150" step="any"></label><p class="hint">拖动 Logo 移动，方点等比缩放，圆点旋转。可以超出蓝框，仍须避开红色禁区。</p><label class="manage-check"><input type="checkbox" name="sync">同步本图同类区域</label><button type="button" class="btn" data-reset>恢复当前区域默认</button><p role="alert" class="error"></p><footer><button class="btn" type="button" data-cancel>取消</button><button class="btn primary" type="submit">保存调整</button></footer></form></div>';
  document.body.append(d);const form=d.querySelector('form'),svg=d.querySelector('svg'),err=d.querySelector('[role=alert]'),q=s=>d.querySelector(s),target=()=>item.targets.find(t=>t.area.id===selected),current=()=>areas[selected]||{},ensure=()=>areas[selected]||= {};
  const close=value=>{d.close();d.remove();resolve(value);};q('[data-cancel]').onclick=()=>close(null);d.addEventListener('cancel',e=>{e.preventDefault();close(null);});
  function viewAppearance(t){
   const saved=areas[t.area.id]?.appearance;if(saved)return saved;
   if(usesFoil(t,output.kind,draft,item.targets))return {mode:'FOIL',foil:draft.foil};
   if(t.carrier.type!=='CARTON')return output.kind==='INK'?{mode:'SOLID',hex:t.area.printing.ink==='WHITE'?'#ffffff':'#000000'}:{mode:'ORIGINAL'};
   const products=item.targets.filter(v=>v.carrier.type!=='CARTON').map(viewAppearance),same=products.length&&products.every(a=>JSON.stringify(a)===JSON.stringify(products[0]));
   if(same&&products[0].mode!=='FOIL')return products[0];
   return (!reset.has(t.area.id)&&output.snapshot?.targets?.find(v=>v.areaId===t.area.id)?.appearance)||{mode:'SOLID',hex:'#000000'};
  }
  const effectiveProcess=t=>areas[t.area.id]?.process||(usesFoil(t,output.kind,draft,item.targets)?'HOT_STAMP':output.kind==='FOIL'?ordinaryProcess(t.area.printing):t.area.printing.defaultProcess);
  const tint=t=>{const a=viewAppearance(t);return a.mode==='SOLID'?a.hex:a.mode==='FOIL'?foils[a.foil]?.hex:null;};
  function draw(){
   const scale=image.width/(svg.getBoundingClientRect().width||image.width),t=target(),p=placements[selected],pts=corners(p,image,logo),w=p.widthRatio*image.width,h=w*logo.height/logo.width;
   const appearance=viewAppearance(t);
   const color=appearance?.mode==='SOLID'?appearance.hex:appearance?.mode==='FOIL'?foils[appearance.foil]?.hex:null;
   svg.innerHTML='<defs>'+item.targets.map((v,i)=>'<filter id="region-tint-'+i+'"><feFlood flood-color="'+(tint(v)||'#000000')+'"/><feComposite in2="SourceAlpha" operator="in"/></filter>').join('')+'</defs><image href="'+src(item.standardImage)+'" width="'+image.width+'" height="'+image.height+'"/>'+item.zones.map(z=>'<polygon points="'+zonePoints(z,image).map(p=>p.x*image.width+','+p.y*image.height).join(' ')+'" fill="none" stroke="'+(z.zoneType==='no-logo'?'#c02b3e':'#254bd8')+'" stroke-width="'+scale+'" stroke-dasharray="'+(z.zoneType==='no-logo'?'6 3':'2 3')+'"/>').join('')+item.targets.map((v,i)=>{const p=placements[v.area.id],width=p.widthRatio*image.width,height=width*logo.height/logo.width;return '<g transform="translate('+p.x*image.width+' '+p.y*image.height+') rotate('+p.rotation+')"><image data-region="'+v.area.id+'" data-action="move" href="'+src(logo.filePath)+'" x="'+(-width/2)+'" y="'+(-height/2)+'" width="'+width+'" height="'+height+'" '+(tint(v)?'filter="url(#region-tint-'+i+')"':'')+'/></g>';}).join('')+
    '<polygon data-action="move" points="'+pts.map(p=>p.x*image.width+','+p.y*image.height).join(' ')+'" fill="transparent" stroke="#254bd8" stroke-width="'+2*scale+'"/><rect data-action="scale" x="'+(pts[2].x*image.width-6*scale)+'" y="'+(pts[2].y*image.height-6*scale)+'" width="'+12*scale+'" height="'+12*scale+'" fill="white" stroke="#254bd8"/><circle data-action="rotate" cx="'+((pts[0].x+pts[1].x)/2*image.width)+'" cy="'+((pts[0].y+pts[1].y)/2*image.height-24*scale)+'" r="'+7*scale+'" fill="#254bd8"/>';
   form.elements.rotation.value=Math.round(p.rotation*100)/100;form.elements.width.value=Math.round(p.widthRatio*10000)/100;
  }
  function controls(){const t=target(),o=current(),carton=t.carrier.type==='CARTON';form.elements.area.value=selected;form.elements.process.innerHTML='<option value="">方案默认（'+esc(methods[usesFoil(t,output.kind,draft,item.targets)?'HOT_STAMP':output.kind==='FOIL'?ordinaryProcess(t.area.printing):t.area.printing.defaultProcess]||'未设置')+'）</option>'+Object.entries(methods).map(([k,n])=>'<option value="'+k+'">'+n+(!t.area.printing.allowed.includes(k)&&!(carton&&k==='HOT_STAMP')?'（不支持）':'')+'</option>').join('');form.elements.process.value=o.process||'';form.elements.mode.value=o.appearance?.mode||'DEFAULT';const color=q('[data-color]');color.innerHTML='';if(o.appearance?.mode==='SOLID'){const b=document.createElement('button');b.type='button';b.className='btn';b.textContent='调色板 · '+o.appearance.hex;b.onclick=()=>openColorPanel(o.appearance.hex,'当前区域 Logo 颜色',hex=>{ensure().appearance={mode:'SOLID',hex};controls();draw();});color.append(b);}else if(o.appearance?.mode==='FOIL'){const select=document.createElement('select');select.setAttribute('aria-label','烫印颜色');Object.entries(foils).forEach(([k,f])=>select.add(new Option(f.name,k)));select.value=o.appearance.foil;select.onchange=()=>{ensure().appearance.foil=select.value;delete ensure().cartonFoilConfirmed;draw();};color.append(select);}}
  form.elements.area.onchange=()=>{selected=form.elements.area.value;controls();draw();};
  form.elements.process.onchange=()=>{areas[selected]=changeRegionProcess(current(),form.elements.process.value,viewAppearance(target()),target().area.printing,draft.foil);err.textContent='';controls();draw();};
  form.elements.mode.onchange=()=>{try{areas[selected]=changeRegionAppearance(current(),form.elements.mode.value,effectiveProcess(target()),target().area.printing,draft.foil);err.textContent='';}catch(e){err.textContent=e.message;}controls();draw();};
  function place(p){const errors=validateManualPlacement(p,item.zones,image,logo);err.textContent=errors.join('；');if(errors.length)return;placements[selected]=p;ensure().placement={...p};draw();}
  form.elements.rotation.oninput=()=>place({...placements[selected],rotation:Number(form.elements.rotation.value)});form.elements.width.oninput=()=>place({...placements[selected],widthRatio:Number(form.elements.width.value)/100});q('[data-reset]').onclick=()=>{delete areas[selected];reset.add(selected);placements[selected]=defaults(target());controls();draw();};
  const point=e=>{const r=svg.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};};svg.onpointerdown=e=>{const action=e.target.dataset.action;if(!action||e.button!==0)return;if(e.target.dataset.region)selected=e.target.dataset.region;gesture={action,start:point(e),p:{...placements[selected]},override:structuredClone(areas[selected])};svg.setPointerCapture(e.pointerId);e.preventDefault();controls();};
  svg.onpointermove=e=>{if(!gesture)return;const q=point(e),g=gesture,p={...g.p},angle=q=>Math.atan2((q.y-g.p.y)*image.height,(q.x-g.p.x)*image.width),distance=q=>Math.hypot((q.x-g.p.x)*image.width,(q.y-g.p.y)*image.height);if(g.action==='move'){p.x+=q.x-g.start.x;p.y+=q.y-g.start.y;}else if(g.action==='scale')p.widthRatio*=distance(q)/Math.max(1,distance(g.start));else {p.rotation=((p.rotation+(angle(q)-angle(g.start))*180/Math.PI+540)%360)-180;const snap=Math.round(p.rotation/45)*45;if(Math.abs(p.rotation-snap)<3)p.rotation=snap;}place(p);};svg.onpointerup=()=>gesture=null;svg.onpointercancel=()=>{if(gesture){placements[selected]=gesture.p;if(gesture.override)areas[selected]=gesture.override;else delete areas[selected];gesture=null;draw();}};
  form.onsubmit=e=>{e.preventDefault();const proposed=structuredClone(areas);if(form.elements.sync.checked){const source=target(),value=current(),old=output.snapshot?.targets?.find(t=>t.areaId===selected)?.placement||defaults(source);for(const t of item.targets.filter(t=>t.area.id!==selected&&(t.carrier.type==='CARTON')===(source.carrier.type==='CARTON'))){const copy=structuredClone(value);if(copy.placement){const base=placements[t.area.id];copy.placement={...base,x:base.x+copy.placement.x-old.x,y:base.y+copy.placement.y-old.y,widthRatio:copy.placement.widthRatio,rotation:copy.placement.rotation};}proposed[t.area.id]=copy;}}
   for(const t of item.targets){const o=proposed[t.area.id];if(!o)continue;if(o.process&&!t.area.printing.allowed.includes(o.process)&&!(t.carrier.type==='CARTON'&&o.process==='HOT_STAMP')){err.textContent=t.area.name+' 不支持该工艺，请联系设计师或印刷车间确认';return;}if(o.placement){const errors=validateManualPlacement(o.placement,item.zones,image,logo);if(errors.length){err.textContent=t.area.name+'：'+errors.join('；');return;}}}close(proposed);};d.showModal();controls();draw();
 });
}

