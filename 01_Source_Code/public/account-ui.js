let currentUser=null;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function request(path,body){const response=await fetch(path,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const value=await response.json();if(!response.ok)throw Error(value.error||'账号操作失败');return value;}
export async function initializeAccounts(){
 const config=await request('/api/auth/config');if(!config.enabled)return null;
 const style=document.createElement('link');style.rel='stylesheet';style.href='/account.css';document.head.append(style);
 document.querySelector('.sidebar').classList.add('has-accounts');document.querySelector('.sidebar-bottom').classList.add('account-status');
 document.querySelector('.sidebar-bottom').innerHTML='<span id="current-user">请先登录</span><small>私有任务与素材 · 共享产品图库</small>';
 try{currentUser=await request('/api/auth/session');}catch{
  document.querySelector('#main').innerHTML='<section class="panel account-panel"><h1>登录工作空间</h1><p>任务、素材和生成结果按账号隔离，产品图库共享。</p><form id="account-login"><label>账号<input name="username" autocomplete="username" required></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label><p id="account-error" role="alert"></p><button class="btn primary">登录</button></form></section>';
  await new Promise(resolve=>{document.querySelector('#account-login').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;try{currentUser=await request('/api/auth/login',Object.fromEntries(new FormData(form)));resolve();}catch(error){document.querySelector('#account-error').textContent=error.message;}finally{button.disabled=false;}};});
 }
 document.querySelector('#current-user').textContent=`${currentUser.username} · ${currentUser.role==='ADMIN'?'管理员':'个人空间'}`;
 const logout=document.createElement('button');logout.className='btn';logout.textContent='退出登录';logout.onclick=async()=>{document.querySelector('#main').replaceChildren();await request('/api/auth/logout',{});location.reload();};document.querySelector('.sidebar-bottom').append(logout);
 if(currentUser.role==='ADMIN'){const link=document.createElement('a');link.href='#/settings/accounts';link.textContent='账号管理';document.querySelector('nav').append(link);}else{document.querySelector('[href="#/settings/storage"]')?.remove();}
 // A session replaced or revoked in another tab must not leave the previous user's page visible.
 setInterval(async()=>{try{const user=await request('/api/auth/session');if(user.id!==currentUser.id){document.querySelector('#main').replaceChildren();location.reload();}}catch{document.querySelector('#main').replaceChildren();location.reload();}},10000);
 return currentUser;
}
export async function renderAccounts(main){
 const users=await request('/api/auth/users');
 main.innerHTML=`<h1>账号管理</h1><section class="panel account-panel"><h2>创建用户</h2><form id="create-account"><label>账号<input name="username" minlength="3" maxlength="40" required autocomplete="off"></label><label>初始密码（至少 12 位）<input name="password" type="password" minlength="12" maxlength="200" required autocomplete="new-password"></label><button class="btn primary">创建用户</button><p role="status" id="account-message"></p></form></section><section class="panel account-panel"><h2>用户列表</h2>${users.map(user=>`<div class="toolbar"><strong>${esc(user.username)}</strong><span>${user.role==='ADMIN'?'管理员':user.disabled?'已停用':'已启用'}</span><button class="btn" data-reset="${user.id}">重设密码</button>${user.role==='USER'?`<button class="btn" data-user="${user.id}" data-disabled="${!user.disabled}">${user.disabled?'启用':'停用'}</button>`:''}</div>`).join('')}</section>`;
 main.querySelector('#create-account').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;try{await request('/api/auth/users',Object.fromEntries(new FormData(form)));await renderAccounts(main);}catch(error){main.querySelector('#account-message').textContent=error.message;}};
 for(const button of main.querySelectorAll('[data-user]'))button.onclick=async()=>{try{await request('/api/auth/users/'+button.dataset.user,{disabled:button.dataset.disabled==='true'});await renderAccounts(main);}catch(error){alert(error.message);}};
 for(const button of main.querySelectorAll('[data-reset]'))button.onclick=()=>{const id=button.dataset.reset;button.outerHTML=`<form data-password="${id}"><label>新密码<input type="password" name="password" minlength="12" maxlength="200" autocomplete="new-password" required></label><button class="btn">保存新密码</button><span role="status"></span></form>`;const form=main.querySelector(`[data-password="${id}"]`);form.onsubmit=async event=>{event.preventDefault();try{await request('/api/auth/users/'+id,{password:new FormData(form).get('password')});if(id===currentUser.id)location.reload();else await renderAccounts(main);}catch(error){form.querySelector('span').textContent=error.message;}};};
}
