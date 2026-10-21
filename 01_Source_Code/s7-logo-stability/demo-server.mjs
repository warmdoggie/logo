import {selectGenerationVersions} from './generation-versions.mjs';
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
import {createGenerationJobs} from './generation-jobs.mjs';
import {createSchemes} from './schemes.mjs';
import {masterTargetsFromTemplate} from './product-master.mjs';
import {createMultiLogoJobs} from './multi-logo-render.mjs';
import {createMultiProductJobs} from './multi-product-jobs.mjs';
import {zipStore} from '../zip.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
const MAX_BODY=50*1024*1024;
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const PUBLIC_FILES=new Set(['tasks.html','tasks.js','tasks.css','task-draft.mjs','generation-client.mjs','generation-versions.mjs','demo.html','demo.js','demo.css','demo-geometry.mjs','target-state.mjs','target-print.mjs','schemes.mjs','preview-logo-layer.mjs','contrast-color.mjs','saved-logo.mjs','product-master.mjs','transparent-logo-download.mjs','rotation-handle.mjs']);
PUBLIC_FILES.add('download-selection.mjs');
PUBLIC_FILES.add('download-archive.mjs');
PUBLIC_FILES.add('preview-images.mjs');
PUBLIC_FILES.add('image-preview.mjs');
const PRODUCT_LIBRARY_URL=process.env.S7_PRODUCT_LIBRARY_URL||'http://127.0.0.1:3210/api/products?includeInactive=0';
for(const file of ['multi-logo.html','multi-logo.js','multi-logo.css'])PUBLIC_FILES.add(file);

function json(res,status,payload){
  const body=JSON.stringify(payload);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body)});
  res.end(body);
}

function event(res,name,payload){if(!res.destroyed&&!res.writableEnded)res.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);}

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

async function saveWorkspaceLogo(req,bytes,name){
  const form=new FormData();form.set('file',new Blob([bytes],{type:'image/png'}),name);
  const response=await fetch((process.env.S7_WORKSPACE_URL||'http://127.0.0.1:3210')+'/api/logo-library',{method:'POST',headers:{cookie:req.headers.cookie||''},body:form,signal:AbortSignal.timeout(20000)});
  const result=await response.json();if(!response.ok)throw Error(result.error||`Logo 库保存失败（HTTP ${response.status}）`);return result;
}

async function loadWorkspaceLogoLibrary(req){
  const response=await fetch((process.env.S7_WORKSPACE_URL||'http://127.0.0.1:3210')+'/api/logo-library',{headers:{cookie:req?.headers.cookie||''},signal:AbortSignal.timeout(10000)});
  const logos=await response.json();if(!response.ok)throw Object.assign(Error(logos.error||`Logo 库读取失败（HTTP ${response.status}）`),{status:response.status});if(!Array.isArray(logos))throw Error('Logo 库返回格式不正确');return logos;
}

async function loadWorkspaceLogoImage(req,id){
  const response=await fetch((process.env.S7_WORKSPACE_URL||'http://127.0.0.1:3210')+`/api/logo-library/${encodeURIComponent(id)}/image`,{headers:{cookie:req?.headers.cookie||''},signal:AbortSignal.timeout(10000)});
  if(!response.ok){let payload={};try{payload=await response.json();}catch{}throw Object.assign(Error(payload.error||`Logo 图片读取失败（HTTP ${response.status}）`),{status:response.status});}return Buffer.from(await response.arrayBuffer());
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

export function createDemoHandler({aiProcessor=createAiLogoProcessor(),aiStatus=()=>getAiLogoProviderStatus(),aiMockupStatus=()=>getAiMockupProviderStatus(),mockupRenderer=createAiMockupRenderer(),productCatalog=loadProductCatalog,productTemplate=loadProductTemplate,logoCatalog=loadWorkspaceLogoLibrary,logoImage=loadWorkspaceLogoImage,saveLogoToLibrary=saveWorkspaceLogo,authenticate=process.env.APP_MULTI_USER==='1'?authenticateWorkspace:null,spaceDir=process.env.S7_SPACE_DIR||join(ROOT,'..','data','user-spaces'),multiLogoEnabled=process.env.S7_MULTI_LOGO_ENABLED!=='0'}={}){
  const spaces=userSpace(spaceDir);
  const jobs=createGenerationJobs(spaces);
  const multiLogoJobs=createMultiLogoJobs(spaces,mockupRenderer);
  const multiProductJobs=createMultiProductJobs(spaces,{productTemplate,productImage,mockupRenderer});
  const readGeneration=async(user,id)=>{const record=await spaces.generation(user,id);if(record?.kind==='multi-logo')return multiLogoJobs.read(user,id);if(record?.status==='running'&&record.kind!=='multi-product')return jobs.read(user,id);return multiProductJobs.read(user,id);};
  return async(req,res)=>{
    try{
      const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
      if(req.method==='GET'&&url.pathname==='/healthz'){json(res,200,{ok:true,service:'s7-logo-stability'});return;}
      const user=authenticate&&url.pathname.startsWith('/api/')?await authenticate(req):null;
      const ensureUser=async()=>{if(user&&(await authenticate(req)).id!==user.id)throw Object.assign(Error('登录已变更，请重新登录'),{status:401});};
      if(authenticate&&req.method!=='GET'&&req.headers.origin){const own=`http://${req.headers.host}`,workspace=process.env.APP_PUBLIC_ORIGIN||'http://127.0.0.1:3210';if(![own,workspace].includes(req.headers.origin))throw Object.assign(Error('不允许跨站提交'),{status:403});}
      if(req.method==='GET'&&url.pathname==='/api/session'){json(res,200,{enabled:!!authenticate,user});return;}
      if(req.method==='GET'&&url.pathname==='/api/features'){json(res,200,{multiLogo:multiLogoEnabled});return;}
      if(user&&url.pathname==='/api/my-space/tasks'){
        if(req.method==='GET'){const tasks=await spaces.tasks(user);const rows=await Promise.all(tasks.map(async task=>{try{return {...task,generation:await readGeneration(user,task.id)};}catch(error){if(error.status===404)return null;throw error;}}));json(res,200,rows.filter(Boolean));return;}
        if(req.method==='POST'){json(res,201,await spaces.createTask(user,await body(req)));return;}
      }
      const taskMatch=url.pathname.match(/^\/api\/my-space\/tasks\/([^/]+)$/);
      if(user&&taskMatch){
        if(req.method==='GET'){json(res,200,url.searchParams.get('summary')==='1'?await spaces.taskSummary(user,taskMatch[1]):await spaces.task(user,taskMatch[1]));return;}
        if(req.method==='PUT'){json(res,200,await spaces.updateTask(user,taskMatch[1],await body(req)));return;}
        if(req.method==='DELETE'){await ensureUser();if((await readGeneration(user,taskMatch[1]))?.status==='running')throw Object.assign(Error('任务正在生成，请完成后再删除'),{status:409});await spaces.deleteTask(user,taskMatch[1]);res.writeHead(204);res.end();return;}
      }
      const generationMatch=url.pathname.match(/^\/api\/my-space\/tasks\/([^/]+)\/generation$/);
      if(user&&req.method==='GET'&&generationMatch){json(res,200,await readGeneration(user,generationMatch[1]));return;}
      const downloadMatch=url.pathname.match(/^\/api\/my-space\/tasks\/([^/]+)\/download$/);
      if(user&&req.method==='POST'&&downloadMatch){
        const id=downloadMatch[1],task=await spaces.taskSummary(user,id),input=await body(req);
        if(!Array.isArray(input.urls)||!input.urls.length||input.urls.length>200||input.urls.some(value=>typeof value!=='string'))throw Object.assign(Error('请选择 1–200 张已生成的图片'),{status:400});
        const history=await spaces.history(user,id),available=new Map(history.flatMap(record=>record.images.map(image=>[image.url,{...image,recordId:record.id}])));
        const selected=[...new Set(input.urls)].map(url=>available.get(url));
        if(selected.some(image=>!image))throw Object.assign(Error('选择的图片不属于当前任务，请刷新后重试'),{status:400});
        const clean=value=>value.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,120);
        const files=[];let total=0;
        for(const [index,image]of selected.entries()){
          const bytes=await spaces.image(user,image.recordId,image.name,id);total+=bytes.length;
          if(total>300*1024*1024)throw Object.assign(Error('本次下载超过 300 MB，请分批选择'),{status:400});
          files.push({name:`${index+1}-${clean(image.label)}.png`,bytes});
        }
        await ensureUser();const bytes=zipStore(files);
        res.writeHead(200,{'content-type':'application/zip','content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(clean(task.title)+'.zip')}`,'cache-control':'private, no-store'});res.end(bytes);return;
      }
      const taskImageMatch=url.pathname.match(/^\/api\/my-space\/tasks\/([^/]+)\/image\/([^/]+)\/([^/]+)$/);
      if(user&&req.method==='GET'&&taskImageMatch){const preview=url.searchParams.get('preview')==='1',bytes=await spaces.image(user,taskImageMatch[2],taskImageMatch[3],taskImageMatch[1],preview);res.writeHead(200,{'content-type':preview?'image/webp':'image/png','cache-control':'private, no-store'});res.end(bytes);return;}
      if(user&&req.method==='GET'&&url.pathname==='/api/my-space/history'){json(res,200,await spaces.history(user,url.searchParams.get('taskId')));return;}
      const imageMatch=url.pathname.match(/^\/api\/my-space\/image\/([^/]+)\/([^/]+)$/);
      if(user&&req.method==='GET'&&imageMatch){const preview=url.searchParams.get('preview')==='1',bytes=await spaces.image(user,imageMatch[1],imageMatch[2],undefined,preview);res.writeHead(200,{'content-type':preview?'image/webp':'image/png','cache-control':'private, no-store'});res.end(bytes);return;}
      if(req.method==='GET'){
        if(url.pathname==='/healthz'){json(res,200,{ok:true,service:'s7-logo-stability'});return;}
        if(url.pathname==='/api/ai-logo/status'){json(res,200,aiStatus());return;}
        if(url.pathname==='/api/ai-models'){json(res,200,aiMockupStatus());return;}
        if(url.pathname==='/api/product-library'){
          json(res,200,productLibraryView(await productCatalog(req)));return;
        }
        if(url.pathname==='/api/logo-library'){
          const logos=await logoCatalog(req);
          json(res,200,logos.map(logo=>({...logo,imageUrl:`/api/logo-library/${encodeURIComponent(String(logo.id))}/image`})));
          return;
        }
        const logoImageMatch=url.pathname.match(/^\/api\/logo-library\/([^/]+)\/image$/);
        if(logoImageMatch){
          const bytes=await logoImage(req,decodeURIComponent(logoImageMatch[1]));
          res.writeHead(200,{'content-type':'image/png','cache-control':'private, no-store'});res.end(bytes);return;
        }
        const productImageMatch=url.pathname.match(/^\/api\/product-library\/image\/([^/]+)$/);
        if(productImageMatch){
          const id=decodeURIComponent(productImageMatch[1]);
          const product=(await productCatalog(req)).find(item=>String(item?.id)===id);
          if(!product)throw Error('产品不存在');
          const output=await productImage(product,req);
          if(url.searchParams.get('thumbnail')==='1'){const bytes=await sharp(output.bytes).resize({width:192,height:192,fit:'inside',withoutEnlargement:true}).webp({quality:76}).toBuffer();res.writeHead(200,{'content-type':'image/webp','cache-control':'private, no-store'});res.end(bytes);return;}
          res.writeHead(200,{'content-type':output.contentType,'cache-control':'no-store'});res.end(output.bytes);return;
        }
        const productTemplateMatch=url.pathname.match(/^\/api\/product-library\/template\/([^/]+)$/);
        if(productTemplateMatch){
          const id=decodeURIComponent(productTemplateMatch[1]);
          const product=(await productCatalog(req)).find(item=>String(item?.id)===id);
          if(!product)throw Error('产品不存在');
          json(res,200,await productTemplate(product,req));return;
        }
        if(await staticFile(res,authenticate&&url.pathname==='/'?'/tasks.html':url.pathname))return;
        json(res,404,{error:'页面不存在'});return;
      }
      if(req.method==='POST'&&url.pathname==='/api/ai-process-logo'){
        const input=await body(req);
        const targetColor=input.targetColor??'#000000';
        if(!['#000000','original'].includes(targetColor))throw Object.assign(Error('Logo 加工颜色选项无效'),{status:400});
        if(user&&input.taskId)await spaces.task(user,input.taskId);
        const processed=await aiProcessor(Buffer.from(input.logoImage||'','base64'),{targetColor});
        const output=await validateAiLogoOutput(processed?.bytes||processed);
        await ensureUser();
        const logoName=targetColor==='original'?'AI 加工 Logo（保留原色）.png':'AI 加工 Logo（黑色）.png';
        if(user)await spaces.save(user,{taskId:input.taskId,kind:targetColor==='original'?'Logo加工（保留原色）':'Logo加工（黑色）',model:processed?.model,images:[{label:'上传的Logo',bytes:await sharp(Buffer.from(input.logoImage||'','base64')).png().toBuffer()},{label:'透明Logo',bytes:output.bytes}]});
        let logoLibrary=null,logoLibraryError=null;try{logoLibrary=await saveLogoToLibrary(req,output.bytes,logoName);}catch(error){logoLibraryError=error.message||'Logo 库保存失败';}
        json(res,200,{width:output.width,height:output.height,provider:processed?.provider||null,model:processed?.model||null,targetColor,logoLibrary,logoLibraryError,dataUrl:`data:image/png;base64,${output.bytes.toString('base64')}`});
        return;
      }
      if(req.method==='POST'&&url.pathname==='/api/ai-render-logos'){
        if(!multiLogoEnabled)throw Object.assign(Error('多 Logo 上样已关闭'),{status:404});
        if(!user)throw Object.assign(Error('请先登录工作空间'),{status:401});
        const input=await body(req);
        await spaces.task(user,input.taskId);
        const product=(await productCatalog(req)).find(item=>String(item?.id)===input.productId&&item.status!=='INACTIVE');
        if(!product)throw Object.assign(Error('产品不存在或已停用，请刷新产品库'),{status:400});
        const master=await productTemplate(product,req);
        if(master?.needsTemplateReview)throw Object.assign(Error('产品标准图已修改，请先重新确认并发布母版'),{status:400});
        const source=await productImage(product,req);
        const record=await multiLogoJobs.start(user,input.taskId,{...input,baseImage:source.bytes,targets:masterTargetsFromTemplate(master?.template),product:{id:String(product.id),sku:String(product.sku||''),name:String(product.name||'')}});
        json(res,202,record);return;
      }
      if(req.method==='POST'&&url.pathname==='/api/ai-render-multi'){
        const input=await body(req),productIds=input.productIds;
        if(!Array.isArray(productIds)||productIds.length<2||productIds.some(id=>typeof id!=='string')||new Set(productIds).size!==productIds.length)throw Object.assign(Error('请选择至少两个且不重复的产品包材'),{status:400});
        const layouts=input.productLayouts??[];
        if(!Array.isArray(layouts)||layouts.some(layout=>!layout||!productIds.includes(layout.productId))||new Set(layouts.map(layout=>layout.productId)).size!==layouts.length)throw Object.assign(Error('产品方案与所选包材不匹配'),{status:400});
        const layoutByProduct=new Map(layouts.map(layout=>[layout.productId,layout]));
        const logoImage=Buffer.from(input.logoImage||'','base64');
        if(!logoImage.length)throw Object.assign(Error('请先选择 Logo'),{status:400});
        const logoMeta=await sharp(logoImage).metadata();if(!logoMeta.width||!logoMeta.height)throw Object.assign(Error('Logo 图片无法读取'),{status:400});
        if(user&&input.taskId)await spaces.task(user,input.taskId);
        const catalog=await productCatalog(req),products=productIds.map(id=>catalog.find(product=>String(product?.id)===id));
        if(products.some(product=>!product||product.status==='INACTIVE'))throw Object.assign(Error('所选产品中有已删除或停用的包材，请刷新产品库'),{status:400});
        if(input.background===true){if(!user||!input.taskId)throw Object.assign(Error('后台生成需要个人任务'),{status:400});json(res,202,await multiProductJobs.start(user,input.taskId,input,products,req));return;}
        const model=input.model,originalColor=input.originalColor||'#000000',selectedVersions=selectGenerationVersions(input);
        res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});res.flushHeaders?.();
        event(res,'started',{total:products.length});
        let completed=0,failed=0;
        for(const product of products){
          const productInfo={id:String(product.id),sku:String(product.sku||''),name:String(product.name||'')};
          event(res,'product-start',{product:productInfo});
          try{
            await ensureUser();
            const edited=layoutByProduct.get(productInfo.id);
            const templatePayload=edited?null:await productTemplate(product,req),targets=edited?edited.targets:masterTargetsFromTemplate(templatePayload?.template);
            if(!Array.isArray(targets)||!targets.length)throw Error(`${productInfo.sku} 尚无有效的产品 Logo 区域`);
            const source=await productImage(product,req),basePng=await sharp(source.bytes).png().toBuffer(),schemes=edited?edited.schemes:createSchemes(targets).schemes;
            if(!Array.isArray(schemes))throw Error(`${productInfo.sku} 的效果方案无效`);
            const guideSet=await renderLogoSet({baseImage:basePng,logoImage,targets,schemes,originalColor});
            const failures=[];
            const outputs=await mockupRenderer({
              baseImage:`data:image/png;base64,${basePng.toString('base64')}`,logoImage:`data:image/png;base64,${logoImage.toString('base64')}`,
              finishReferenceImage:input.finishReferenceImage?`data:image/png;base64,${input.finishReferenceImage}`:undefined,
              maskImage:`data:image/png;base64,${guideSet.mask.toString('base64')}`,model,
              guides:guideSet.outputs.map(output=>({version:output.version,dataUrl:`data:image/png;base64,${output.bytes.toString('base64')}`,maskDataUrl:`data:image/png;base64,${output.mask.toString('base64')}`,foilMaskDataUrl:`data:image/png;base64,${output.foilMask.toString('base64')}`,goldMaskDataUrl:`data:image/png;base64,${output.goldMask.toString('base64')}`})),
              targets,schemes,selectedVersions,originalColor,
              logoAspectRatio:logoMeta.height/logoMeta.width,size:pickAspectRatio(guideSet.width,guideSet.height),
              onStage:async(version,stage,error)=>{if(stage==='failed')failures.push({version,error:error?.message||'生成失败'});event(res,'stage',{product:productInfo,version,stage,error:error?.message});}
            });
            if(!outputs.length)throw Error(failures.map(item=>`${item.version}：${item.error}`).join('；')||'四种印刷效果均未生成成功');
            const complete=selectedVersions.every(version=>outputs.some(output=>output.version===version)),images=outputs.map(output=>({label:`${productInfo.sku} · ${output.version}`,bytes:output.bytes}));
            await ensureUser();const savedRecord=user?await spaces.save(user,{taskId:input.taskId,kind:'多包材印刷效果',model,images}):null;
            if(complete)completed++;else failed++;const savedImages=savedRecord?.images.map(image=>({label:image.label,url:image.url}))||images.map(image=>({label:image.label,dataUrl:`data:image/png;base64,${image.bytes.toString('base64')}`}));event(res,'product-done',{product:productInfo,outputs:outputs.map(output=>output.version),images:savedImages,complete,failures});
          }catch(error){failed++;event(res,'product-error',{product:productInfo,error:error.message||'生成失败'});}
        }
        event(res,'done',{completed,failed,total:products.length});if(!res.writableEnded)res.end();return;
      }
      if(req.method==='POST'&&url.pathname==='/api/process-logo'){
        const input=await body(req);
        if(user&&input.taskId)await spaces.task(user,input.taskId);
        const processed=await processLogo(Buffer.from(input.logoImage||'','base64'),{removeWhiteBackground:input.removeWhiteBackground!==false,cropTransparentBounds:input.cropTransparentBounds!==false,threshold:Number(input.threshold??24)});
        const meta=await sharp(processed).metadata();
        await ensureUser();
        if(user)await spaces.save(user,{taskId:input.taskId,kind:'Logo处理',images:[{label:'透明Logo',bytes:processed}]});
        json(res,200,{width:meta.width,height:meta.height,dataUrl:`data:image/png;base64,${processed.toString('base64')}`});
        return;
      }
      if(req.method==='POST'&&url.pathname==='/api/ai-render'){
        const input=await body(req);
        const selectedVersions=selectGenerationVersions(input);
        if(user&&input.taskId){const task=await spaces.task(user,input.taskId);if(task.state?.mode==='multi-logo')throw Object.assign(Error('请从多 Logo 上样页面生成此任务'),{status:400});}
        const baseImage=Buffer.from(input.baseImage||'','base64');
        const logoImage=Buffer.from(input.logoImage||'','base64');
        const basePng=await sharp(baseImage).png().toBuffer();
        const logoMeta=await sharp(logoImage).metadata();
        const guideSet=await renderLogoSet({baseImage:basePng,logoImage,targets:input.targets,schemes:input.schemes,originalColor:input.originalColor});
        if(input.background===true){
          if(!user||!input.taskId)throw Object.assign(Error('后台生成需要登录并选择任务'),{status:400});
          const record=await jobs.start(user,input.taskId,{model:input.model,onlyVersion:input.onlyVersion,selectedVersions,schemeSignatures:input.schemeSignatures,preserveResults:input.preserveResults===true,width:guideSet.width,height:guideSet.height,targetIds:guideSet.targetIds,layoutFingerprint:guideSet.layoutFingerprint},callbacks=>mockupRenderer({
            baseImage:`data:image/png;base64,${basePng.toString('base64')}`,logoImage:`data:image/png;base64,${logoImage.toString('base64')}`,
            maskImage:`data:image/png;base64,${guideSet.mask.toString('base64')}`,model:input.model,
            guides:guideSet.outputs.map(output=>({version:output.version,dataUrl:`data:image/png;base64,${output.bytes.toString('base64')}`,maskDataUrl:`data:image/png;base64,${output.mask.toString('base64')}`,foilMaskDataUrl:`data:image/png;base64,${output.foilMask.toString('base64')}`,goldMaskDataUrl:`data:image/png;base64,${output.goldMask.toString('base64')}`})),
            targets:input.targets,schemes:input.schemes,onlyVersion:input.onlyVersion,selectedVersions,originalColor:input.originalColor||'#000000',
            logoAspectRatio:logoMeta.width&&logoMeta.height?logoMeta.height/logoMeta.width:1,size:pickAspectRatio(guideSet.width,guideSet.height),...callbacks
          }));
          json(res,202,record);return;
        }
        const progressStream=req.headers.accept?.includes('text/event-stream')===true;
        if(progressStream){
          res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});
          res.flushHeaders?.();
          const send=(event,payload)=>{if(!res.destroyed&&!res.writableEnded)res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);};
          const savedRecords=[];
          send('started',{width:guideSet.width,height:guideSet.height,targetIds:guideSet.targetIds,layoutFingerprint:guideSet.layoutFingerprint});
          let outputs=[];
          try{
            outputs=await mockupRenderer({
              baseImage:`data:image/png;base64,${basePng.toString('base64')}`,
              logoImage:`data:image/png;base64,${logoImage.toString('base64')}`,
              finishReferenceImage:input.finishReferenceImage?`data:image/png;base64,${input.finishReferenceImage}`:undefined,
              maskImage:`data:image/png;base64,${guideSet.mask.toString('base64')}`,
              model:input.model,guides:guideSet.outputs.map(output=>({version:output.version,dataUrl:`data:image/png;base64,${output.bytes.toString('base64')}`,maskDataUrl:`data:image/png;base64,${output.mask.toString('base64')}`,foilMaskDataUrl:`data:image/png;base64,${output.foilMask.toString('base64')}`,goldMaskDataUrl:`data:image/png;base64,${output.goldMask.toString('base64')}`})),
              targets:input.targets,schemes:input.schemes,onlyVersion:input.onlyVersion,selectedVersions,originalColor:input.originalColor||'#000000',
              logoAspectRatio:logoMeta.width&&logoMeta.height?logoMeta.height/logoMeta.width:1,size:pickAspectRatio(guideSet.width,guideSet.height),
              onStage:async(version,stage,error)=>send('stage',{version,stage,error:error?.message}),
              onOutput:async output=>{
                await ensureUser();
                const savedRecord=user?await spaces.save(user,{taskId:input.taskId,kind:'AI上样',model:input.model,images:[{label:output.version,bytes:output.bytes}]}):null;
                if(savedRecord)savedRecords.push(savedRecord);savedRecords.push({version:output.version});
                send('output',{version:output.version,dataUrl:`data:image/png;base64,${output.bytes.toString('base64')}`,savedImage:savedRecord?.images?.[0]||null});
              }
            });
            for(const output of outputs)if(!savedRecords.some(record=>record.version===output.version)){
              await ensureUser();const savedRecord=user?await spaces.save(user,{taskId:input.taskId,kind:'AI上样',model:input.model,images:[{label:output.version,bytes:output.bytes}]}):null;
              if(savedRecord)savedRecords.push(savedRecord);savedRecords.push({version:output.version});
              send('output',{version:output.version,dataUrl:`data:image/png;base64,${output.bytes.toString('base64')}`,savedImage:savedRecord?.images?.[0]||null});
            }
            send('done',{outputs:outputs.map(output=>output.version),failures:selectedVersions.length-outputs.length});
          }catch(error){send('fatal',{error:error.message||'生成失败'});}
          finally{if(!res.writableEnded)res.end();}
          return;
        }
        const outputs=await mockupRenderer({
          baseImage:`data:image/png;base64,${basePng.toString('base64')}`,
          logoImage:`data:image/png;base64,${logoImage.toString('base64')}`,
          finishReferenceImage:input.finishReferenceImage?`data:image/png;base64,${input.finishReferenceImage}`:undefined,
          maskImage:`data:image/png;base64,${guideSet.mask.toString('base64')}`,
          model:input.model,
          guides:guideSet.outputs.map(output=>({version:output.version,dataUrl:`data:image/png;base64,${output.bytes.toString('base64')}`,maskDataUrl:`data:image/png;base64,${output.mask.toString('base64')}`,foilMaskDataUrl:`data:image/png;base64,${output.foilMask.toString('base64')}`,goldMaskDataUrl:`data:image/png;base64,${output.goldMask.toString('base64')}`})),
          targets:input.targets,schemes:input.schemes,
          onlyVersion:input.onlyVersion,selectedVersions,
          originalColor:input.originalColor||'#000000',
          logoAspectRatio:logoMeta.width&&logoMeta.height?logoMeta.height/logoMeta.width:1,
          size:pickAspectRatio(guideSet.width,guideSet.height)
        });
        await ensureUser();
        const savedRecord=user?await spaces.save(user,{taskId:input.taskId,kind:'AI上样',model:input.model,images:[{label:'产品原图',bytes:basePng},{label:'Logo素材',bytes:await sharp(logoImage).png().toBuffer()},...(input.finishReferenceImage?[{label:'工艺参考',bytes:await sharp(Buffer.from(input.finishReferenceImage,'base64')).png().toBuffer()}]:[]),...outputs.map(output=>({label:output.version,bytes:output.bytes}))]}):null;
        json(res,200,{savedRecord,width:guideSet.width,height:guideSet.height,targetIds:guideSet.targetIds,layoutFingerprint:guideSet.layoutFingerprint,outputs:outputs.map(output=>({version:output.version,dataUrl:`data:image/png;base64,${output.bytes.toString('base64')}`}))});
        return;
      }
      if(req.method!=='POST'||url.pathname!=='/api/render'){
        json(res,404,{error:'接口不存在'});return;
      }
      const input=await body(req);
        if(user&&input.taskId)await spaces.task(user,input.taskId);
      const result=await renderLogoSet({
        baseImage:Buffer.from(input.baseImage||'', 'base64'),
        logoImage:Buffer.from(input.logoImage||'', 'base64'),
        targets:input.targets,schemes:input.schemes
      });
      await ensureUser();
        if(user)await spaces.save(user,{taskId:input.taskId,kind:'二维上样',images:result.outputs.map(output=>({label:output.version,bytes:output.bytes}))});
      json(res,200,{width:result.width,height:result.height,targetIds:result.targetIds,layoutFingerprint:result.layoutFingerprint,outputs:result.outputs.map(output=>({version:output.version,layoutFingerprint:output.layoutFingerprint,bounds:output.bounds,dataUrl:`data:image/png;base64,${output.bytes.toString('base64')}`}))});
    }catch(error){
      const message=error instanceof SyntaxError?'请求必须是有效JSON':/unsupported image format|Input buffer/i.test(error.message||'')?'图片格式无法读取，请上传 PNG、JPG 或 WebP 图片':error.message||'生成失败';
      json(res,error.status||400,{error:message});
    }
  };
}

export function createDemoServer(options={}){
  return createServer(createDemoHandler(options));
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const port=Number(process.env.S7_PORT||3237);
  createDemoServer().listen(port,'127.0.0.1',()=>console.log(`S7 Logo Stability: http://127.0.0.1:${port}/`));
}
