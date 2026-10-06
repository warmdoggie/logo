const STORAGE_KEY='s7-logo-stability.saved-logo.v1';

export function saveLogo(storage,{data,name,sourceData}){
  if(typeof data!=='string'||!data)throw Error('缺少已加工 Logo 数据');
  storage.setItem(STORAGE_KEY,JSON.stringify({data,name:typeof name==='string'&&name?name:'AI 已加工 Logo.png',...(typeof sourceData==='string'&&sourceData?{sourceData}:{})}));
}

export function loadSavedLogo(storage){
  const raw=storage.getItem(STORAGE_KEY);
  if(!raw)return null;
  try{
    const value=JSON.parse(raw);
    return typeof value?.data==='string'&&value.data?{data:value.data,name:typeof value.name==='string'&&value.name?value.name:'AI 已加工 Logo.png',...(typeof value.sourceData==='string'&&value.sourceData?{sourceData:value.sourceData}:{})}:null;
  }catch{return null;}
}

export function clearSavedLogo(storage){storage.removeItem(STORAGE_KEY);}
