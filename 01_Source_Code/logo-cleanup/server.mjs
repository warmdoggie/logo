import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import sharp from 'sharp';
import {zipStore} from '../zip.mjs';
import {createCleanupProvider,normalizeRegions} from './provider.mjs';

const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
const id=value=>{if(!/^[a-f0-9-]{36}$/.test(value||''))fail('批次或图片不存在',404);return value;};
const view=batch=>({...batch,items:batch.items.map(({detectRemote,removeRemote,...item})=>item)});
async function input(req){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>14*1024*1024)fail('单张图片不能超过 12 MB',413);chunks.push(chunk);}
  return new Request('http://localhost',{method:'POST',headers:{'content-type':req.headers['content-type']||'application/json'},body:Buffer.concat(chunks)});
}

export function createCleanupHandler({dataDir,authenticate=null,provider=createCleanupProvider()}={}){
  const cache=new Map(),waiting=[];let active=0;
  const concurrency=3;
  function home(user){const dir=join(dataDir,createHash('sha256').update(String(user.id)).digest('hex'));mkdirSync(dir,{recursive:true});return dir;}
  const folder=(user,batchId)=>join(home(user),id(batchId));
  function save(user,batch){
    const dir=folder(user,batch.id);mkdirSync(dir,{recursive:true});
    batch.updatedAt=new Date().toISOString();
    writeFileSync(join(dir,'batch.tmp'),JSON.stringify(batch));renameSync(join(dir,'batch.tmp'),join(dir,'batch.json'));
  }
  function load(user,batchId){
    const dir=folder(user,batchId),key=dir;
    if(cache.has(key))return cache.get(key);
    if(!existsSync(join(dir,'batch.json')))fail('批次不存在',404);
    const batch=JSON.parse(readFileSync(join(dir,'batch.json'),'utf8'));
    if(batch.busy){batch.busy=false;for(const item of batch.items)if(['queued','detecting','removing'].includes(item.status)){item.status='error';item.error='服务已重启，可重试继续获取结果';}save(user,batch);}
    cache.set(key,batch);return batch;
  }
  const editable=batch=>{if(batch.busy)fail('批次正在处理，请完成后再操作',409);};
  function start(user,batch,operation,ids){
    editable(batch);
    if(operation!=='detect'&&!provider.status().configured)fail('请先配置工作区 APIMart 图片接口');
    if(ids!==undefined&&(!Array.isArray(ids)||!ids.length||ids.some(value=>!batch.items.some(item=>item.id===value))))fail('所选图片不存在');
    const items=batch.items.filter(item=>{
      if(operation==='auto'&&item.status==='done')return false;
      if(ids)return ids.includes(item.id);
      return item.status!=='done'&&(operation==='auto'||(operation==='detect'?!item.regions.length:item.regions.length));
    });
    if(!items.length)fail(operation==='auto'?'本批图片已全部完成，或尚未添加图片':operation==='detect'?'没有待识别的图片':'请先识别或框选占位字区域');
    if(operation!=='detect')for(const item of items)if(operation==='remove'||item.regions.length)normalizeRegions(item.regions);
    batch.busy=true;batch.operation=operation;
    for(const item of items){item.status='queued';item.error='';}save(user,batch);
    const run=async item=>{
      if(active>=concurrency)await new Promise(resolve=>waiting.push(resolve));else active++;
      try{
        const bytes=readFileSync(join(folder(user,batch.id),item.id+'.png'));
        const options=key=>({resume:item[key],onCheckpoint:async remote=>{item[key]=remote;save(user,batch);}});
        if(operation==='detect'||(operation==='auto'&&!item.regions.length)){
          item.status='detecting';save(user,batch);
          const regions=await provider.detect(bytes,options('detectRemote'));
          item.regions=regions.length?normalizeRegions(regions):[];
          item.status=item.regions.length?'ready':'review';
          item.error=item.regions.length?'':'未识别到占位字，请核对原图，必要时手动框选';item.detectRemote=null;item.removeRemote=null;
        }
        if(operation!=='detect'&&item.regions.length){
          item.status='removing';save(user,batch);
          const result=await provider.remove(bytes,item.regions,options('removeRemote'));
          writeFileSync(join(folder(user,batch.id),item.id+'-clean.png'),result);item.status='done';item.removeRemote=null;
        }
      }catch(error){item.status='error';item.error=error.name==='TimeoutError'?'AI 等待超时，可重试继续获取结果':error.message||'处理失败，可重试';}
      finally{
        try{save(user,batch);}finally{const next=waiting.shift();if(next)next();else active--;}
      }
    };
    Promise.allSettled(items.map(run)).then(results=>{
      batch.busy=false;const failed=results.find(result=>result.status==='rejected');
      if(failed)batch.error=failed.reason.message;save(user,batch);
    }).catch(error=>{batch.busy=false;batch.error=error.message;try{save(user,batch);}catch{}});
  }
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    try{
      const user=authenticate?await authenticate(req):{id:'local'};
      if(!user)fail('请先登录工作区',401);
      const url=new URL(req.url,'http://localhost'),path=url.pathname;
      if(req.method==='GET'&&['/','/client.js','/style.css'].includes(path)){
        const file=path==='/'?'index.html':path.slice(1),type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';
        res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(readFileSync(new URL(file,import.meta.url)));return;
      }
      if(path==='/api/status'&&req.method==='GET')return json(res,200,{...provider.status(),concurrency});
      if(path==='/api/batches'){
        if(req.method==='GET')return json(res,200,readdirSync(home(user),{withFileTypes:true}).filter(entry=>entry.isDirectory()&&/^[a-f0-9-]{36}$/.test(entry.name)).map(entry=>view(load(user,entry.name))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
        if(req.method==='POST'){
          const batch={id:randomUUID(),createdAt:new Date().toISOString(),busy:false,items:[]};
          save(user,batch);cache.set(folder(user,batch.id),batch);return json(res,201,view(batch));
        }
      }
      const match=path.match(/^\/api\/batches\/([^/]+)(?:\/(.*))?$/);
      if(!match)fail('接口不存在',404);
      const batch=load(user,match[1]),action=match[2]||'';
      if(req.method==='GET'&&!action)return json(res,200,view(batch));
      if(req.method==='POST'&&action==='images'){
        editable(batch);if(batch.items.length>=100)fail('每批最多 100 张图片，请新建批次');
        const form=await(await input(req)).formData(),file=form.get('file');
        if(!file||!file.size||typeof file.arrayBuffer!=='function')fail('请选择图片');
        if(file.size>12*1024*1024)fail('单张图片不能超过 12 MB',413);
        const bytes=Buffer.from(await file.arrayBuffer());let meta;
        try{meta=await sharp(bytes,{limitInputPixels:16000000}).metadata();}catch{fail('图片无法读取或超过 1600 万像素');}
        if(!['png','jpeg','webp'].includes(meta.format)||(meta.pages||1)>1)fail('仅支持静态 PNG、JPG、WebP 图片');
        const normalized=await sharp(bytes).rotate().toColourspace('srgb').png().toBuffer();
        const thumbnail=await sharp(normalized).resize({width:192,height:192,fit:'inside',withoutEnlargement:true}).webp({quality:76}).toBuffer();
        const dimensions=await sharp(normalized).metadata(),item={id:randomUUID(),name:String(file.name||'image').slice(0,200),width:dimensions.width,height:dimensions.height,size:normalized.length,status:'uploaded',regions:[],error:''};
        editable(batch);if(batch.items.length>=100)fail('每批最多 100 张图片，请新建批次');
        if(batch.items.reduce((total,value)=>total+value.size,0)+normalized.length>300*1024*1024)fail('每批原图总量不能超过 300 MB，请新建批次');
        writeFileSync(join(folder(user,batch.id),item.id+'.png'),normalized);writeFileSync(join(folder(user,batch.id),item.id+'-thumb.webp'),thumbnail);batch.items.push(item);save(user,batch);return json(res,201,view(batch));
      }
      if(req.method==='POST'&&['detect','remove','auto'].includes(action)){
        const body=await(await input(req)).json();start(user,batch,action,body.ids);return json(res,202,view(batch));
      }
      if(req.method==='GET'&&action==='download'){
        const files=batch.items.filter(item=>item.status==='done').map((item,index)=>({name:`${String(index+1).padStart(3,'0')}_${item.name.replace(/\.[^.]+$/,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')}_clean.png`,bytes:readFileSync(join(folder(user,batch.id),item.id+'-clean.png'))}));
        if(!files.length)fail('没有已完成的图片可下载');
        const bytes=zipStore(files);res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="logo-cleanup-${batch.id.slice(0,8)}.zip"`});res.end(bytes);return;
      }
      const image=action.match(/^images\/([^/]+)(?:\/(original|result))?$/);
      if(image){
        const item=batch.items.find(item=>item.id===id(image[1]));if(!item)fail('图片不存在',404);
        if(req.method==='GET'&&image[2]){
          if(image[2]==='result'&&item.status!=='done')fail('成图尚未生成',404);
          if(image[2]==='original'&&url.searchParams.get('thumbnail')==='1'){
            const file=join(folder(user,batch.id),item.id+'-thumb.webp');
            if(!existsSync(file))writeFileSync(file,await sharp(join(folder(user,batch.id),item.id+'.png')).resize({width:192,height:192,fit:'inside',withoutEnlargement:true}).webp({quality:76}).toBuffer());
            res.writeHead(200,{'Content-Type':'image/webp'});res.end(readFileSync(file));return;
          }
          res.writeHead(200,{'Content-Type':'image/png'});res.end(readFileSync(join(folder(user,batch.id),item.id+(image[2]==='result'?'-clean':'')+'.png')));return;
        }
        if(req.method==='PATCH'&&!image[2]){
          editable(batch);const body=await(await input(req)).json();editable(batch);
          item.regions=Array.isArray(body.regions)&&!body.regions.length?[]:normalizeRegions(body.regions);
          item.status=item.regions.length?'ready':'uploaded';item.error='';item.detectRemote=null;item.removeRemote=null;save(user,batch);return json(res,200,view(batch));
        }
      }
      fail('接口不存在',404);
    }catch(error){if(!res.headersSent)json(res,error.status||400,{error:error.message||'请求失败'});else res.end();}
  };
}
