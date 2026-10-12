let colorsPromise;

function cleanName(value){
 return value.replace(/\bP\s+Urple\b/gi,'Purple').replace(/\bReal P\s+Urple\b/gi,'Real Purple').replace(/\s+/g,' ').trim().replace(/(\d)([CU])$/i,'$1 $2');
}

export function normalizePantoneSearch(value){
 if(typeof value!=='string')return '';
 const name=cleanName(value.replace(/^\s*PANTONE\s+/i,''));
 return name?`PANTONE ${name.toUpperCase()}`:'';
}

export function searchPantoneColors(colors,query){
 const code=normalizePantoneSearch(query);if(!code)return [];
 const exact=colors.filter(color=>color.code===code);if(exact.length)return exact;
 const term=code.slice(8);
 return colors.filter(color=>color.code.includes(term)||color.label.toUpperCase().includes(term)).slice(0,12);
}

export function formatPantoneRgb(rgb){return `RGB ${rgb.join(', ')}`;}
export function formatPantoneNote(color){return `${color.label} · ${formatPantoneRgb(color.rgb)} · HEX ${color.hex}`;}

async function copyText(value){
 if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);return;}
 const area=document.createElement('textarea');area.value=value;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();
 if(!document.execCommand('copy'))throw new Error('当前浏览器不支持复制');
 area.remove();
}

async function loadColors(){
 colorsPromise??=fetch('/pantone-colors.json').then(response=>{if(!response.ok)throw new Error('潘通色卡数据读取失败');return response.json();}).then(data=>data.colors||[]);
 return colorsPromise;
}

function button(label,className){const element=document.createElement('button');element.type='button';element.className=`btn small ${className||''}`;element.textContent=label;return element;}

export function attachPantonePicker(root,{toast,onApply}={}){
 if(!root)return()=>{};
 const input=root.querySelector('[data-pantone-search]'),results=root.querySelector('[data-pantone-results]'),searchButton=root.querySelector('[data-pantone-search-button]');
 if(!input||!results)return()=>{};
 let timer,disposed=false;
 const render=(matches=[],message='')=>{
  if(disposed)return;results.replaceChildren();
  if(message){results.textContent=message;return;}
  if(!matches.length){results.textContent='未找到匹配色号，请检查输入格式。';return;}
  for(const color of matches){
   const card=document.createElement('article');card.className='pantone-result-card';
   const swatch=document.createElement('span');swatch.className='pantone-swatch';swatch.style.backgroundColor=color.hex;swatch.title=color.hex;
   const info=document.createElement('div');info.className='pantone-result-info';
   const title=document.createElement('strong');title.textContent=color.label+(color.ambiguous?`（未标注版本 ${color.variant}）`:'');
   const rgb=document.createElement('span');rgb.textContent=`${formatPantoneRgb(color.rgb)} · HEX ${color.hex}`;info.append(title,rgb);
   const actions=document.createElement('div');actions.className='pantone-result-actions';
   const copyRgb=button('复制 RGB');copyRgb.onclick=async()=>{try{await copyText(formatPantoneRgb(color.rgb));toast?.('RGB 已复制');}catch(error){toast?.(error.message);}};
   const copyHex=button('复制 HEX');copyHex.onclick=async()=>{try{await copyText(color.hex);toast?.('HEX 已复制');}catch(error){toast?.(error.message);}};
   const apply=button('应用为主色','primary');apply.onclick=()=>onApply?.(color);
   actions.append(copyRgb,copyHex,apply);card.append(swatch,info,actions);results.append(card);
  }
 };
 const search=async()=>{
  if(disposed)return;const query=input.value.trim();if(!query){render([],'请输入 Pantone 色号，例如 186 C');return;}
  render([], '正在查询潘通色卡…');
  try{const colors=await loadColors();if(!disposed)render(searchPantoneColors(colors,query));}
  catch(error){if(!disposed)render([],error.message||'潘通色卡数据读取失败');}
 };
 const onInput=()=>{clearTimeout(timer);timer=setTimeout(search,180);};
 const onKeydown=event=>{if(event.key==='Enter'){event.preventDefault();clearTimeout(timer);search();}};
 input.addEventListener('input',onInput);input.addEventListener('keydown',onKeydown);searchButton?.addEventListener('click',search);
 return()=>{disposed=true;clearTimeout(timer);input.removeEventListener('input',onInput);input.removeEventListener('keydown',onKeydown);searchButton?.removeEventListener('click',search);};
}
