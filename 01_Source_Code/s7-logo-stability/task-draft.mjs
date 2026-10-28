export function restoredBaseProduct(state,products){
 if(state.baseProductId)return products.find(product=>product.id===state.baseProductId);
 const named=products.find(product=>state.baseName===`产品库：${product.sku} · ${product.name}`);
 if(named||state.baseName?.startsWith('产品库：'))return named;
 return products.find(product=>product.id===state.selectedMultiProductId);
}
export function normalizeTaskResult(payload,path=value=>value){
 const {savedRecord,...result}=payload;
 return {...result,outputs:result.outputs.map(output=>{const image=savedRecord?.images.find(image=>image.label===output.version);return {...output,dataUrl:image?path(image.url):output.dataUrl};})};
}
// Serialize autosaves so an older upload/layout snapshot cannot overwrite a newer one.
export function createTaskDraft({id,request,capture,onSaved,onError,delay=600}){
 let revision=0,ready=false,pending=false,running=null,timer,editVersion=0,savedVersion=0,saved={};
 const strings=new Map();
 const encode=state=>Object.fromEntries(Object.entries(state).map(([key,value])=>{
  if(typeof value!=='string')return [key,JSON.stringify(value)];
  const previous=strings.get(key);if(previous?.value===value)return [key,previous.encoded];
  const encoded=JSON.stringify(value);strings.set(key,{value,encoded});return [key,encoded];
 }));
 async function load(){const record=await request(`/api/my-space/tasks/${id}`);revision=record.revision;saved=encode(record.state);return record.state;}
 function activate(){ready=true;}
 async function flush(){
  clearTimeout(timer);if(!ready)return;
  pending=true;if(running)return running;
  running=Promise.resolve().then(async()=>{try{while(pending){pending=false;const version=editVersion,state=capture(),encoded=encode(state),patch=Object.fromEntries(Object.entries(state).filter(([key])=>encoded[key]!==saved[key]));if(!Object.keys(patch).length){savedVersion=version;continue;}const record=await request(`/api/my-space/tasks/${id}`,{revision,state:patch,mergeState:true,summary:true},'PUT');revision=record.revision;saved=encoded;savedVersion=version;onSaved?.(record);}}catch(error){pending=false;onError?.(error);throw error;}finally{running=null;}});
  return running;
 }
 function schedule(){if(!ready)return;editVersion++;clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),delay);}
 return {load,activate,schedule,flush,isDirty:()=>editVersion>savedVersion||!!running};
}
