import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {buildAiMockupPlan} from './ai-mockup-generation.mjs';

const ROOT=new URL('.',import.meta.url);
const DEFAULT_CONFIG=fileURLToPath(new URL('../data/ai-provider.local.json',ROOT));

function configAt(configPath){
  if(!existsSync(configPath))return null;
  try{
    const config=JSON.parse(readFileSync(configPath,'utf8').replace(/^\uFEFF/,''));
    const endpoint=new URL(config.endpoint);
    if(config.enabled===false||config.provider!=='APIMART'||!['gpt-image-2','gpt-image-2.5-flare'].includes(config.model)||typeof config.apiKey!=='string'||!config.apiKey.trim()||endpoint.origin!=='https://api.apimart.ai')return null;
    return {...config,endpoint:endpoint.toString().replace(/\/$/,''),timeoutMs:Math.max(1000,Math.min(300000,Number(config.timeoutMs)||120000))};
  }catch{return null;}
}

function errorFrom(payload,fallback){return payload?.error?.message||payload?.message||payload?.data?.error?.message||fallback;}

async function download(urlValue,{transport,signal}){
  const url=new URL(urlValue);
  if(url.protocol!=='https:'||!(url.hostname==='apimart.ai'||url.hostname.endsWith('.apimart.ai')||url.hostname==='getapib.org'||url.hostname.endsWith('.getapib.org')))throw Error('APIMart 返回的图片地址无效');
  const response=await transport(url,{redirect:'error',signal});
  if(!response.ok)throw Error(`APIMart 成图下载失败：HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  const metadata=await sharp(bytes).metadata();
  if(!metadata.width||!metadata.height)throw Error('APIMart 返回的成图无效');
  return bytes;
}

async function renderOne(config,plan,{transport,pollIntervalMs}){
  const signal=AbortSignal.timeout(config.timeoutMs);
  const request=async(path,options={})=>{
    const response=await transport(config.endpoint+path,{...options,redirect:'error',signal,headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json',...(options.headers||{})}});
    const payload=await response.json();
    if(!response.ok)throw Error(`APIMart 成图请求失败：${errorFrom(payload,`HTTP ${response.status}`)}`);
    return payload;
  };
  const submitted=await request('/v1/images/generations',{method:'POST',body:JSON.stringify(plan.request)});
  const first=submitted.data?.[0]||submitted.data;
  if(typeof first?.url==='string')return {version:plan.version,bytes:await download(first.url,{transport,signal})};
  const taskId=first?.task_id||first?.id;
  if(typeof taskId!=='string')throw Error('APIMart 未返回成图任务编号');
  for(;;){
    if(pollIntervalMs>0)await new Promise(resolve=>setTimeout(resolve,pollIntervalMs));
    const status=await request(`/v1/tasks/${encodeURIComponent(taskId)}?language=zh`);
    const task=status.data;
    if(task?.status==='completed'){
      const value=task.result?.images?.[0]?.url;
      return {version:plan.version,bytes:await download(Array.isArray(value)?value[0]:value,{transport,signal})};
    }
    if(['failed','cancelled'].includes(task?.status))throw Error(`APIMart ${plan.version} 成图失败：${errorFrom(task,task.status)}`);
  }
}

export function createAiMockupRenderer({configPath=process.env.S7_AI_CONFIG||DEFAULT_CONFIG,transport=fetch,pollIntervalMs=3000}={}){
  return async input=>{
    const config=configAt(configPath);
    if(!config)throw Error('S7 AI 成图需要配置 APIMART / gpt-image-2.5-flare');
    const plan=buildAiMockupPlan({...input,model:config.model});
    return Promise.all(plan.map(item=>renderOne(config,item,{transport,pollIntervalMs})));
  };
}
