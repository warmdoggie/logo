const targets=document.querySelector('#targets');
const status=document.querySelector('#status');
const emptyState=document.querySelector('#empty-state');
const results=document.querySelector('#results');
const resultMeta=document.querySelector('#result-meta');
let targetNumber=0;

function addTarget(value={}){
  targetNumber++;
  const row=document.createElement('div');
  row.className='target-row';
  row.innerHTML=`<div class="target-head"><strong>目标 ${targetNumber}</strong><button type="button" class="remove-target">删除</button></div><div class="target-grid"><label>ID<input data-key="id" value="${value.id||`target-${targetNumber}`}" spellcheck="false"></label><label>X<input data-key="x" type="number" min="0" max="1" step=".01" value="${value.x??.5}"></label><label>Y<input data-key="y" type="number" min="0" max="1" step=".01" value="${value.y??.5}"></label><label>宽度比例<input data-key="widthRatio" type="number" min=".01" max="1" step=".01" value="${value.widthRatio??.2}"></label><label>旋转角度<input data-key="rotation" type="number" min="-180" max="180" step="1" value="${value.rotation??0}"></label></div>`;
  row.querySelector('.remove-target').onclick=()=>{if(targets.children.length===1){setStatus('至少保留一个上样目标','error');return;}row.remove();};
  targets.append(row);
}

function setStatus(message,type=''){status.textContent=message;status.className=`status ${type}`;}
function fileData(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});}
function collectTargets(){return [...targets.children].map(row=>Object.fromEntries([...row.querySelectorAll('[data-key]')].map(input=>[input.dataset.key,input.dataset.key==='id'?input.value.trim():Number(input.value)])));}
function renderResults(payload){
  emptyState.hidden=true;results.replaceChildren();
  resultMeta.textContent=`${payload.targetIds.length} 个目标 · 指纹 ${payload.layoutFingerprint.slice(0,10)}`;
  for(const output of payload.outputs){
    const card=document.createElement('article');card.className='result-card';
    const image=document.createElement('img');image.src=output.dataUrl;image.alt=output.version;
    const footer=document.createElement('footer');const title=document.createElement('strong');title.textContent=output.version;const link=document.createElement('a');link.className='download';link.href=output.dataUrl;link.download=`logo-mockup-${output.version.toLowerCase().replaceAll(' ','-')}.png`;link.textContent='下载 PNG';
    footer.append(title,link);card.append(image,footer);results.append(card);
  }
}

document.querySelector('#add-target').onclick=()=>addTarget();
document.querySelector('#base-image').onchange=e=>{document.querySelector('#base-name').textContent=e.target.files[0]?.name||'尚未选择';};
document.querySelector('#logo-image').onchange=e=>{document.querySelector('#logo-name').textContent=e.target.files[0]?.name||'尚未选择';};
document.querySelector('#generate').onclick=async()=>{
  const base=document.querySelector('#base-image').files[0],logo=document.querySelector('#logo-image').files[0];
  if(!base||!logo){setStatus('请先选择原图和透明 Logo。','error');return;}
  setStatus('正在生成四个版本…','busy');
  try{
    const response=await fetch('/api/render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({baseImage:await fileData(base),logoImage:await fileData(logo),targets:collectTargets()})});
    const payload=await response.json();
    if(!response.ok)throw Error(payload.error||'生成失败');
    renderResults(payload);setStatus('生成完成。四个版本使用同一布局。','success');
  }catch(error){setStatus(error.message||'生成失败，请检查素材和目标设置。','error');}
};

addTarget({id:'product',x:.5,y:.5,widthRatio:.2,rotation:0});
