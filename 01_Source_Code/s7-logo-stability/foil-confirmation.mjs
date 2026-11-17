import {foilVersions} from './foil-finishes.mjs';
import {allowedFoilVersions} from './foil-selection.mjs';

export function mountFoilConfirmation(dialog){
 const title=dialog.querySelector('[data-foil-title]'),messages=dialog.querySelector('[data-foil-messages]'),notice=dialog.querySelector('[data-foil-notice]'),cancel=dialog.querySelector('[data-foil-cancel]'),proceed=dialog.querySelector('[data-foil-continue]');
 return report=>new Promise(resolve=>{
  const blocked=report.blocked.length>0;
  title.textContent=blocked?'产品不支持所选烫印工艺':'彩盒不建议烫印';
  notice.hidden=blocked;messages.hidden=!blocked;
  messages.textContent=blocked?[...report.blocked,...report.warnings].map(item=>item.message).join('\n'):'';
  proceed.hidden=blocked;
  const finish=value=>{dialog.close();resolve(value);};
  cancel.onclick=()=>finish(false);proceed.onclick=()=>finish(!blocked);
  dialog.oncancel=event=>{event.preventDefault();finish(false);};
  dialog.showModal();
 });
}

export function mountPrintCombinationDialog(dialog){
 const product=dialog.querySelector('[data-combination-product]'),carton=dialog.querySelector('[data-combination-carton]'),cancel=dialog.querySelector('[data-combination-cancel]'),confirm=dialog.querySelector('[data-combination-confirm]'),error=dialog.querySelector('[data-combination-error]'),warning=dialog.querySelector('[data-combination-warning]'),rule=dialog.querySelector('[data-combination-rule]');
 return templates=>new Promise(resolve=>{
  const allowed={product:allowedFoilVersions(templates,['product']),carton:allowedFoilVersions(templates,['carton'])};
  for(const [group,select]of [['product',product],['carton',carton]]){select.value='ORIGINAL';for(const option of select.options)option.disabled=foilVersions.includes(option.value)&&!allowed[group].includes(option.value);}
  rule.textContent=allowed.product.length?'产品仅可选择当前 SKU 母版允许的烫印工艺，其他 SKU 单独设置。':'所选产品母版未开放产品烫印，仍可选择普通印刷。';error.textContent='';
  const update=()=>{warning.hidden=!foilVersions.includes(carton.value);error.textContent='';};product.onchange=update;carton.onchange=update;update();
  const finish=value=>{dialog.close();resolve(value);};
  cancel.onclick=()=>finish(null);dialog.oncancel=event=>{event.preventDefault();finish(null);};
  confirm.onclick=()=>{
   for(const select of [product,carton])if(![...select.options].some(option=>option.value===select.value&&!option.disabled)){error.textContent='所选母版不支持此工艺，请重新选择。';return;}
   finish({product:product.value,carton:carton.value});
  };
  dialog.showModal();
 });
}

export function closePrintMenus(){
  for(const menu of document.querySelectorAll('.print-select-menu:not([hidden])')){
    menu.hidden=true;menu.parentElement.querySelector('.print-select-trigger').setAttribute('aria-expanded','false');
  }
}
export function createPrintDropdown(select,onOpen){
  const wrapper=select.parentElement;wrapper.classList.add('print-select');
  const label=wrapper.firstChild.textContent.trim();select.hidden=true;
  const trigger=document.createElement('button');trigger.type='button';trigger.className='print-select-trigger';
  trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
  const menu=document.createElement('div');menu.className='print-select-menu';menu.hidden=true;
  menu.id=select.id?`print-options-${select.id}`:`print-options-${select.closest('.target-row').dataset.targetId}-${select.dataset.key}`;
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
  function open(){
    const dialog=select.closest('dialog');
    closePrintMenus();onOpen();refresh();
    if(dialog)Object.assign(menu.style,{position:'fixed',top:'0',left:'0',right:'auto'});
    menu.hidden=false;trigger.setAttribute('aria-expanded','true');
    if(dialog){
      const rect=trigger.getBoundingClientRect(),box=dialog.getBoundingClientRect(),below=box.bottom-rect.bottom-12,above=rect.top-box.top-12;
      Object.assign(menu.style,{position:'fixed',left:rect.left+'px',right:'auto',width:rect.width+'px',minWidth:'0',maxWidth:'none',maxHeight:Math.max(80,Math.min(260,Math.max(below,above)-6))+'px',overflowY:'auto'});
      const height=menu.getBoundingClientRect().height;
      menu.style.top=(below>=height+6||below>=above?rect.bottom+6:rect.top-height-6)+'px';
    }
  }
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
