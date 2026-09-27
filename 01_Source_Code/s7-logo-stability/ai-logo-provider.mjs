import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildAiLogoRequest,validateAiLogoOutput} from './ai-logo-processing.mjs';

const ROOT=new URL('.',import.meta.url);
const DEFAULT_CONFIG=fileURLToPath(new URL('../data/ai-provider.local.json',ROOT));

function readConfig(configPath){
  if(!existsSync(configPath))return null;
  try{
    const config=JSON.parse(readFileSync(configPath,'utf8').replace(/^\uFEFF/,''));
    if(config.enabled===false||config.provider!=='JSON_IMAGE_EDIT_V1'||typeof config.model!=='string'||!config.model.trim()||typeof config.apiKey!=='string'||!config.apiKey.trim())return null;
    const endpoint=new URL(config.endpoint);
    if(endpoint.protocol!=='https:'&&!(['localhost','127.0.0.1'].includes(endpoint.hostname)&&endpoint.protocol==='http:'))return null;
    return {...config,endpoint:endpoint.toString(),timeoutMs:Math.max(1000,Math.min(180000,Number(config.timeoutMs)||120000))};
  }catch{return null;}
}

export function getAiLogoProviderStatus(configPath=process.env.S7_AI_CONFIG||DEFAULT_CONFIG){
  const config=readConfig(configPath);
  return {configured:!!config,provider:config?.provider||null,model:config?.model||null};
}

export function createAiLogoProcessor({configPath=process.env.S7_AI_CONFIG||DEFAULT_CONFIG,transport=fetch}={}){
  return async(source,{targetColor='#000000'}={})=>{
    const config=readConfig(configPath);
    if(!config)throw Error('S7 尚未配置 JSON_IMAGE_EDIT_V1 图片模型，请配置 data/ai-provider.local.json');
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
