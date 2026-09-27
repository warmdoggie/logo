import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {renderLogoSet} from './index.mjs';
import {processLogo} from './logo-processing.mjs';
import {validateAiLogoOutput} from './ai-logo-processing.mjs';
import {createAiLogoProcessor,getAiLogoProviderStatus} from './ai-logo-provider.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
const MAX_BODY=50*1024*1024;
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};

function json(res,status,payload){
  const body=JSON.stringify(payload);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body)});
  res.end(body);
}

async function body(req){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw Error('请求图片过大，请先压缩后再上传');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function staticFile(res,path){
  const file=path==='/'?'demo.html':path.slice(1);
  if(!/^[a-zA-Z0-9._-]+$/.test(file))return false;
  try{
    const bytes=await readFile(join(ROOT,file));
    res.writeHead(200,{'content-type':TYPES[file.slice(file.lastIndexOf('.'))]||'application/octet-stream'});
    res.end(bytes);return true;
  }catch{return false;}
}

export function createDemoServer({aiProcessor=createAiLogoProcessor(),aiStatus=()=>getAiLogoProviderStatus()}={}){
  return createServer(async(req,res)=>{
    try{
      const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
      if(req.method==='GET'){
        if(url.pathname==='/api/ai-logo/status'){json(res,200,aiStatus());return;}
        if(await staticFile(res,url.pathname))return;
        json(res,404,{error:'页面不存在'});return;
      }
      if(req.method==='POST'&&url.pathname==='/api/ai-process-logo'){
        const input=await body(req);
        const processed=await aiProcessor(Buffer.from(input.logoImage||'','base64'),{targetColor:'#000000'});
        const output=await validateAiLogoOutput(processed?.bytes||processed);
        json(res,200,{width:output.width,height:output.height,provider:processed?.provider||null,model:processed?.model||null,dataUrl:`data:image/png;base64,${output.bytes.toString('base64')}`});
        return;
      }
      if(req.method==='POST'&&url.pathname==='/api/process-logo'){
        const input=await body(req);
        const processed=await processLogo(Buffer.from(input.logoImage||'','base64'),{removeWhiteBackground:input.removeWhiteBackground!==false,cropTransparentBounds:input.cropTransparentBounds!==false,threshold:Number(input.threshold??24)});
        const meta=await sharp(processed).metadata();
        json(res,200,{width:meta.width,height:meta.height,dataUrl:`data:image/png;base64,${processed.toString('base64')}`});
        return;
      }
      if(req.method!=='POST'||url.pathname!=='/api/render'){
        json(res,404,{error:'接口不存在'});return;
      }
      const input=await body(req);
      const result=await renderLogoSet({
        baseImage:Buffer.from(input.baseImage||'', 'base64'),
        logoImage:Buffer.from(input.logoImage||'', 'base64'),
        targets:input.targets
      });
      json(res,200,{width:result.width,height:result.height,targetIds:result.targetIds,layoutFingerprint:result.layoutFingerprint,outputs:result.outputs.map(output=>({version:output.version,layoutFingerprint:output.layoutFingerprint,bounds:output.bounds,dataUrl:`data:image/png;base64,${output.bytes.toString('base64')}`}))});
    }catch(error){
      const message=error instanceof SyntaxError?'请求必须是有效JSON':/unsupported image format|Input buffer/i.test(error.message||'')?'图片格式无法读取，请上传 PNG、JPG 或 WebP 图片':error.message||'生成失败';
      json(res,400,{error:message});
    }
  });
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const port=Number(process.env.S7_PORT||3237);
  createDemoServer().listen(port,'127.0.0.1',()=>console.log(`S7 Logo Stability: http://127.0.0.1:${port}/`));
}
