const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={QUEUED:'等待处理',RENDERING:'正在增强',QA:'正在检查',RETRYING:'检查后重试',PASS:'自动检查通过，待复核',MOCK_PASS:'本地模拟通过（不是实际 AI 出图）',FAILED:'增强未完成，保留二维图',STALE:'要求已变化，需重新生成',INTERRUPTED:'服务中断，未重复提交',CANCELLED:'已取消',DESIGNER_REQUIRED:'需设计师处理'};
export async function mountAutomaticAI(main,id,h){
 const panel=document.createElement('section');panel.className='panel rule-panel';panel.id='automatic-ai-panel';main.append(panel);
 let timer;const base='/api/automatic-ai/'+encodeURIComponent(id);
 async function load(){
  if(!panel.isConnected||!h.isCurrent())return;try{
   const r=await fetch(base);if(!r.ok)throw Error('状态读取失败');const d=await r.json();if(!panel.isConnected||!h.isCurrent())return;
   panel.innerHTML=`<h2>效果增强与质量检查</h2><p>${d.config.enabled?(d.config.mode==='LOCAL_MOCK'?'当前为本地模拟，仅验证流程，不代表实际 AI 效果。':'点击上方一键生成时，合格二维图会自动进入增强队列。'):'AI 增强尚未启用，当前可使用二维效果图。真实接口留待最后验证。'}</p><p>增强结果单独保存，不覆盖二维原图。客户图与 ZIP 目前仍使用经过配置的二维来源。</p>${d.jobs.length?`<ul>${d.jobs.map(j=>`<li><strong>${esc(j.sku)} · ${esc(j.schemeName)}</strong>：${esc(labels[j.status]||'等待检查')}<p>${esc(j.message)}</p>${['QUEUED','RENDERING','QA','RETRYING'].includes(j.status)?`<button class="btn small" data-cancel-ai="${esc(j.id)}">取消本次增强</button>`:''}${j.resultPath?`<details><summary>查看${j.mode==='LOCAL_MOCK'?'模拟':'增强'}检查图</summary><img class="logo-display" src="/files/${encodeURIComponent(j.resultPath)}" alt="${esc(j.sku)} ${j.mode==='LOCAL_MOCK'?'本地模拟检查图':'AI 检查图，待复核'}"></details>`:''}<details><summary>处理记录（${j.attemptCount} 次）</summary>${j.attempts.map(a=>`<p>第 ${a.number} 次 · ${(a.durationMs/1000).toFixed(1)} 秒 · ${a.qa?.result==='PASS'?'自动检查通过':'未通过或未完成'} · 检查目标 ${a.qa?.targets?.length||0} 个${Number.isFinite(a.metadata.cost)?' · 服务商返回费用 '+esc(a.metadata.cost):''}</p>`).join('')}</details></li>`).join('')}</ul>`:''}<p role="alert" data-ai-error></p>`;
   panel.querySelectorAll('[data-cancel-ai]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await h.api(base+'/cancel',{jobId:b.dataset.cancelAi});await load();}catch(e){panel.querySelector('[data-ai-error]').textContent=e.message;b.disabled=false;}});
   clearTimeout(timer);if(d.busy)timer=setTimeout(load,1500);
  }catch{if(panel.isConnected)panel.textContent='增强状态暂时无法读取；二维生成与已保存的图片不受影响。';}
 }
 await load();
}
