import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {renderLogoSet} from './index.mjs';
import {processLogo} from './logo-processing.mjs';
import {validateAiLogoOutput} from './ai-logo-processing.mjs';
import {createAiLogoProcessor,getAiLogoProviderStatus} from './ai-logo-provider.mjs';
import {pickAspectRatio} from './ai-mockup-generation.mjs';
import {createAiMockupRenderer,getAiMockupProviderStatus} from './ai-mockup-provider.mjs';
import {authenticateWorkspace,userSpace} from './user-space.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
const MAX_BODY=50*1024*1024;
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const PUBLIC_FILES=new Set(['demo.html','demo.js','demo.css','demo-geometry.mjs','target-state.mjs','preview-logo-layer.mjs','contrast-color.mjs','saved-logo.mjs','product-master.mjs','transparent-logo-download.mjs','rotation-handle.mjs']);
const PRODUCT_LIBRARY_URL=process.env.S7_PRODUCT_LIBRARY_URL||'http://127.0.0.1:3210/api/products?includeInactive=0';

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
  if(!PUBLIC_FILES.has(file))return false;
  try{
    const bytes=await readFile(join(ROOT,file));
    res.writeHead(200,{'content-type':TYPES[file.slice(file.lastIndexOf('.'))]||'application/octet-stream','cache-control':'no-store'});
    res.end(bytes);return true;
  }catch{return false;}
}

async function loadProductCatalog(req){
  const response=await fetch(PRODUCT_LIBRARY_URL,{headers:{cookie:req?.headers.cookie||''}});
  if(!response.ok)throw Error(`主工作区产品库不可用（HTTP ${response.status}）`);
  const products=await response.json();
  if(!Array.isArray(products))throw Error('主工作区产品库返回格式不正确');
  return products;
}

async function loadProductTemplate(product,req){
  if(product?.template)return {template:product.template,needsTemplateReview:false,currentVersion:product.currentVersion||product.template.version||0};
  const source=new URL(PRODUCT_LIBRARY_URL);
  const response=await fetch(new URL(`/api/templates/${encodeURIComponent(String(product.id))}`,source.origin),{headers:{cookie:req?.headers.cookie||''}});
  if(!response.ok)throw Error(`产品母版读取失败（HTTP ${response.status}）`);
  return response.json();
}

function productLibraryView(products){
  return products.filter(product=>product?.id&&product.status!=='INACTIVE').map(product=>({
    id:String(product.id),
    sku:String(product.sku||''),
    name:String(product.name||''),
    category:String(product.category||''),
    imageUrl:`/api/product-library/image/${encodeURIComponent(String(product.id))}`,
    templateUrl:`/api/product-library/template/${encodeURIComponent(String(product.id))}`,
    hasMaster:Boolean(product.currentVersion||product.template),
    templateVersion:Number(product.currentVersion||product.template?.version||0)
  }));
}

async function productImage(product,req){
  if(product.imageBytes)return {bytes:Buffer.from(product.imageBytes),contentType:'image/png'};
  if(product.imageDataUrl){
    const [header,data]=String(product.imageDataUrl).split(',',2);
    return {bytes:Buffer.from(data||'','base64'),contentType:/image\/[a-z0-9.+-]+/i.exec(header||'')?.[0]||'image/png'};
  }
  if(!product.standardImage)throw Error('产品没有标准图');
  const source=new URL(PRODUCT_LIBRARY_URL);
  const imageUrl=new URL(`/files/${encodeURIComponent(String(product.standardImage))}`,source.origin);
  const response=await fetch(imageUrl,{headers:{cookie:req?.headers.cookie||''}});
  if(!response.ok)throw Error(`产品标准图不可用（HTTP ${response.status}）`);
  return {bytes:Buffer.from(await response.arrayBuffer()),contentType:response.headers.get('content-type')||'application/octet-stream'};
}

export function createDemoServer({aiProcessor=createAiLogoProcessor(),aiStatus=()=>getAiLogoProviderStatus(),aiMockupStatus=()=>getAiMockupProviderStatus(),mockupRenderer=createAiMockupRenderer(),productCatalog=loadProductCatalog,productTemplate=loadProductTemplate,authenticate=process.env.APP_MULTI_USER==='1'?authenticateWorkspace:null,spaceDir=process.env.S7_SPACE_DIR||join(ROOT,'..','data','user-spaces')}={}){
  const spaces=userSpace(spaceDir);
  return createServer(async(req,res)=>{
    try{
      const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
      if(req.method==='GET'&&url.pathname==='/healthz'){json(res,200,{ok:true,service:'s7-logo-stability'});return;}
      const user=authenticate&&url.pathname.startsWith('/api/')?await authenticate(req):null;
      const ensureUser=async()=>{if(user&&(await authenticate(req)).id!==user.id)throw Object.assign(Error('登录已变更，请重新登录'),{status:401});};
      if(authenticate&&req.method!=='GET'&&req.headers.origin){const own=`http://${req.headers.host}`,workspace=process.env.APP_PUBLIC_ORIGIN||'http://127.0.0.1:3210';if(![own,workspace].includes(req.headers.origin))throw Object.assign(Error('不允许跨站提交'),{status:403});}
      if(req.method==='GET'&&url.pathname==='/api/session'){json(res,200,{enabled:!!authenticate,user});return;}
      if(user&&req.method==='GET'&&url.pathname==='/api/my-space/history'){json(res,200,await spaces.history(user));return;}
      const imageMatch=url.pathname.match(/^\/api\/my-space\/image\/([^/]+)\/([^/]+)$/);
      if(user&&req.method==='GET'&&imageMatch){const bytes=await spaces.image(user,imageMatch[1],imageMatch[2]);res.writeHead(200,{'content-type':'image/png','cache-control':'private, no-store'});res.end(bytes);return;}
      if(req.method==='GET'){
        if(url.pathname==='/healthz'){json(res,200,{ok:true,service:'s7-logo-stability'});return;}
        if(url.pathname==='/api/ai-logo/status'){json(res,200,aiStatus());return;}
        if(url.pathname==='/api/ai-models'){json(res,200,aiMockupStatus());return;}
        if(url.pathname==='/api/product-library'){
          json(res,200,productLibraryView(await productCatalog(req)));return;
        }
        const productImageMatch=url.pathname.match(/^\/api\/product-library\/image\/([^/]+)$/);
        if(productImageMatch){
          const id=decodeURIComponent(productImageMatch[1]);
          const product=(await productCatalog(req)).find(item=>String(item?.id)===id);
          if(!product)throw Error('产品不存在');
          const output=await productImage(product,req);
          res.writeHead(200,{'content-type':output.contentType,'cache-control':'no-store'});res.end(output.bytes);return;
        }
        const productTemplateMatch=url.pathname.match(/^\/api\/product-library\/template\/([^/]+)$/);
        if(productTemplateMatch){
          const id=decodeURIComponent(productTemplateMatch[1]);
          const product=(await productCatalog(req)).find(item=>String(item?.id)===id);
          if(!product)throw Error('产品不存在');
          json(res,200,await productTemplate(product,req));return;
        }
        if(await staticFile(res,url.pathname))return;
        json(res,404,{error:'页面不存在'});return;
      }
      if(req.method==='POST'&&url.pathname==='/api/ai-process-logo'){
        const input=await body(req);
        const processed=await aiProcessor(Buffer.from(input.logoImage||'','base64'),{targetColor:'#000000'});
        const output=await validateAiLogoOutput(processed?.bytes||processed);
        await ensureUser();
        if(user)await spaces.save(user,{kind:'Logo加工',model:processed?.model,images:[{label:'上传的Logo',bytes:await sharp(Buffer.from(input.logoImage||'','base64')).png().toBuffer()},{label:'透明Logo',bytes:output.bytes}]});
        json(res,200,{width:output.width,height:output.height,provider:processed?.provider||null,model:processed?.model||null,dataUrl:`data:image/png;base64,${output.bytes.toString('base64')}`});
        return;
      }
      if(req.method==='POST'&&url.pathname==='/api/process-logo'){
        const input=await body(req);
        const processed=await processLogo(Buffer.from(input.logoImage||'','base64'),{removeWhiteBackground:input.removeWhiteBackground!==false,cropTransparentBounds:input.cropTransparentBounds!==false,threshold:Number(input.threshold??24)});
        const meta=await sharp(processed).metadata();
        await ensureUser();
        if(user)await spaces.save(user,{kind:'Logo处理',images:[{label:'透明Logo',bytes:processed}]});
        json(res,200,{width:meta.width,height:meta.height,dataUrl:`data:image/png;base64,${processed.toString('base64')}`});
        return;
      }
      if(req.method==='POST'&&url.pathname==='/api/ai-render'){
        const input=await body(req);
        const baseImage=Buffer.from(input.baseImage||'','base64');
        const logoImage=Buffer.from(input.logoImage||'','base64');
        const basePng=await sharp(baseImage).png().toBuffer();
        const logoMeta=await sharp(logoImage).metadata();
        const guideSet=await renderLogoSet({baseImage:basePng,logoImage,targets:input.targets,originalColor:input.originalColor});
        const outputs=await mockupRenderer({
          baseImage:`data:image/png;base64,${basePng.toString('base64')}`,
          logoImage:`data:image/png;base64,${logoImage.toString('base64')}`,
          finishReferenceImage:input.finishReferenceImage?`data:image/png;base64,${input.finishReferenceImage}`:undefined,
          maskImage:`data:image/png;base64,${guideSet.mask.toString('base64')}`,
          model:input.model,
          guides:guideSet.outputs.map(output=>({version:output.version,dataUrl:`data:image/png;base64,${output.bytes.toString('base64')}`})),
          targets:input.targets,
          onlyVersion:input.onlyVersion,
          originalColor:input.originalColor||'#000000',
          logoAspectRatio:logoMeta.width&&logoMeta.height?logoMeta.height/logoMeta.width:1,
          size:pickAspectRatio(guideSet.width,guideSet.height)
        });
        await ensureUser();
        if(user)await spaces.save(user,{kind:'AI上样',model:input.model,images:[{label:'产品原图',bytes:basePng},{label:'Logo素材',bytes:await sharp(logoImage).png().toBuffer()},...(input.finishReferenceImage?[{label:'工艺参考',bytes:await sharp(Buffer.from(input.finishReferenceImage,'base64')).png().toBuffer()}]:[]),...outputs.map(output=>({label:output.version,bytes:output.bytes}))]});
        json(res,200,{width:guideSet.width,height:guideSet.height,targetIds:guideSet.targetIds,layoutFingerprint:guideSet.layoutFingerprint,outputs:outputs.map(output=>({version:output.version,dataUrl:`data:image/png;base64,${output.bytes.toString('base64')}`}))});
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
      await ensureUser();
        if(user)await spaces.save(user,{kind:'二维上样',images:result.outputs.map(output=>({label:output.version,bytes:output.bytes}))});
      json(res,200,{width:result.width,height:result.height,targetIds:result.targetIds,layoutFingerprint:result.layoutFingerprint,outputs:result.outputs.map(output=>({version:output.version,layoutFingerprint:output.layoutFingerprint,bounds:output.bounds,dataUrl:`data:image/png;base64,${output.bytes.toString('base64')}`}))});
    }catch(error){
      const message=error instanceof SyntaxError?'请求必须是有效JSON':/unsupported image format|Input buffer/i.test(error.message||'')?'图片格式无法读取，请上传 PNG、JPG 或 WebP 图片':error.message||'生成失败';
      json(res,error.status||400,{error:message});
    }
  });
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const port=Number(process.env.S7_PORT||3237);
  createDemoServer().listen(port,'127.0.0.1',()=>console.log(`S7 Logo Stability: http://127.0.0.1:${port}/`));
}
