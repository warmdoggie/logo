export const foilTargetNames={PRODUCT:'产品',CARTON:'彩盒'};

export function foilTargetFor(target){return target.carrier?.type==='CARTON'?'CARTON':'PRODUCT';}

// Older drafts keep their original product-first behaviour until a user chooses a range.
export function effectiveFoilTargets(draft,targets=[]){
 if(Array.isArray(draft.foilTargets))return draft.foilTargets;
 return targets.length&&targets.every(t=>foilTargetFor(t)==='CARTON')?['CARTON']:['PRODUCT'];
}

export function usesFoil(target,kind,draft,targets){
 return kind==='FOIL'&&effectiveFoilTargets(draft,targets).includes(foilTargetFor(target));
}

export function ordinaryProcess(printing){
 return printing.defaultProcess!=='HOT_STAMP'?printing.defaultProcess:printing.allowed.find(p=>p!=='HOT_STAMP');
}

export function mountFoilPicker(dialog,foils){
 const picker=dialog.querySelector('[data-foil-picker]'),name=dialog.querySelector('[data-foil-name]'),swatch=dialog.querySelector('[data-foil-swatch]');
 for(const input of dialog.querySelectorAll('[name=foil]'))input.onchange=()=>{
  name.textContent=foils[input.value].name;swatch.className='sales-foil-swatch foil-'+input.value;picker.open=false;
 };
 const update=()=>dialog.querySelector('[data-answer="1"]').disabled=!dialog.querySelector('[name=foilTarget]:checked');
 for(const input of dialog.querySelectorAll('[name=foilTarget]'))input.onchange=update;
 update();
}
