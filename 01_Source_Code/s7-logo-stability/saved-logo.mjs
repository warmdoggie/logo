const STORAGE_KEY='s7-logo-stability.saved-logo.v1';
const sessionLogos=new WeakMap();

export function saveLogo(storage,{data,name,sourceData,aiRefined,localProcessed}){
  if(typeof data!=='string'||!data)throw Error('缺少已加工 Logo 数据');
  const raw=JSON.stringify({data,name:typeof name==='string'&&name?name:'AI 已加工 Logo.png',...(typeof sourceData==='string'&&sourceData?{sourceData}:{}),...(aiRefined===true?{aiRefined:true}:{}),...(localProcessed===true?{localProcessed:true}:{})});
  try{storage.setItem(STORAGE_KEY,raw);sessionLogos.delete(storage);}
  catch{
    // Browser caching is optional; the processed result is already saved on the server.
    sessionLogos.set(storage,raw);
    try{storage.removeItem(STORAGE_KEY);}catch{}
  }
}

export function loadSavedLogo(storage){
  try{
    const raw=sessionLogos.get(storage)||storage.getItem(STORAGE_KEY);
    if(!raw)return null;
    const value=JSON.parse(raw);
    return typeof value?.data==='string'&&value.data?{data:value.data,name:typeof value.name==='string'&&value.name?value.name:'AI 已加工 Logo.png',...(typeof value.sourceData==='string'&&value.sourceData?{sourceData:value.sourceData}:{}),...(value.aiRefined===true?{aiRefined:true}:{}),...(value.localProcessed===true?{localProcessed:true}:{})}:null;
  }catch{return null;}
}

export function clearSavedLogo(storage){sessionLogos.delete(storage);try{storage.removeItem(STORAGE_KEY);}catch{}}
