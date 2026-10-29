import {mkdir,rename,rm,open,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {hasDiskSpace} from './capacity.mjs';
import {readPlan,appModule} from './plans.mjs';

export function createProvider({directory,configPath=process.env.PROVIDER_CONFIG,transport=fetch}){
 async function config(){
  const value=JSON.parse(await readFile(configPath,'utf8'));
  if(value.provider!=='APIMART'||!value.apiKey)throw Error('APIMart credentials not configured');return value;
 }
 async function request(path,body){
  const c=await config();const {createApimartTransport}=await import(appModule('s7-logo-stability/apimart-transport.mjs'));
  const routed=createApimartTransport({proxyUrl:c.proxyUrl||process.env.APIMART_PROXY_URL,transport,maxResponseBytes:1024*1024});
  const response=await routed('https://api.apimart.ai/v1'+path,{
   method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(25000),
   headers:{Authorization:'Bearer '+c.apiKey,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})
  });
  if(!response.ok)throw Object.assign(Error('provider_http_'+response.status),{rejected:[400,401,403,422,429].includes(response.status)});
  return response.json();
 }
 return {
  async submit(params){
   const input=params.batchId?(await readPlan(directory,params.planHash)).request:params;
   const payload=await request('/images/generations',input),first=payload.data?.[0]||payload.data;
   if(typeof first?.url==='string')return {url:first.url};
   const taskId=first?.task_id||first?.id;if(typeof taskId!=='string'||!taskId)throw Error('missing_task_id');return {taskId};
  },
  async poll(taskId){
   const task=(await request('/tasks/'+encodeURIComponent(taskId))).data;
   if(!task?.status)throw Error('missing_task_status');
   const value=task.result?.images?.[0]?.url,url=Array.isArray(value)?value[0]:value;
   return {status:task.status,url:typeof url==='string'?url:undefined};
  },
  async download(job){
   if(!await hasDiskSpace(directory,1))throw Object.assign(Error('disk_reserve_required'),{code:'DISK_SPACE'});
   const url=new URL(job.source_url);
   if(url.protocol!=='https:'||!['apimart.ai','getapib.org'].some(host=>url.hostname===host||url.hostname.endsWith('.'+host)))throw Error('untrusted_image_host');
   const c=await config(),{createApimartTransport}=await import(appModule('s7-logo-stability/apimart-transport.mjs'));
   const routed=createApimartTransport({proxyUrl:c.proxyUrl||process.env.APIMART_PROXY_URL,transport,maxResponseBytes:32*1024*1024});
   const response=await routed(url,{redirect:'error',signal:AbortSignal.timeout(45000)});
   if(!response.ok||!response.body)throw Error('image_download_failed');
   const limit=32*1024*1024;if(Number(response.headers.get('content-length'))>limit){await response.body.cancel();throw Error('image_too_large');}
   await mkdir(directory,{recursive:true});const final=join(directory,job.id+'.original'),temp=final+'.'+job.lease_token+'.tmp';
   const file=await open(temp,'wx',0o600);let size=0;
   try{
    for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('image_too_large');await file.write(chunk);}
    if(!size)throw Error('empty_image');await file.sync();await file.close();await rename(temp,final);return final;
   }catch(error){await file.close();throw error;}finally{await rm(temp,{force:true});}
  }
 };
}
