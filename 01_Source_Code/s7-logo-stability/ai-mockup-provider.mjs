import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {buildAiMockupPlan} from './ai-mockup-generation.mjs';
import {createApimartTransport} from './apimart-transport.mjs';
import {lockOutsideLogo} from './mockup-lock.mjs';

const ROOT=new URL('.',import.meta.url);
const DEFAULT_CONFIG=fileURLToPath(new URL('../data/ai-provider.local.json',ROOT));
const SUPPORTED_MOCKUP_MODELS=['gpt-image-2','gpt-image-2.5-flare','flux-3-image'];

function configAt(configPath){
  if(!existsSync(configPath))return null;
  try{
    const config=JSON.parse(readFileSync(configPath,'utf8').replace(/^\uFEFF/,''));
    const endpoint=new URL(config.endpoint);
    const configuredModels=Array.isArray(config.mockupModels)?config.mockupModels:[config.model];
    const models=[...new Set(configuredModels.filter(model=>typeof model==='string'&&SUPPORTED_MOCKUP_MODELS.includes(model)))];
    if(config.enabled===false||config.provider!=='APIMART'||!SUPPORTED_MOCKUP_MODELS.includes(config.model)||!models.includes(config.model)||typeof config.apiKey!=='string'||!config.apiKey.trim()||endpoint.origin!=='https://api.apimart.ai')return null;
    return {...config,models,endpoint:endpoint.toString().replace(/\/$/,''),timeoutMs:Math.max(1000,Math.min(300000,Number(config.timeoutMs)||120000))};
  }catch{return null;}
}

export function getAiMockupProviderStatus(configPath=process.env.S7_AI_CONFIG||DEFAULT_CONFIG){
  const config=configAt(configPath);
  return {configured:!!config,provider:config?.provider||null,defaultModel:config?.model||null,models:config?.models||[]};
}

function selectedModel(config,requestedModel){
  if(requestedModel===undefined||requestedModel===null||requestedModel==='')return config.model;
  if(typeof requestedModel!=='string'||!config.models.includes(requestedModel))throw Error(`请求的 AI 成图模型未配置或不可用：${requestedModel}`);
  return requestedModel;
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

async function preserveFluxOutsideMask(plan,generatedImage){
  if(plan.request.model!=='flux-3-image'||!plan.maskImage||!plan.placementGuide)return generatedImage;
  const imageBytes=value=>Buffer.from(value.slice(value.indexOf(',')+1),'base64');
  return lockOutsideLogo({baseImage:imageBytes(plan.baseImage),generatedImage,guideImage:imageBytes(plan.placementGuide),maskImage:imageBytes(plan.maskImage),feather:0,useGeneratedLighting:plan.version==='GOLD FOIL'||plan.version==='SILVER FOIL',foilFinish:plan.version==='GOLD FOIL'?'gold':undefined});
}

async function renderOne(config,plan,{transport,pollIntervalMs,onStage}){
  const stage=async(value,error)=>{try{await onStage?.(plan.version,value,error);}catch{}};
  const signal=AbortSignal.timeout(config.timeoutMs);
  const request=async(path,options={})=>{
    const response=await transport(config.endpoint+path,{...options,redirect:'error',signal,headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json','Accept-Encoding':'identity',...(options.headers||{})}});
    let payload;
    try{payload=await response.json();}catch{throw Error('APIMart 返回了无法解析的 JSON 响应');}
    if(!response.ok)throw Error(`APIMart 成图请求失败：${errorFrom(payload,`HTTP ${response.status}`)}`);
    return payload;
  };
  await stage('submitting');
  const submitted=await request('/v1/images/generations',{method:'POST',body:JSON.stringify(plan.request)});
  const first=submitted.data?.[0]||submitted.data;
  await stage('generating');
  if(typeof first?.url==='string'){await stage('saving');const generated=await download(first.url,{transport,signal});return {version:plan.version,bytes:await preserveFluxOutsideMask(plan,generated)};}
  const taskId=first?.task_id||first?.id;
  if(typeof taskId!=='string')throw Error('APIMart 未返回成图任务编号');
  for(;;){
    if(pollIntervalMs>0)await new Promise(resolve=>setTimeout(resolve,pollIntervalMs));
    const status=await request(`/v1/tasks/${encodeURIComponent(taskId)}?language=zh`);
    const task=status.data;
    if(task?.status==='completed'){
      const value=task.result?.images?.[0]?.url;
      await stage('saving');
      const generated=await download(Array.isArray(value)?value[0]:value,{transport,signal});
      return {version:plan.version,bytes:await preserveFluxOutsideMask(plan,generated)};
    }
    if(['failed','cancelled'].includes(task?.status))throw Error(`APIMart ${plan.version} 成图失败：${errorFrom(task,task.status)}`);
  }
}

export function createAiMockupRenderer({configPath=process.env.S7_AI_CONFIG||DEFAULT_CONFIG,transport=fetch,pollIntervalMs=3000}={}){
  return async input=>{
    const config=configAt(configPath);
    if(!config)throw Error('S7 AI 成图需要配置可用的 APIMART 图片模型');
    const plan=buildAiMockupPlan({...input,model:selectedModel(config,input.model)});
    const requestTransport=createApimartTransport({proxyUrl:config.proxyUrl||process.env.S7_APIMART_PROXY_URL||process.env.APIMART_PROXY_URL,transport});
    const onStage=input.onStage,onOutput=input.onOutput;
    const settled=await Promise.allSettled(plan.map(async item=>{
      try{
        const output=await renderOne(config,item,{transport:requestTransport,pollIntervalMs,onStage});
        await onOutput?.(output);
        return output;
      }catch(error){try{await onStage?.(item.version,'failed',error);}catch{}throw error;}
    }));
    const outputs=settled.filter(item=>item.status==='fulfilled').map(item=>item.value);
    if(typeof onStage==='function'||typeof onOutput==='function')return outputs;
    const failure=settled.find(item=>item.status==='rejected');if(failure)throw failure.reason;
    return outputs;
  };
}
