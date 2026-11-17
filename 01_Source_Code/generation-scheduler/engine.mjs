export async function runStage(stage,job,{store,provider,processImage,pollMs=5000,allowRemote=true}){
 if(stage==='submit'){
  if(!allowRemote&&!job.params?.local){await store.deferSubmit(job);return;}
  let prepared;
  if(!job.params?.local&&provider.prepare){
   try{prepared=await provider.prepare(job.params);}
   catch{await store.transition(job,'QUEUED',{error_code:'plan_storage_unavailable'},true,60000);return;}
  }
  if(!await store.startSubmit(job))return;
  if(job.params?.local){await store.transition(job,'DOWNLOADED',{},true);return;}
  let submitted;
  try{submitted=await provider.submit(job.params,prepared);}
  catch(error){
   if(error.planUnavailable)await store.transition(job,'QUEUED',{error_code:'plan_storage_unavailable'},true,60000);
   else await store.transition(job,error.rejected?'FAILED':'SUBMISSION_UNKNOWN',{error_code:error.rejected?'provider_rejected':'submit_uncertain'},!!error.rejected);
   return;
  }
  // A database failure after a successful POST must be recovered as uncertain, never submitted again.
  if(submitted.url)await store.transition(job,'REMOTE_SUCCEEDED',{source_url:submitted.url},true);
  else await store.transition(job,'GENERATING',{provider_task_id:submitted.taskId},false,pollMs);
 }else if(stage==='poll'){
  let result;
  try{result=await provider.poll(job.provider_task_id);}catch{await store.retry(job,'GENERATING','poll_network',pollMs);return;}
  if(result.status==='completed')await store.transition(job,result.url?'REMOTE_SUCCEEDED':'DOWNLOAD_FAILED',result.url?{source_url:result.url}:{error_code:'remote_result_missing'},true);
  else if(['failed','cancelled'].includes(result.status))await store.transition(job,result.status==='failed'?'FAILED':'CANCELLED',{error_code:'remote_'+result.status},true);
  else await store.retry(job,'GENERATING',null,pollMs);
 }else if(stage==='download'){
  let file;
  try{file=await provider.download(job);}catch(error){
   if(error.code==='DISK_SPACE')await store.pauseDownload(job);
   else await store.retry(job,job.download_attempts>=8?'DOWNLOAD_FAILED':'REMOTE_SUCCEEDED','download_failed',Math.min(60000,1000*2**Math.min(job.download_attempts,6)));
   return;
  }
  await store.transition(job,'DOWNLOADED',{file_path:file,error_code:null});
 }else if(stage==='process'){
  let result;
  try{result=await processImage(job);}catch(error){
   if(error.planUnavailable)await store.pausePlanRead(job);
   else if(error.code==='STORAGE_PENDING')await store.retry(job,'DOWNLOADED','storage_pending',60000);
   else await store.retry(job,job.process_attempts>=3?'PROCESS_FAILED':'DOWNLOADED','image_processing_failed',5000);
   return;
  }
  await store.transition(job,'SUCCEEDED',{result_path:result,error_code:null});
 }
}
