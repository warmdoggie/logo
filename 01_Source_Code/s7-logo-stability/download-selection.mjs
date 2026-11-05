export const downloadKey=output=>JSON.stringify(output.logoId?[output.productId||'',output.version,output.logoId]:[output.productId||'',output.version]);
export function syncDownloadSelection(state,outputs){
 const next={};let changed=false;
 for(const output of outputs){
  if(!output.dataUrl)continue;
  const key=downloadKey(output),previous=state[key];
  next[key]=previous?.dataUrl===output.dataUrl?previous:{dataUrl:output.dataUrl,selected:true};
  if(next[key]!==previous)changed=true;
 }
 return changed||Object.keys(next).length!==Object.keys(state).length?next:state;
}
export const selectedDownloadOutputs=(state,outputs)=>outputs.filter(output=>output.dataUrl&&state[downloadKey(output)]?.dataUrl===output.dataUrl&&state[downloadKey(output)].selected);
export function generationVersionsForProduct(versions,productId,outputs,selection,logoId){
 const cancelled=new Set(outputs.filter(output=>{
  const choice=selection[downloadKey(output)];
  return output.productId===productId&&(!logoId||!output.logoId||output.logoId===logoId)&&choice?.dataUrl===output.dataUrl&&choice.selected===false;
 }).map(output=>output.version));
 return versions.filter(version=>!cancelled.has(version));
}
