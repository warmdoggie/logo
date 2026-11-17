// Session-local recovery complements explicit server saves. Never overwrite a newer server draft.
export function draftRecovery(main,taskId,version,colors){
 const form=main.querySelector('#requirements-form'),key='mockup-requirements:'+taskId;
 const controls=()=>[...form.querySelectorAll('input,select,textarea')].filter(e=>e.type!=='file'&&e.type!=='password'&&(e.name||e.matches('[data-carrier-index],[data-carrier-color],[data-surface-color],[data-area-color],[data-area-process],[data-scheme-process]')));
 const capture=()=>controls().map(e=>({value:e.value,checked:e.checked}));
 const get=()=>{try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}};
 const clear=()=>{try{sessionStorage.removeItem(key);}catch{}};
 const message=document.createElement('p');message.className='history-banner';message.dataset.draftRecovery='';message.hidden=true;form.before(message);
 const saved=get();if(saved){if(saved.version===version&&saved.values?.length===controls().length){controls().forEach((e,i)=>{e.value=saved.values[i].value;if(e.type==='checkbox')e.checked=saved.values[i].checked;});if(saved.colors)colors.restore(saved.colors);message.textContent='已恢复此浏览器尚未保存的修改。请核对后保存或生成。';message.hidden=false;}else{message.textContent='服务端草稿已更新，已读取最新保存内容；旧的浏览器临时修改未覆盖它。';message.hidden=false;clear();}}
 const retain=()=>{try{sessionStorage.setItem(key,JSON.stringify({version,values:capture(),colors:colors.capture()}));message.textContent='有尚未保存的修改，已暂存在本浏览器；请点击保存或生成。';message.hidden=false;}catch{message.textContent='浏览器暂存不可用，请及时点击保存待生成修改。';message.hidden=false;}};
 form.addEventListener('input',retain);form.addEventListener('change',retain);form.addEventListener('draftchange',retain);
 return {clear};
}
