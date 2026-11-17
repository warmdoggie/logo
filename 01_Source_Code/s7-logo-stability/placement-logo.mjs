export async function preparePlacementLogo(logo,request,taskId){
  if(!logo.aiRefined&&!logo.localProcessed)return logo;
  if(logo.placementPrepared==='crop-only')return logo;
  const response=await request('/api/prepare-logo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({logoImage:logo.logoImage,...(logo.logoAssetUrl?{logoAssetUrl:logo.logoAssetUrl,taskId}:{})})});
  const output=await response.json();
  if(!response.ok)throw Error(output.error||'Logo 居中处理失败');
  logo.sourceData=logo.sourceData||logo.logoImage;
  logo.logoImage=output.dataUrl.split(',')[1];
  logo.placementPrepared='crop-only';
  return logo;
}
