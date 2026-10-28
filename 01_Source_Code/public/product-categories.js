const defaults={
 '唇部':['口红','唇釉','唇蜜','唇彩','唇线笔','润唇膏','唇膜','唇部精华'],
 '脸部':['粉底液','粉底霜','气垫','妆前乳','隔离霜','遮瑕','粉饼','散粉','腮红','修容','高光','定妆喷雾'],
 '身体':['身体乳','身体霜','身体油','身体喷雾','身体高光','沐浴露','身体磨砂膏','护手霜','防晒'],
 '眼部':['眼影','眼线笔','眼线液','睫毛膏','眉笔','眉粉','眉胶','染眉膏','眼部打底']
};

export function buildProductCategories(products=[]){
 const categories=Object.create(null);
 for(const [category,children]of Object.entries(defaults))categories[category]=[...children];
 for(const p of products){
  if(!p.category)continue;
  if(!Object.hasOwn(categories,p.category))categories[p.category]=[];
  if(p.subcategory&&!categories[p.category].includes(p.subcategory))categories[p.category].push(p.subcategory);
 }
 return categories;
}

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const option=value=>`<option value="${esc(value)}">${esc(value)}</option>`;

export function categoryFields(prefix,{editing=false}={}){
 return `<div class="category-fields"><div class="field"><label for="${prefix}-category">所属大类${editing?'<span class="required">*</span>':''}</label><select id="${prefix}-category" ${editing?'name="category" required':''}><option value="">${editing?'请选择大类':'全部大类'}</option></select></div><div class="field"><label for="${prefix}-subcategory">细分类目${editing?'<span class="required">*</span>':''}</label>${editing?`<input id="${prefix}-subcategory" name="subcategory" list="${prefix}-subcategory-options" required maxlength="60" placeholder="选择细类，也可填写新细类" disabled><datalist id="${prefix}-subcategory-options"></datalist>`:`<select id="${prefix}-subcategory" disabled><option value="">请先选择大类</option></select>`}</div></div>`;
}

export function bindCategoryFields(root,prefix,categories,{value={},onChange=()=>{}}={}){
 const parent=root.querySelector('#'+prefix+'-category'),child=root.querySelector('#'+prefix+'-subcategory'),editing=child.tagName==='INPUT';
 parent.insertAdjacentHTML('beforeend',Object.keys(categories).map(option).join(''));
 parent.value=value.category||'';
 const read=()=>({category:parent.value,subcategory:child.value.trim()});
 function update(){
  const children=Object.hasOwn(categories,parent.value)?categories[parent.value]:[];
  child.disabled=!parent.value;
  if(editing){child.value='';root.querySelector('#'+prefix+'-subcategory-options').innerHTML=children.map(option).join('');}
  else child.innerHTML=`<option value="">${parent.value?'全部细分类目':'请先选择大类'}</option>`+children.map(option).join('');
 }
 update();child.value=value.subcategory||'';
 parent.onchange=()=>{update();onChange(read());};
 child.onchange=()=>onChange(read());
 return read;
}
