export function previewStatus(output,phase,dirty){
 const busy=['queued','submitting','generating','saving'].includes(phase?.stage);
 const complete=!!output&&!dirty&&(!phase||phase.stage==='complete');
 const labels={queued:'等待生成',submitting:'正在提交',generating:'正在生成',saving:'正在保存'};
 return {busy,complete,label:busy?labels[phase.stage]:phase?.stage==='failed'?`失败：${phase.error||'请重试'}`:dirty?'有修改，待重新生成':complete?'已生成完成':'待生成'};
}
export function productGeneration(record,productId){
 if(record.kind!=='multi-product')return record;
 const forProduct=values=>Object.fromEntries(Object.entries(values||{}).filter(([id])=>id.startsWith(productId+':')).map(([id,value])=>[id.slice(productId.length+1),value]));
 return {...record,outputs:record.outputs.filter(output=>output.productId===productId),stages:forProduct(record.stages),remoteTasks:forProduct(record.remoteTasks)};
}
export function createGenerationWatcher({request,onChange,onError,interval=2000}){
 let timer,stopped=false,active=true;
 function schedule(){clearTimeout(timer);if(!stopped&&active)timer=setTimeout(()=>refresh().catch(()=>{}),interval);}
 function track(record){clearTimeout(timer);if(stopped||!record)return;onChange(record);if(record.status==='running')schedule();}
 async function refresh(){if(stopped)return;try{const record=await request();track(record);return record;}catch(error){if(!stopped){onError(error);if(error.status!==401&&error.status!==404)schedule();}throw error;}}
 return {refresh,track,setActive(value){active=value;clearTimeout(timer);if(active&&!stopped)refresh().catch(()=>{});},stop(){stopped=true;clearTimeout(timer);}};
}
