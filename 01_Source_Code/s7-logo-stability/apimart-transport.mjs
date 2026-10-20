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
  return async(url,options={})=>{
    const method=String(options.method||'GET').toUpperCase();
    const target=new URL(url);
    const imageDownload=method==='GET'&&(target.hostname==='getapib.org'||target.hostname.endsWith('.getapib.org'));
    const routes=imageDownload&&dispatcher&&transport===fetch
      ?[{dispatcher:undefined,attempts:2},{dispatcher,attempts:3}]
      :[{dispatcher,attempts:method==='GET'?(imageDownload?5:3):1}];
    let lastError,lastResponse,lastRoute,attempt=0;
    for(let routeIndex=0;routeIndex<routes.length;routeIndex++){
      const route=routes[routeIndex];
      for(let routeAttempt=0;routeAttempt<route.attempts;routeAttempt++,attempt++){
        try{
          const requestOptions=route.dispatcher?{...options,dispatcher:route.dispatcher}:options;
          const response=await transport(url,requestOptions);
          if(!response.body){
            if(!response.ok&&routeIndex+1<routes.length){lastResponse=response;break;}
            return response;
          }
          // A connection can break after headers, while reading JSON or the image.
          const bytes=await response.arrayBuffer();
          const completeResponse=new Response(bytes,{status:response.status,statusText:response.statusText,headers:response.headers});
          if(!completeResponse.ok&&routeIndex+1<routes.length){lastResponse=completeResponse;break;}
          return completeResponse;
        }
        catch(error){
          const code=error.cause?.code||error.code;
          const networkError=error.message==='fetch failed'||['UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','ECONNRESET','ETIMEDOUT','EAI_AGAIN','ENOTFOUND','ECONNREFUSED'].includes(code);
          if(!networkError||options.signal?.aborted)throw error;
          lastError=error;
          lastRoute=route.dispatcher?'proxy':'direct';
          if(routeAttempt+1<route.attempts)await new Promise(resolve=>setTimeout(resolve,imageDownload?250*2**attempt:250*(attempt+1)));
        }
      }
    }
    if(lastResponse)return lastResponse;
    const code=lastError?.cause?.code||lastError?.code;
    const action=method==='POST'?'提交生成请求':target.pathname.startsWith('/v1/tasks/')?'查询生成进度':'下载生成图片';
    const detail=code?`（${code}）`:'';
    const failure=new Error(`APIMart ${action}网络连接失败${detail}，请检查网络或代理后重试`,{cause:lastError});
    failure.code='APIMART_NETWORK_ERROR';
    failure.diagnostic={action,host:target.hostname,route:lastRoute,code,message:String(lastError?.cause?.message||lastError?.message||'').replace(/https?:\/\/\S+/g,'[url]').slice(0,500)};
    throw failure;
  };
}
