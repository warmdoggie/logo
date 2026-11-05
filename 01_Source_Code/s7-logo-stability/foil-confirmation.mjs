import {foilVersions} from './foil-finishes.mjs';
import {allowedFoilVersions} from './foil-selection.mjs';

export function mountFoilConfirmation(dialog){
 const title=dialog.querySelector('[data-foil-title]'),messages=dialog.querySelector('[data-foil-messages]'),cancel=dialog.querySelector('[data-foil-cancel]'),proceed=dialog.querySelector('[data-foil-continue]');
 return report=>new Promise(resolve=>{
  const blocked=report.blocked.length>0;
  title.textContent=blocked?'产品不支持所选烫印工艺':'彩盒不建议烫印';
  messages.textContent=[...report.blocked,...report.warnings].map(item=>item.message).join('\n');
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
