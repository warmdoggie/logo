import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import sharp from 'sharp';
import {allGenerationVersions} from './generation-versions.mjs';
import {foilVersions,foilFinishes} from './foil-finishes.mjs';
import {buildAiMockupPlan} from './ai-mockup-generation.mjs';
import {createApimartTransport} from './apimart-transport.mjs';
import {lockOutsideLogo} from './mockup-lock.mjs';

const ROOT=new URL('.',import.meta.url);
const DEFAULT_CONFIG=fileURLToPath(new URL('../data/ai-provider.local.json',ROOT));
const SUPPORTED_MOCKUP_MODELS=['gpt-image-2','gpt-image-2.5-flare','flux-3-image'];
let imageDownloadTail=Promise.resolve();

function queueImageDownload(url,{transport,timeoutMs}){
  const run=()=>download(url,{transport,signal:AbortSignal.timeout(timeoutMs)});
  const next=imageDownloadTail.then(run,run);
  imageDownloadTail=next.then(()=>undefined,()=>undefined);
  return next;
}

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

export function mockupResumeCheckpoint(plan,checkpoint,configPath=process.env.S7_AI_CONFIG||DEFAULT_CONFIG){
  if(plan.local||!checkpoint)return null;
  const config=configAt(configPath);if(!config)return null;
  const {local,...original}=plan;
  const hash=createHash('sha256').update(JSON.stringify([config.endpoint,config.apiKey,original])).digest('hex');
  if(checkpoint.requestHash!==hash||(!checkpoint.taskId&&!checkpoint.imageUrl))return null;
  return {...(checkpoint.taskId?{taskId:checkpoint.taskId}:{}),...(checkpoint.imageUrl?{imageUrl:checkpoint.imageUrl}:{})};
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

export async function preservePrintSurface(plan,generatedImage){
  if(!plan.maskImage||!plan.placementGuide)return generatedImage;
  const imageBytes=value=>Buffer.from(value.slice(value.indexOf(',')+1),'base64');
  if(plan.local&&(!plan.foilMaskImage||!(await sharp(imageBytes(plan.foilMaskImage)).greyscale().raw().toBuffer()).some(value=>value>0)))return imageBytes(plan.placementGuide);
  return lockOutsideLogo({baseImage:imageBytes(plan.baseImage),generatedImage,guideImage:imageBytes(plan.placementGuide),maskImage:imageBytes(plan.maskImage),foilMaskImage:plan.foilMaskImage?imageBytes(plan.foilMaskImage):undefined,goldMaskImage:plan.goldMaskImage?imageBytes(plan.goldMaskImage):undefined,roseMaskImage:plan.roseMaskImage?imageBytes(plan.roseMaskImage):undefined,laserMaskImage:plan.laserMaskImage?imageBytes(plan.laserMaskImage):undefined,surfaceResponse:!!plan.foilMaskImage,feather:0,useGeneratedLighting:!!plan.foilMaskImage||foilVersions.includes(plan.version),foilFinish:plan.goldMaskImage?'gold':foilFinishes[plan.version]?.finish});
}

export function isLocalMockup(plan){return allGenerationVersions.includes(plan.version)&&!!plan.foilMaskImage&&!!plan.maskImage&&!!plan.placementGuide;}

async function renderLocally(plan,{onStage}){
  if(!isLocalMockup(plan))return null;
  try{await onStage?.(plan.version,'generating');}catch{}
  const imageBytes=value=>Buffer.from(value.slice(value.indexOf(',')+1),'base64');
  const bytes=await preservePrintSurface({...plan,local:true},imageBytes(plan.baseImage));
  try{await onStage?.(plan.version,'saving');}catch{}
  return {version:plan.version,bytes};
}

async function renderOne(config,plan,{transport,pollIntervalMs,onStage,onCheckpoint,resumeTasks}){
  const stage=async(value,error)=>{try{await onStage?.(plan.version,value,error);}catch{}};
  const signal=AbortSignal.timeout(config.timeoutMs);
  const requestHash=createHash('sha256').update(JSON.stringify([config.endpoint,config.apiKey,plan])).digest('hex');
  let remote=resumeTasks?.[plan.version]?.requestHash===requestHash?{...resumeTasks[plan.version]}:{requestHash};
  const checkpoint=async patch=>{remote={...remote,...patch};await onCheckpoint?.(plan.version,remote);};
  const request=async(path,options={})=>{
    const response=await transport(config.endpoint+path,{...options,redirect:'error',signal,headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json','Accept-Encoding':'identity',...(options.headers||{})}});
    let payload;
    try{payload=await response.json();}catch{
      if(!response.ok)throw Object.assign(Error(`APIMart 成图请求失败：HTTP ${response.status}`),{status:response.status});
      throw Error('APIMart 返回了无法解析的 JSON 响应');
    }
    if(!response.ok)throw Object.assign(Error(`APIMart 成图请求失败：${errorFrom(payload,`HTTP ${response.status}`)}`),{status:response.status});
    return payload;
  };
  if(!remote.taskId&&!remote.imageUrl){
    await stage('submitting');
    const submitted=await request('/v1/images/generations',{method:'POST',body:JSON.stringify(plan.request)});
    const first=submitted.data?.[0]||submitted.data;
    if(typeof first?.url==='string')await checkpoint({imageUrl:first.url});
    else{
      const taskId=first?.task_id||first?.id;
      if(typeof taskId!=='string')throw Error('APIMart 未返回成图任务编号');
      await checkpoint({taskId});
    }
  }
  await stage('generating');
  try{
    while(!remote.imageUrl){
      signal.throwIfAborted();
      if(pollIntervalMs>0)await delay(pollIntervalMs,undefined,{signal});
      let status;
      try{status=await request(`/v1/tasks/${encodeURIComponent(remote.taskId)}?language=zh`);}
      catch(error){
        if(!signal.aborted&&(error.code==='APIMART_NETWORK_ERROR'||[408,429,500,502,503,504].includes(error.status))){
          await checkpoint({lastError:error.diagnostic||{status:error.status,message:error.message}});
          continue;
        }
        throw error;
      }
      const task=status.data;
      if(task?.status==='completed'){
        const value=task.result?.images?.[0]?.url,imageUrl=Array.isArray(value)?value[0]:value;
        if(typeof imageUrl!=='string')throw Error('APIMart 未返回成图地址');
        await checkpoint({imageUrl});
      }
      if(['failed','cancelled'].includes(task?.status)){
        await onCheckpoint?.(plan.version,null);
        throw Error(`APIMart ${plan.version} 成图失败：${errorFrom(task,task.status)}`);
      }
    }
  }catch(error){
    if(signal.aborted)throw Object.assign(new Error('APIMart 查询等待超时，上游任务已保留，可继续获取结果',{cause:error}),{code:'APIMART_PENDING',diagnostic:remote.lastError});
    throw error;
  }
  await stage('saving');
  const generated=await queueImageDownload(remote.imageUrl,{transport,timeoutMs:config.timeoutMs});
  return {version:plan.version,bytes:await preservePrintSurface(plan,generated)};
}

export function createAiMockupRenderer({configPath=process.env.S7_AI_CONFIG||DEFAULT_CONFIG,transport=fetch,pollIntervalMs=3000}={}){
  return async input=>{
    const config=configAt(configPath);
    const plan=buildAiMockupPlan({...input,model:input.model||config?.model||'local'});
    let requestTransport;
    if(plan.some(item=>!isLocalMockup(item))){
      if(!config)throw Error('S7 AI 成图需要配置可用的 APIMART 图片模型');
      selectedModel(config,input.model);
      requestTransport=createApimartTransport({proxyUrl:config.proxyUrl||process.env.S7_APIMART_PROXY_URL||process.env.APIMART_PROXY_URL,transport});
    }
    const onStage=input.onStage,onOutput=input.onOutput;
    const settled=await Promise.allSettled(plan.map(async item=>{
      try{
        const localOutput=await renderLocally(item,{onStage});
        const output=localOutput||await renderOne(config,item,{transport:requestTransport,pollIntervalMs,onStage,onCheckpoint:input.onCheckpoint,resumeTasks:input.resumeTasks});
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
