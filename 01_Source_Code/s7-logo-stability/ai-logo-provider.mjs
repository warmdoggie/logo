import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {buildAiLogoRequest,buildApimartLogoRequest,validateAiLogoOutput} from './ai-logo-processing.mjs';

const ROOT=new URL('.',import.meta.url);
const DEFAULT_CONFIG=fileURLToPath(new URL('../data/ai-provider.local.json',ROOT));

function readConfig(configPath){
  if(!existsSync(configPath))return null;
  try{
    const config=JSON.parse(readFileSync(configPath,'utf8').replace(/^\uFEFF/,''));
    if(config.enabled===false||!['APIMART','JSON_IMAGE_EDIT_V1'].includes(config.provider)||typeof config.model!=='string'||!config.model.trim()||typeof config.apiKey!=='string'||!config.apiKey.trim())return null;
    const endpoint=new URL(config.endpoint);
    if(config.provider==='APIMART'&& (endpoint.origin!=='https://api.apimart.ai'||!['wan2.7-image-pro','wan2.7-image'].includes(config.model)))return null;
    if(endpoint.protocol!=='https:'&&!(['localhost','127.0.0.1'].includes(endpoint.hostname)&&endpoint.protocol==='http:'))return null;
    return {...config,endpoint:endpoint.toString(),timeoutMs:Math.max(1000,Math.min(180000,Number(config.timeoutMs)||120000))};
  }catch{return null;}
}

export function getAiLogoProviderStatus(configPath=process.env.S7_AI_CONFIG||DEFAULT_CONFIG){
  const config=readConfig(configPath);
  return {configured:!!config,provider:config?.provider||null,model:config?.model||null};
}

export function createAiLogoProcessor({configPath=process.env.S7_AI_CONFIG||DEFAULT_CONFIG,transport=fetch,pollIntervalMs=3000}={}){
  return async(source,{targetColor='#000000'}={})=>{
    const config=readConfig(configPath);
    if(!config)throw Error('S7 尚未配置可用的 AI 图片模型，请检查 data/ai-provider.local.json');
    if(config.provider==='APIMART')return processWithApimart(config,source,{transport,pollIntervalMs});
    const body=buildAiLogoRequest(Buffer.from(source).toString('base64'),{model:config.model,targetColor});
    let response;
    try{
      response=await transport(config.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(config.timeoutMs),headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`},body:JSON.stringify(body)});
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      const result=await response.json();
      const imageBase64=typeof result.imageBase64==='string'?result.imageBase64:typeof result.dataUrl==='string'?result.dataUrl.split(',')[1]:'';
      if(!imageBase64)throw Error('AI 未返回 Logo 图片');
      const output=await validateAiLogoOutput(Buffer.from(imageBase64,'base64'));
      return {...output,provider:config.provider,model:config.model};
    }catch(error){
      if(error.message?.startsWith('AI ')||error.message?.startsWith('S7 '))throw error;
      throw Error(error.name==='TimeoutError'?'AI Logo 加工超时，请稍后重试':'AI Logo 加工失败，请检查模型接口配置');
    }
  };
}

async function processWithApimart(config,source,{transport,pollIntervalMs}){
  const signal=AbortSignal.timeout(config.timeoutMs),base=config.endpoint.replace(/\/$/,''),logoPng=await sharp(source).png().toBuffer(),body=buildApimartLogoRequest(`data:image/png;base64,${logoPng.toString('base64')}`,{model:config.model});
  const read=async(response)=>{if(!response.ok)throw Error(`HTTP ${response.status}`);return response.json();};
  const request=async(path,options)=>read(await transport(base+path,{...options,redirect:'error',signal,headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json',...(options?.headers||{})}}));
  try{
    const submitted=await request('/v1/images/generations',{method:'POST',body:JSON.stringify(body)}),taskId=submitted.data?.[0]?.task_id;
    if(typeof taskId!=='string'||!/^[A-Za-z0-9_-]+$/.test(taskId))throw Error('APIMart 未返回任务编号');
    let completed;
    for(;;){if(pollIntervalMs>0)await new Promise(resolve=>setTimeout(resolve,pollIntervalMs));const result=await request(`/v1/tasks/${encodeURIComponent(taskId)}?language=zh`,{method:'GET'});if(result.data?.status==='completed'){completed=result.data;break;}if(['failed','cancelled'].includes(result.data?.status))throw Error('APIMart Logo 生成失败');}
    const value=completed.result?.images?.[0]?.url,url=new URL(Array.isArray(value)?value[0]:value);
    if(url.protocol!=='https:'||!(url.hostname==='apimart.ai'||url.hostname.endsWith('.apimart.ai')))throw Error('APIMart 返回的图片地址无效');
    const downloaded=await transport(url,{redirect:'error',signal});
    if(!downloaded.ok)throw Error(`HTTP ${downloaded.status}`);
    const output=await validateAiLogoOutput(Buffer.from(await downloaded.arrayBuffer()));
    return {...output,provider:'APIMART',model:config.model,taskId};
  }catch(error){
    if(error.message?.startsWith('AI ')||error.message?.startsWith('APIMart ')||error.message?.startsWith('S7 '))throw error;
    throw Error(error.name==='TimeoutError'?'APIMart Logo 加工超时，请稍后重试':'APIMart Logo 加工失败，请检查 API Key、模型和余额');
  }
}
