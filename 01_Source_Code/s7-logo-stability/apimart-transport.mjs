import {ProxyAgent} from 'undici';

const agents=new Map();

function proxyAgent(proxyUrl){
  const normalized=String(proxyUrl||'').trim();
  if(!normalized)return undefined;
  const parsed=new URL(normalized);
  if(!['http:','https:'].includes(parsed.protocol))throw Error('APIMart proxy URL must use http or https');
  if(!agents.has(normalized))agents.set(normalized,new ProxyAgent(normalized));
  return agents.get(normalized);
}

export function createApimartTransport({proxyUrl='',transport=fetch}={}){
  const dispatcher=proxyAgent(proxyUrl);
  if(!dispatcher)return transport;
  return (url,options={})=>transport(url,{...options,dispatcher});
}
